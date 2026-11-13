/**
 * 台球对局页。
 *
 * 与围棋同一套骨架：会话与服务端跟一组「对局参数」走，渲染器跟主题走，两个
 * effect 依赖数组不同 —— 切主题只重挂渲染器，球桌原封不动。
 *
 * 页面不含任何规则判断。能不能出杆、这杆算不算犯规、球滚到哪，全在服务端那侧
 * 的定点数解算器里。页面只做三件事：喂快照、转意图、显示被拒的原因。
 */

import { useEffect, useRef, useState } from "react";
import { GameSession } from "../core/session";
import { LocalMatchmaking } from "../core/LocalMatchmaking";
import { playArcadeCue } from "../core/audio";
import type { InputIntent } from "../core/types";
import { canAct } from "../core/types";
import { CanvasBilliardsRenderer, shotPlaybackDuration } from "./render/canvas";
import { chooseShotDecision } from "./server/bot";
import type { Rejection } from "./server/local";
import { LocalBilliardsServer } from "./server/local";
import type { BilliardsSnapshot, BilliardsView } from "./view";
import "./billiards.css";

/**
 * 被拒原因的中文说法。服务端回的是稳定标识，展示文案在客户端。
 *
 * 键覆盖三个来源：`ShotRejection`、`PlacementRejection`，以及服务端自己那几条
 * （版本 / 座位 / 对局）。`tests/bro/games/billiards-server.test.ts` 断言这张表
 * 覆盖全部标识 —— 漏一条的表现是界面上蹦出一句英文 `place_cue_first`。
 */
export const REJECT_TEXT: Record<string, string> = {
  // 服务端层
  wrong_match: "对局不匹配",
  stale_version: "台面已更新，请重试",
  not_your_turn: "还没轮到你",
  unknown_intent: "这个操作暂不支持",
  // 击球
  game_over: "对局已经结束",
  place_cue_first: "先摆好母球再出杆",
  // 摆球
  not_in_hand: "现在不能摆球",
  off_table: "母球得摆在台面里，且不能贴库",
  in_pocket: "不能摆进袋口",
  overlapping: "这里和别的球重叠了",
};

const GROUP_TEXT = {
  solids: "全色（1-7）",
  stripes: "花色（9-15）",
} as const;

export interface BilliardsGameProps {
  /** 陪练机器人的思考延时（毫秒）。设 0 即刻出杆，便于测试。 */
  readonly botDelayMs?: number;
  /** 本地队列多久后用 AI 补位。 */
  readonly matchmakingDelayMs?: number;
  /** 整局获胜时上报一次正积分；匹配与输局不触发。 */
  readonly onSettle?: (points: number) => void;
}

export function BilliardsGame({
  botDelayMs = 700,
  matchmakingDelayMs = 900,
  onSettle,
}: BilliardsGameProps) {
  return (
    <LocalMatchmaking
      gameId="billiards"
      seatCount={2}
      playerNames={BILLIARDS_BOT_NAMES}
      fillDelayMs={matchmakingDelayMs}
    >
      {(match) => (
        <BilliardsTable
          key={match.matchId}
          matchId={match.matchId ?? "local-demo-pending"}
          botDelayMs={botDelayMs}
          onSettle={onSettle}
        />
      )}
    </LocalMatchmaking>
  );
}

const BILLIARDS_BOT_NAMES = ["Line Bot"] as const;

function BilliardsTable({
  matchId,
  botDelayMs,
  onSettle,
}: {
  readonly matchId: string;
  readonly botDelayMs: number;
  readonly onSettle?: (points: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession<BilliardsView> | null>(null);
  const serverRef = useRef<LocalBilliardsServer | null>(null);
  const settledRef = useRef(false);
  const playbackRef = useRef(false);

  const [snapshot, setSnapshot] = useState<BilliardsSnapshot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [botNote, setBotNote] = useState<string | null>(null);
  const [isPlayback, setIsPlayback] = useState(false);

  useEffect(() => {
    if (isPlayback || settledRef.current || snapshot?.phase !== "finished")
      return;
    settledRef.current = true;
    const won = snapshot.board.winner === snapshot.mySeat;
    playArcadeCue(won ? "win" : "lose");
    if (won) onSettle?.(50);
  }, [snapshot, onSettle, isPlayback]);

  useEffect(() => {
    if (isPlayback && !playbackRef.current) playArcadeCue("enter");
    if (!isPlayback && playbackRef.current && snapshot?.phase !== "finished") {
      playArcadeCue(snapshot?.board.lastShot?.foul ? "lose" : "tap");
    }
    playbackRef.current = isPlayback;
  }, [isPlayback, snapshot?.board.lastShot?.foul, snapshot?.phase]);

  // 会话与服务端：开局一次就好。主题绝不能进这个依赖数组，否则切一次主题就重开一局。
  useEffect(() => {
    const server = new LocalBilliardsServer({
      matchId,
      mySeat: 0,
      onSnapshot: (next) => {
        setSnapshot(next);
        sessionRef.current?.applySnapshot(next);
      },
      onReject: (r: Rejection) =>
        setRejection(REJECT_TEXT[r.reason] ?? r.reason),
    });
    const session = new GameSession<BilliardsView>((intent: InputIntent) => {
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
  }, [matchId]);

  // 渲染器：只跟主题走。会话持有状态，换渲染器后会立刻用现有台面重绘。
  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    session.attachRenderer(
      new CanvasBilliardsRenderer({ onPlaybackChange: setIsPlayback }),
      host,
    );
    return () => session.detachRenderer();
  }, []);

  // 陪练机器人：轮到对手就出一杆。
  useEffect(() => {
    const server = serverRef.current;
    if (!server || !snapshot || snapshot.phase !== "playing") return;
    if (snapshot.activeSeat === snapshot.mySeat) return;

    // 即使 React 的播放状态更新被同一批快照合并，机器人也必须至少等完整的
    // 权威时间轴播完，不能用下一杆快照截断上一杆。
    const motionDelay = shotPlaybackDuration(
      snapshot.board.motion?.length ?? 0,
    );
    const timer = setTimeout(() => {
      const decision = chooseShotDecision(
        server.authoritativeState(),
        Math.random,
      );
      setBotNote(decision.explanation);
      server.playAsOpponent(decision.shot);
    }, botDelayMs + motionDelay);
    return () => clearTimeout(timer);
  }, [snapshot, botDelayMs]);

  const myTurn = snapshot ? canAct(snapshot) && !isPlayback : false;

  return (
    <div className="bro-billiards">
      {/* .bro-game-viewport 让玻璃护栏关掉这块区域内的模糊与投影：
          对局区帧率优先（glass.css §性能护栏） */}
      <section
        className={`bro-billiards__stage ${isPlayback ? "is-rolling" : ""} ${myTurn ? "is-my-turn" : ""}`}
        aria-label="美式八球球桌"
      >
        <div className="bro-billiards__stage-head" aria-hidden="true">
          <span>CLUB TABLE · 08</span>
          <span className="bro-billiards__live">LIVE MATCH</span>
        </div>
        <div className="bro-billiards__table bro-game-viewport" ref={hostRef} />
        <div className="bro-billiards__stage-foot" aria-hidden="true">
          <span>AMERICAN 8-BALL</span>
          <span>DRAG · AIM · RELEASE</span>
        </div>
      </section>

      <aside className="bro-billiards__panel" aria-label="对局信息">
        <div className="bro-billiards__panel-kicker">
          <span>MATCH CONTROL</span>
          <span className={myTurn ? "is-active" : ""}>
            {myTurn ? "YOUR TURN" : "WAITING"}
          </span>
        </div>
        <Status snapshot={snapshot} myTurn={myTurn} isPlayback={isPlayback} />
        {botNote && (
          <p className="bro-billiards__bot-note" aria-live="polite">
            AI 对手：{botNote}
          </p>
        )}

        {rejection && (
          <p className="bro-billiards__reject" role="alert">
            {rejection}
          </p>
        )}
      </aside>
    </div>
  );
}

function Status({
  snapshot,
  myTurn,
  isPlayback,
}: {
  snapshot: BilliardsSnapshot | null;
  myTurn: boolean;
  isPlayback: boolean;
}) {
  if (!snapshot) return <p className="bro-billiards__status">正在开球…</p>;

  const { myGroup, ballInHand, winner, lastShot } = snapshot.board;

  if (isPlayback) {
    return (
      <p className="bro-billiards__status" aria-live="polite">
        球正在滚动 —— 等待本杆结束
      </p>
    );
  }

  if (winner !== null) {
    return (
      <p className="bro-billiards__status bro-billiards__status--final">
        终局 · {winner === snapshot.mySeat ? "你赢了" : "对手赢了"}
      </p>
    );
  }

  return (
    <>
      <p className={`bro-billiards__status ${myTurn ? "is-active" : ""}`}>
        {myTurn
          ? ballInHand
            ? "持球在手 —— 先摆母球"
            : "轮到你了"
          : "对手思考中…"}
      </p>
      <div className="bro-billiards__group-card">
        <span className="bro-billiards__group-label">你的球组</span>
        <p className="bro-billiards__group">
          {myGroup ? GROUP_TEXT[myGroup] : "台面开放，先进先定"}
        </p>
        <div className="bro-billiards__ball-rack" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <i
              key={index}
              className={myGroup === "stripes" ? "is-stripe" : ""}
            />
          ))}
        </div>
      </div>
      {lastShot?.foul && (
        <p className="bro-billiards__hint">
          上一杆{lastShot.seat === snapshot.mySeat ? "你" : "对手"}犯规了
        </p>
      )}
      <p className="bro-billiards__hint">
        从母球拖出方向，拖得越远力度越大，松手出杆
      </p>
    </>
  );
}
