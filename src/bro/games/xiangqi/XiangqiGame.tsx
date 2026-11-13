/**
 * 中国象棋对局页。
 *
 * 与围棋对局页同构，因为要落地的是同一条约束：**切主题不能重开一局**。
 * 会话与服务端只跟对局参数走，渲染器只跟主题走，两个 effect 的依赖数组
 * 刻意不同。把 `mode` 混进第一个数组，切一次主题就丢一盘棋。
 *
 * 页面自身不含任何规则判断。「这一步能不能走」由服务端裁定，「点哪里会怎样」
 * 由渲染器和 selection.ts 决定；页面只做三件事：把快照喂给会话、把意图转给
 * 服务端、把被拒的原因翻成人话。
 *
 * 唯一一处看起来像规则的是 `canRequestUndo`，但它读的是快照里的 `ply` 与
 * `undoRequest`，和服务端共用 view.ts 里同一个函数——不是在客户端重算规则，
 * 是在读服务端的结论。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { GameSession } from "../core/session";
import type { InputIntent } from "../core/types";
import { canAct, renderModeForTheme } from "../core/types";
import { CanvasXiangqiRenderer } from "./render/canvas";
import { TuiXiangqiRenderer } from "./render/tui";
import { capturedText, verdictText } from "./render/tui-text";
import { chooseMove } from "./server/bot";
import type { Rejection } from "./server/local";
import { LocalXiangqiServer } from "./server/local";
import type { XiangqiSnapshot, XiangqiView } from "./view";
import {
  SEAT_RED,
  XIANGQI_INTENT,
  awaitingMyReply,
  canRequestUndo,
  sideOfSeat,
} from "./view";
import "./xiangqi.css";

/**
 * 被拒原因的中文说法。
 *
 * 服务端回的是稳定标识（英文枚举），展示文案留在客户端——文案要改就改这里，
 * 不必动服务端；将来做多语言时也只有这一张表要翻。
 */
const REJECT_TEXT: Record<string, string> = {
  illegal_move: "这一步不合规则",
  not_your_turn: "还没轮到你",
  nothing_to_undo: "还没有可悔的棋",
  undo_pending: "悔棋请求还没有答复",
  undo_exhausted: "这局的悔棋次数已经用完",
  no_undo_request: "没有待答复的悔棋请求",
  cannot_reply_own_undo: "自己的悔棋请求要由对方答复",
  game_over: "对局已经结束",
  stale_version: "局面已更新，请重试",
  wrong_match: "这条操作不属于当前对局",
};

export interface XiangqiGameProps {
  /** 玩家执红还是执黑。缺省执红先行，与传统开局一致。 */
  readonly mySeat?: number;
  /** 陪练机器人的思考延时（毫秒）。设 0 即刻落子，便于测试。 */
  readonly botDelayMs?: number;
}

export function XiangqiGame({
  mySeat = SEAT_RED,
  botDelayMs = 500,
}: XiangqiGameProps) {
  const isDark = useDarkMode();
  const mode = renderModeForTheme(isDark ? "dark" : "light");

  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession<XiangqiView> | null>(null);
  const serverRef = useRef<LocalXiangqiServer | null>(null);

  const [snapshot, setSnapshot] = useState<XiangqiSnapshot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  // 会话与服务端：只跟座位走。主题变化绝不能进这个依赖数组。
  useEffect(() => {
    const server = new LocalXiangqiServer({
      mySeat,
      onSnapshot: (next) => {
        setSnapshot(next);
        sessionRef.current?.applySnapshot(next);
      },
      onReject: (r: Rejection) =>
        setRejection(REJECT_TEXT[r.reason] ?? r.reason),
    });
    const session = new GameSession<XiangqiView>((intent: InputIntent) => {
      // 发新意图就清掉上一条错误提示，否则旧的红字会一直挂在那里，
      // 让人以为刚刚这一步也被拒了
      setRejection(null);
      server.submit(intent);
    });

    serverRef.current = server;
    sessionRef.current = session;
    server.start();

    return () => {
      session.dispose();
      sessionRef.current = null;
      serverRef.current = null;
    };
  }, [mySeat]);

  // 渲染器：只跟主题走。会话持有状态，换渲染器后会立刻用现有局面重绘。
  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    session.attachRenderer(
      mode === "tui" ? new TuiXiangqiRenderer() : new CanvasXiangqiRenderer(),
      host,
    );
    return () => session.detachRenderer();
  }, [mode, mySeat]);

  // 陪练机器人：轮到对手就走一手。延时不是为了「像在思考」，
  // 是为了让人看清对方走了哪一步——瞬间落子的棋盘是读不出来的。
  useEffect(() => {
    const server = serverRef.current;
    if (!server || !snapshot || snapshot.phase !== "playing") return;
    if (snapshot.board.undoRequest !== null) return;
    if (snapshot.activeSeat === snapshot.mySeat) return;

    const timer = setTimeout(() => {
      const move = chooseMove(server.authoritativeState());
      if (move) server.playAsOpponent(move);
    }, botDelayMs);
    return () => clearTimeout(timer);
  }, [snapshot, botDelayMs]);

  // 机器人答复悔棋请求。
  //
  // 少了这一段，单机练习会**死锁**：玩家按 u 发出请求，机器人不会答复，而
  // 请求悬着时双方都走不了子，这盘棋就永远停在那里——入场费已经扣了。
  //
  // 一律同意。陪练局的目的就是试招，而且额度限制（每人 3 次）已经挡住了把
  // 悔棋当无限撤销用。真正需要「对方可能拒绝」的是匹配对局，那时答复来自
  // 真人，不走这条路径。
  useEffect(() => {
    const server = serverRef.current;
    const request = snapshot?.board.undoRequest;
    if (!server || !snapshot || !request) return;
    if (request.bySeat !== snapshot.mySeat) return;

    const timer = setTimeout(() => server.replyAsOpponent(true), botDelayMs);
    return () => clearTimeout(timer);
  }, [snapshot, botDelayMs]);

  /** 面板按钮走的也是意图通道，与渲染器里的键盘操作没有区别。 */
  const submit = useCallback((type: string) => {
    const state = sessionRef.current?.currentState();
    if (!state) return;
    setRejection(null);
    serverRef.current?.submit({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type,
      payload: {},
    });
  }, []);

  const [confirmResign, setConfirmResign] = useState(false);
  const onResign = useCallback(() => {
    // 认输不可撤销，必须二次确认（UI-DESIGN.md §7.1）
    if (!confirmResign) return setConfirmResign(true);
    setConfirmResign(false);
    submit(XIANGQI_INTENT.resign);
  }, [confirmResign, submit]);

  const myTurn = snapshot ? canAct(snapshot) : false;
  const playing = snapshot?.phase === "playing";
  const view = snapshot?.board ?? null;
  const awaitingReply = view
    ? awaitingMyReply(view, snapshot?.mySeat ?? null)
    : false;

  return (
    <div className="bro-xiangqi">
      {/* .bro-game-viewport 让玻璃护栏关掉这块区域内的模糊与投影：
          对局区帧率优先（glass.css §性能护栏） */}
      <div className="bro-xiangqi__board bro-game-viewport" ref={hostRef} />

      <div className="bro-xiangqi__panel">
        <Status snapshot={snapshot} myTurn={myTurn} />

        {rejection && (
          <p className="bro-xiangqi__reject" role="alert">
            {rejection}
          </p>
        )}

        <div className="bro-xiangqi__actions">
          {awaitingReply ? (
            <>
              <button
                type="button"
                className="bro-xiangqi__action"
                onClick={() => submit(XIANGQI_INTENT.undoAccept)}
              >
                同意悔棋
              </button>
              <button
                type="button"
                className="bro-xiangqi__action"
                onClick={() => submit(XIANGQI_INTENT.undoDecline)}
              >
                拒绝
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bro-xiangqi__action"
              onClick={() => submit(XIANGQI_INTENT.undoRequest)}
              disabled={
                !myTurn ||
                !view ||
                !canRequestUndo(view, snapshot?.mySeat ?? null)
              }
            >
              {view?.undoRequest ? "等待对方答复…" : "请求悔棋"}
            </button>
          )}
          <button
            type="button"
            className="bro-xiangqi__action bro-xiangqi__action--danger"
            onClick={onResign}
            onBlur={() => setConfirmResign(false)}
            disabled={!playing}
          >
            {confirmResign ? "确认认输？" : "认输"}
          </button>
        </div>

        {view && <p className="bro-xiangqi__captured">{capturedText(view)}</p>}
      </div>
    </div>
  );
}

function Status({
  snapshot,
  myTurn,
}: {
  snapshot: XiangqiSnapshot | null;
  myTurn: boolean;
}) {
  if (!snapshot) return <p className="bro-xiangqi__status">正在开局…</p>;

  const view = snapshot.board;
  if (view.result) {
    return (
      <p className="bro-xiangqi__status">终局 · {verdictText(view.result)}</p>
    );
  }

  const mine = sideOfSeat(snapshot.mySeat ?? SEAT_RED);
  // 将军是象棋里唯一「没看见就直接输」的状态，必须压过「轮到谁」的提示。
  // 文字 + role=alert，不靠棋盘上那圈红环单独承担（UI-DESIGN.md §9）。
  const checked = view.checkSquare !== null;

  return (
    <>
      {checked && (
        <p className="bro-xiangqi__check" role="alert">
          {myTurn ? "将军！你必须应将" : "将军！"}
        </p>
      )}
      <p className="bro-xiangqi__status">
        {myTurn ? "轮到你了" : "对手思考中…"}
      </p>
      <p className="bro-xiangqi__side">
        你执{mine === "red" ? "红" : "黑"} · 第 {view.ply + 1} 手
      </p>
    </>
  );
}
