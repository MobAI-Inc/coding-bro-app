/**
 * 立直麻将对局页。
 *
 * 与其余五款同一套骨架：会话与服务端跟一组「对局参数」走，渲染器跟主题走，
 * 两个 effect 依赖数组不同 —— 切主题只重挂渲染器，牌桌原封不动。
 *
 * 页面不含任何规则判断。能不能立直、这手算不算和、振听没振听，全在服务端那侧。
 * 页面只做三件事：喂快照、转意图、显示被拒的原因。
 *
 * 侧栏那几个按钮（荣 / 自摸 / 立直 / 放弃）看着像规则，其实不是 —— 它们的
 * 可用状态直接读快照里的 `canRon` / `canTsumo` / `canRiichi`，那三个字段是
 * 服务端算好下发的。页面只负责把它们画成灰的或亮的。
 */

import { useEffect, useRef, useState } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { GameSession } from "../core/session";
import type { InputIntent } from "../core/types";
import { canAct, renderModeForTheme } from "../core/types";
import { CanvasRiichiRenderer } from "./render/canvas";
import { TuiRiichiRenderer } from "./render/tui";
import { labelOf, tileLabel } from "./render/layout";
import type { Rejection } from "./server/local";
import { LocalRiichiServer } from "./server/local";
import type { RiichiSnapshot, RiichiView } from "./view";
import { END_REASON_TEXT, RIICHI_INTENT } from "./view";
import "./riichi.css";

/**
 * 被拒原因的中文说法。服务端回的是稳定标识，展示文案在客户端。
 *
 * 键覆盖状态机的全部 `ActionRejection` 加服务端自己那几条。漏一条的表现是
 * 界面上蹦出一句英文 `riichi_no_points`，tests 里有断言盯着这张表。
 */
export const REJECT_TEXT: Record<string, string> = {
  // 服务端层
  wrong_match: "对局不匹配",
  stale_version: "牌桌已更新，请重试",
  unknown_intent: "这个操作暂不支持",
  // 状态机
  not_your_turn: "还没轮到你",
  wrong_phase: "现在不能做这个操作",
  tile_not_in_hand: "这张牌不在你手上",
  round_over: "这一局已经结束",
  riichi_not_closed: "副露之后不能立直",
  riichi_already: "你已经立直了",
  riichi_no_points: "点数不足 1000，立不了直",
  not_tenpai: "打出这张就不听牌了，立不了直",
  furiten: "振听，这张不能荣和",
  no_yaku: "无役，不能荣和",
  not_winning_hand: "这手牌还没和",
  nothing_to_call: "现在没有可以响应的牌",
};

export interface RiichiGameProps {
  /** 牌山种子。固定种子便于复现与测试。 */
  readonly seed?: number;
}

export function RiichiGame({ seed = 1 }: RiichiGameProps) {
  const isDark = useDarkMode();
  const mode = renderModeForTheme(isDark ? "dark" : "light");

  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession<RiichiView> | null>(null);
  const serverRef = useRef<LocalRiichiServer | null>(null);

  const [snapshot, setSnapshot] = useState<RiichiSnapshot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  // 会话与服务端：开局一次就好。主题绝不能进这个依赖数组，否则切一次主题就重开一局。
  useEffect(() => {
    const server = new LocalRiichiServer({
      seed,
      mySeat: 0,
      onSnapshot: (next) => {
        setSnapshot(next);
        sessionRef.current?.applySnapshot(next);
      },
      onReject: (r: Rejection) =>
        setRejection(REJECT_TEXT[r.reason] ?? r.reason),
    });
    const session = new GameSession<RiichiView>((intent: InputIntent) => {
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
  }, [seed]);

  // 渲染器：只跟主题走。会话持有状态，换渲染器后会立刻用现有牌桌重绘。
  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    session.attachRenderer(
      mode === "tui" ? new TuiRiichiRenderer() : new CanvasRiichiRenderer(),
      host,
    );
    return () => session.detachRenderer();
  }, [mode]);

  const submit = (type: string, payload: unknown = {}) => {
    const current = snapshot;
    if (!current) return;
    setRejection(null);
    serverRef.current?.submit({
      matchId: current.matchId,
      basedOnVersion: current.version,
      type,
      payload,
    });
  };

  const myTurn = snapshot ? canAct(snapshot) : false;
  const self = snapshot?.board.self;

  return (
    <div className="bro-riichi">
      {/* .bro-game-viewport 让玻璃护栏关掉这块区域内的模糊与投影：
          对局区帧率优先（glass.css §性能护栏） */}
      <div className="bro-riichi__table bro-game-viewport" ref={hostRef} />

      <div className="bro-riichi__panel">
        <Status snapshot={snapshot} myTurn={myTurn} mode={mode} />

        {self && snapshot?.board.result === null && (
          <div className="bro-riichi__actions">
            <button
              type="button"
              className="bro-riichi__action"
              disabled={!self.canTsumo}
              onClick={() => submit(RIICHI_INTENT.tsumo)}
            >
              自摸
            </button>
            <button
              type="button"
              className="bro-riichi__action"
              disabled={!self.canRon}
              onClick={() => submit(RIICHI_INTENT.ron)}
            >
              荣和
            </button>
            <button
              type="button"
              className="bro-riichi__action bro-riichi__action--riichi"
              disabled={!self.canRiichi}
              onClick={() => {
                // 立直要打一张，默认打能保持听牌的第一张。玩家想选别的
                // 就在牌桌上点 —— 这个按钮是快捷方式，不是唯一入口。
                const tile = self.tenpaiDiscards[0];
                if (tile !== undefined) {
                  submit(RIICHI_INTENT.discard, { tile, riichi: true });
                }
              }}
            >
              立直
            </button>
            {self.canRon && (
              <button
                type="button"
                className="bro-riichi__action"
                onClick={() => submit(RIICHI_INTENT.pass)}
              >
                放弃
              </button>
            )}
          </div>
        )}

        {rejection && (
          <p className="bro-riichi__reject" role="alert">
            {rejection}
          </p>
        )}
      </div>
    </div>
  );
}

function Status({
  snapshot,
  myTurn,
  mode,
}: {
  snapshot: RiichiSnapshot | null;
  myTurn: boolean;
  mode: string;
}) {
  if (!snapshot) return <p className="bro-riichi__status">正在发牌…</p>;

  const view = snapshot.board;
  const { result, self } = view;

  if (result !== null) {
    const delta = result.deltas[self.seat];
    return (
      <>
        <p className="bro-riichi__status">
          {END_REASON_TEXT[result.reason]}
          {result.winner === self.seat ? " · 你和了" : ""}
        </p>
        <p className="bro-riichi__meta">
          {result.han > 0 ? `${result.han}番 ${result.fu}符 · ` : ""}你
          {delta >= 0 ? "得" : "失"} {Math.abs(delta)} 点
        </p>
        {result.yaku.length > 0 && (
          <p className="bro-riichi__hint">
            {result.yaku.map((y) => `${y.id} ${y.han}番`).join(" · ")}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <p className="bro-riichi__status">
        {self.canRon ? "可以荣和" : myTurn ? "轮到你了" : "其他玩家思考中…"}
      </p>
      <p className="bro-riichi__meta">
        {tileLabel(view.roundWind)}场 {view.honba}本场 · 余 {view.wallRemaining}{" "}
        张 · {self.points} 点
      </p>
      <p className="bro-riichi__meta">
        宝牌 {view.doraIndicators.map((t) => labelOf(t)).join(" ") || "—"}
      </p>
      {self.waits.length > 0 && (
        <p className="bro-riichi__hint">
          听 {self.waits.map((t) => tileLabel(t)).join(" ")}
          {self.furiten ? "（振听）" : ""}
        </p>
      )}
      <p className="bro-riichi__hint">
        {mode === "tui"
          ? "h/l 选牌 · Enter 打出 · R 立直 · r 荣 · t 自摸"
          : "点手牌打出 · 绿框的牌打了仍听牌"}
      </p>
    </>
  );
}
