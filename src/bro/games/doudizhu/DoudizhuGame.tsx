/**
 * 斗地主对局页。
 *
 * 与围棋同一套骨架：会话与服务端由对局参数决定生命周期，渲染器由主题决定。
 * 两个 effect 依赖不同，切主题时只重挂渲染器，牌局原封不动。
 *
 * 页面不含任何规则判断——能不能叫、能不能出、谁赢，全在服务端那侧。它只做
 * 四件事：把快照喂给会话、把意图转给服务端、显示被拒的原因、把渲染器里的
 * 选牌状态镜像出来给按钮用。
 *
 * 按钮的可用性刻意跟 TUI 状态栏走同一套判断（`checkSelection` / `canPass`）：
 * 亮色下按钮灰着、暗色下状态栏却说这个键能按，是最难查的那类不一致。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { GameSession } from "../core/session";
import { LocalMatchmaking } from "../core/LocalMatchmaking";
import type { InputIntent } from "../core/types";
import { canAct } from "../core/types";
import type { Card, CardId } from "./logic";
import { canPass } from "./logic";
import { cardAccessibleLabel, cardAssetUrl } from "./card-assets";
import { CanvasDoudizhuRenderer } from "./render/canvas";
import type { SelectionSource } from "./render/selection";
import { cardsByIds, patternToBeat, selectionHint } from "./render/selection";
import { availableBids } from "./render/tui-text";
import { chooseBotDecision } from "./server/bot";
import type { Rejection } from "./server/local";
import { LocalDoudizhuServer } from "./server/local";
import type { DoudizhuAction, DoudizhuSnapshot, DoudizhuView } from "./view";
import { toIntent } from "./view";
import "./doudizhu.css";

/** 被拒原因的中文说法。服务端回的是稳定标识，展示文案在客户端。 */
const REJECT_TEXT: Record<string, string> = {
  not_your_turn: "还没轮到你",
  game_over: "本局已经结束",
  stale_version: "局面已更新，请重试",
  wrong_stage: "现在不是做这件事的时候",
  invalid_bid: "这个分不能叫",
  not_in_hand: "这张牌不在你手上",
  cannot_pass: "这一轮由你领出，必须出牌",
  empty: "一张牌都没选",
  unknown_pattern: "这几张凑不成牌型",
  cannot_beat: "压不过上家",
};

export interface DoudizhuGameProps {
  /** 本机玩家的座位。另外两个座位交给陪练机器人。 */
  readonly mySeat?: number;
  /** 洗牌种子。固定种子可复现同一副牌。 */
  readonly seed?: number;
  /** 陪练机器人的思考延时（毫秒）。设 0 即刻行动，便于测试。 */
  readonly botDelayMs?: number;
  /** 本地队列多久后用 AI 补位。 */
  readonly matchmakingDelayMs?: number;
  /** 整局获胜时上报一次正积分；匹配与输局不触发。 */
  readonly onSettle?: (points: number) => void;
}

export function DoudizhuGame({
  mySeat = 0,
  seed,
  botDelayMs = 600,
  matchmakingDelayMs = 900,
  onSettle,
}: DoudizhuGameProps) {
  return (
    <LocalMatchmaking
      gameId="doudizhu"
      seatCount={3}
      playerNames={DOUDIZHU_BOT_NAMES}
      fillDelayMs={matchmakingDelayMs}
    >
      {(match) => (
        <DoudizhuTable
          key={match.matchId}
          matchId={match.matchId ?? "local-demo-pending"}
          mySeat={mySeat}
          seed={seed}
          botDelayMs={botDelayMs}
          onSettle={onSettle}
        />
      )}
    </LocalMatchmaking>
  );
}

const DOUDIZHU_BOT_NAMES = ["阿策", "小顺"] as const;

function DoudizhuTable({
  matchId,
  mySeat,
  seed,
  botDelayMs,
  onSettle,
}: Required<Pick<DoudizhuGameProps, "mySeat" | "botDelayMs">> &
  Pick<DoudizhuGameProps, "seed" | "onSettle"> & {
    readonly matchId: string;
  }) {
  const isDark = useDarkMode();
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession<DoudizhuView> | null>(null);
  const serverRef = useRef<LocalDoudizhuServer | null>(null);
  const rendererRef = useRef<SelectionSource | null>(null);
  const settledRef = useRef(false);

  const [snapshot, setSnapshot] = useState<DoudizhuSnapshot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly CardId[]>([]);
  const [botNote, setBotNote] = useState<string | null>(null);

  useEffect(() => {
    if (settledRef.current || snapshot?.phase !== "finished") return;
    settledRef.current = true;
    const score = snapshot.board.result?.scores[snapshot.mySeat ?? -1] ?? 0;
    if (score > 0) onSettle?.(score);
  }, [snapshot, onSettle]);

  // 会话与服务端：只跟牌局参数走。主题绝不能进这个依赖数组，
  // 否则切一次主题就重开一局。
  useEffect(() => {
    const server = new LocalDoudizhuServer({
      matchId,
      mySeat,
      seed,
      onSnapshot: (next) => {
        setSnapshot(next);
        sessionRef.current?.applySnapshot(next);
      },
      onReject: (r: Rejection) =>
        setRejection(REJECT_TEXT[r.reason] ?? r.reason),
    });
    const session = new GameSession<DoudizhuView>((intent: InputIntent) => {
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
  }, [matchId, mySeat, seed]);

  // 渲染器：只跟主题走。会话持有状态，换渲染器后会立刻用现有局面重绘。
  // 选牌是渲染器的本地状态，切主题会清空——重新点一次即可，比把选牌塞进
  // 快照要干净得多。
  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;

    const renderer = new CanvasDoudizhuRenderer({
      onSelectionChange: setSelected,
      dark: isDark,
    });
    rendererRef.current = renderer;
    setSelected([]);
    session.attachRenderer(renderer, host);

    return () => {
      session.detachRenderer();
      rendererRef.current = null;
    };
  }, [isDark, mySeat, seed]);

  // 陪练机器人：轮到别人就替他行动。它读的是 viewFor(seat)——和真人拿到的
  // 一样是裁剪过的视图，看不到别家的牌；提交也走 submitAs，与真人同一条
  // 校验路径。
  useEffect(() => {
    const server = serverRef.current;
    if (!server || !snapshot || snapshot.phase !== "playing") return;
    const seat = snapshot.activeSeat;
    if (seat === null || seat === snapshot.mySeat) return;

    const timer = setTimeout(() => {
      const decision = chooseBotDecision(
        server.viewFor(seat),
        seat,
        Math.random,
      );
      setBotNote(`AI ${seat + 1}：${decision.explanation}`);
      server.submitAs(
        seat,
        toIntent(decision.action, snapshot.matchId, snapshot.version),
      );
    }, botDelayMs);
    return () => clearTimeout(timer);
  }, [snapshot, botDelayMs]);

  const send = useCallback((action: DoudizhuAction) => {
    const state = sessionRef.current?.currentState();
    if (!state || !canAct(state)) return;
    setRejection(null);
    serverRef.current?.submit(toIntent(action, state.matchId, state.version));
  }, []);

  const view = snapshot?.board ?? null;
  const myTurn = snapshot ? canAct(snapshot) : false;

  const picked = useMemo(
    () => (view ? cardsByIds(view.hand, selected) : []),
    [view, selected],
  );
  const toBeat = useMemo(() => (view ? patternToBeat(view) : null), [view]);
  const hint = selectionHint(picked, toBeat);
  const canPlay = picked.length > 0 && hint === null;

  if (!view || !snapshot) {
    return (
      <div className="bro-doudizhu">
        <div className="bro-doudizhu__table bro-game-viewport" ref={hostRef} />
      </div>
    );
  }

  return (
    <div className="bro-doudizhu">
      {/* .bro-game-viewport 让玻璃护栏关掉这块区域内的模糊与投影：
          对局区帧率优先（glass.css §性能护栏） */}
      <div className="bro-doudizhu__table bro-game-viewport" ref={hostRef} />

      <div className="bro-doudizhu__panel">
        <Status view={view} myTurn={myTurn} />
        {botNote && (
          <p className="bro-doudizhu__bot-note" aria-live="polite">
            {botNote}
          </p>
        )}
        {rejection && (
          <p className="bro-doudizhu__reject" role="alert">
            {rejection}
          </p>
        )}

        {view.stage === "bidding" && (
          <div className="bro-doudizhu__actions">
            {availableBids(view).map((bid) => (
              <button
                key={bid}
                type="button"
                className="bro-doudizhu__button"
                disabled={!myTurn}
                onClick={() => send({ type: "bid", bid })}
              >
                {bid === 0 ? "不叫" : `叫 ${bid} 分`}
              </button>
            ))}
          </div>
        )}

        {view.stage === "playing" && (
          <>
            {/* 提示只在选了牌却出不去时出现。一张没选就弹「你没选牌」
                是在骂用户 */}
            {hint && <p className="bro-doudizhu__hint">{hint}</p>}
            <div className="bro-doudizhu__actions">
              <button
                type="button"
                className="bro-doudizhu__button bro-doudizhu__button--primary"
                disabled={!myTurn || !canPlay}
                onClick={() => {
                  send({ type: "play", cardIds: selected });
                  setSelected([]);
                  rendererRef.current?.clearSelection();
                }}
              >
                出牌
              </button>
              {/* 自己领出的一轮不能过，此时按钮必须是灰的——能按却毫无
                  反应，玩家只会以为程序卡了 */}
              <button
                type="button"
                className="bro-doudizhu__button"
                disabled={!myTurn || !canPass(toBeat)}
                onClick={() => {
                  rendererRef.current?.clearSelection();
                  setSelected([]);
                  send({ type: "pass" });
                }}
              >
                不出
              </button>
              <button
                type="button"
                className="bro-doudizhu__button"
                disabled={selected.length === 0}
                onClick={() => {
                  rendererRef.current?.clearSelection();
                  setSelected([]);
                }}
              >
                重选
              </button>
            </div>
          </>
        )}
      </div>

      <HandRail
        hand={view.hand}
        selected={selected}
        onToggle={(id) => rendererRef.current?.toggleSelection(id)}
      />
    </div>
  );
}

function HandRail({
  hand,
  selected,
  onToggle,
}: {
  hand: readonly Card[];
  selected: readonly CardId[];
  onToggle: (id: CardId) => void;
}) {
  return (
    <section className="bro-doudizhu__hand-rail" aria-label="我的手牌">
      <div className="bro-doudizhu__hand-head">
        <span>MY HAND</span>
        <strong>{hand.length} 张</strong>
      </div>
      <div className="bro-doudizhu__hand-cards">
        {hand.map((card) => {
          const active = selected.includes(card.id);
          return (
            <button
              key={card.id}
              type="button"
              className={active ? "is-selected" : ""}
              aria-label={`${active ? "取消选择" : "选择"}${cardAccessibleLabel(card)}`}
              aria-pressed={active}
              onClick={() => onToggle(card.id)}
            >
              <img
                src={cardAssetUrl(card)}
                alt={cardAccessibleLabel(card)}
                draggable={false}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Status({ view, myTurn }: { view: DoudizhuView; myTurn: boolean }) {
  if (view.result) {
    const { result } = view;
    const side = result.winnerSide === "landlord" ? "地主胜" : "农民胜";
    const spring =
      result.spring === "landlord"
        ? " · 春天"
        : result.spring === "farmer"
          ? " · 反春"
          : "";
    return (
      <>
        <p className="bro-doudizhu__status">
          本局结束 · {side}
          {spring}
        </p>
        <p className="bro-doudizhu__meta bro-tabular">
          {result.multiplier} 倍 · 本局积分 {formatScores(result.scores)}
        </p>
      </>
    );
  }

  const stage = view.stage === "bidding" ? "叫地主" : "出牌";
  return (
    <>
      <p className="bro-doudizhu__status">
        {stage} · {myTurn ? "轮到你了" : "等待其他玩家…"}
      </p>
      <p className="bro-doudizhu__meta bro-tabular">
        {view.bid === null ? "底分未定" : `底分 ${view.bid}`}
        {view.multiplier === null ? "" : ` · 倍数 ${view.multiplier}`}
        {view.bombs + (view.rocket ? 1 : 0) > 0
          ? ` · 炸 ${view.bombs + (view.rocket ? 1 : 0)}`
          : ""}
      </p>
    </>
  );
}

/** 积分是娱乐用的计数，与现金无关。正负都写出来，零和一眼可见。 */
function formatScores(scores: readonly number[]): string {
  return scores.map((s) => (s > 0 ? `+${s}` : String(s))).join(" / ");
}
