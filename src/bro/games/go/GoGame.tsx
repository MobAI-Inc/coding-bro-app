/**
 * 围棋对局页。
 *
 * 这里是「主题切换不重建对局」那条约束的落地处：会话与服务端由 `size`
 * 决定生命周期，渲染器由主题决定。两个 effect 依赖不同，切主题时只会
 * 重挂渲染器，棋局原封不动。
 *
 * 页面本身不含任何规则判断——能不能落子、落哪、提谁，全在服务端那侧。
 * 页面只做三件事：把快照喂给会话、把意图转给服务端、显示被拒的原因。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { GameSession } from "../core/session";
import type { InputIntent } from "../core/types";
import { canAct, renderModeForTheme } from "../core/types";
import type { BoardSize } from "./logic";
import { CanvasGoRenderer } from "./render/canvas";
import { TuiGoRenderer } from "./render/tui";
import { chooseMove } from "./server/bot";
import type { Rejection } from "./server/local";
import { LocalGoServer } from "./server/local";
import type { GoSnapshot, GoView } from "./view";
import { GO_INTENT, playerOfSeat } from "./view";
import "./go.css";

/** 被拒原因的中文说法。服务端回的是稳定标识，展示文案在客户端。 */
const REJECT_TEXT: Record<string, string> = {
  occupied: "这里已经有子了",
  out_of_bounds: "落点在棋盘外",
  suicide: "不能自杀——这一手下完己方整块都没气了",
  ko: "劫争禁着，先在别处走一手",
  not_your_turn: "还没轮到你",
  game_over: "对局已经结束",
  stale_version: "局面已更新，请重试",
};

export interface GoGameProps {
  readonly size?: BoardSize;
  /** 陪练机器人的思考延时（毫秒）。设 0 即刻落子，便于测试。 */
  readonly botDelayMs?: number;
}

export function GoGame({ size = 19, botDelayMs = 450 }: GoGameProps) {
  const isDark = useDarkMode();
  const mode = renderModeForTheme(isDark ? "dark" : "light");

  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession<GoView> | null>(null);
  const serverRef = useRef<LocalGoServer | null>(null);

  const [snapshot, setSnapshot] = useState<GoSnapshot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  // 会话与服务端：只跟 size 走。主题变化绝不能进这个依赖数组，
  // 否则切一次主题就重开一局。
  useEffect(() => {
    const server = new LocalGoServer({
      size,
      mySeat: 0,
      onSnapshot: (next) => {
        setSnapshot(next);
        sessionRef.current?.applySnapshot(next);
      },
      onReject: (r: Rejection) =>
        setRejection(REJECT_TEXT[r.reason] ?? r.reason),
    });
    const session = new GameSession<GoView>((intent: InputIntent) => {
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
  }, [size]);

  // 渲染器：只跟主题走。会话持有状态，换渲染器后会立刻用现有局面重绘。
  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    session.attachRenderer(
      mode === "tui" ? new TuiGoRenderer() : new CanvasGoRenderer(),
      host,
    );
    return () => session.detachRenderer();
  }, [mode, size]);

  // 陪练机器人：轮到对手就走一手。
  useEffect(() => {
    const server = serverRef.current;
    if (!server || !snapshot || snapshot.phase !== "playing") return;
    if (snapshot.activeSeat === snapshot.mySeat) return;

    const timer = setTimeout(() => {
      const state = server.authoritativeState();
      server.playAsOpponent(chooseMove(state, playerOfSeat(1), Math.random));
    }, botDelayMs);
    return () => clearTimeout(timer);
  }, [snapshot, botDelayMs]);

  const onPass = useCallback(() => {
    const session = sessionRef.current;
    const state = session?.currentState();
    if (!session || !state || !canAct(state)) return;
    setRejection(null);
    serverRef.current?.submit({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type: GO_INTENT.pass,
      payload: {},
    });
  }, []);

  const myTurn = snapshot ? canAct(snapshot) : false;

  return (
    <div className="bro-go">
      {/* .bro-game-viewport 让玻璃护栏关掉这块区域内的模糊与投影：
          对局区帧率优先（glass.css §性能护栏） */}
      <div className="bro-go__board bro-game-viewport" ref={hostRef} />

      <div className="bro-go__panel">
        <Status snapshot={snapshot} myTurn={myTurn} />

        {rejection && (
          <p className="bro-go__reject" role="alert">
            {rejection}
          </p>
        )}

        <button
          type="button"
          className="bro-go__pass"
          onClick={onPass}
          disabled={!myTurn}
        >
          虚手
        </button>
      </div>
    </div>
  );
}

function Status({
  snapshot,
  myTurn,
}: {
  snapshot: GoSnapshot | null;
  myTurn: boolean;
}) {
  if (!snapshot) return <p className="bro-go__status">正在开局…</p>;

  const { captures, score, passes } = snapshot.board;

  if (score) {
    const verdict =
      score.winner === null
        ? "和棋"
        : `${score.winner === 1 ? "黑" : "白"}胜 ${Math.abs(score.margin)} 目`;
    return <p className="bro-go__status">终局 · {verdict}</p>;
  }

  return (
    <>
      <p className="bro-go__status">{myTurn ? "轮到你了" : "对手思考中…"}</p>
      <p className="bro-go__captures">
        提子 黑 {captures.black} · 白 {captures.white}
      </p>
      {passes === 1 && (
        <p className="bro-go__hint">对方虚手，你再虚一手即终局</p>
      )}
    </>
  );
}
