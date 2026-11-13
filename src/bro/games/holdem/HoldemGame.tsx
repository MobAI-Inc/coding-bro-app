import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  CircleDollarSign,
  Coins,
  Crown,
  Radio,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { LocalMatchmaking } from "../core/LocalMatchmaking";
import { DecisionClock } from "../core/DecisionClock";
import { TableReward } from "../core/TableReward";
import { playArcadeCue } from "../core/audio";
import {
  PLAYER_DECISION_MS,
  tableDecisionDelay,
  type DecisionWindow,
} from "../core/decision-timing";
import type { MatchmakingSnapshot } from "../core/matchmaking";
import type { GameRealtimeAccess } from "../core/realtime";
import {
  applyHoldemAction,
  chooseHoldemTableAction,
  createHoldemGame,
  evaluateHoldemHand,
  legalActions,
  nextHoldemHand,
  type HoldemAction,
  type HoldemState,
  type PokerCard,
} from "./logic";
import {
  pokerCardAssetUrl,
  pokerCardBackUrl,
  pokerCardLabel,
} from "./card-assets";
import "./holdem.css";

const TABLE_PLAYER_NAMES = ["林川", "Mika"] as const;
const STAGE_LABEL = {
  preflop: "翻牌前",
  flop: "翻牌圈",
  turn: "转牌圈",
  river: "河牌圈",
  complete: "摊牌",
} as const;

export interface HoldemGameProps {
  readonly seed?: number;
  readonly participantDecisionMs?: number;
  readonly matchmakingDelayMs?: number;
  readonly onSettle?: (points: number) => void;
  readonly onServerSettled?: () => void;
  readonly room?: HoldemRoomConfig;
  readonly entryPoints?: number;
  readonly realtime?: GameRealtimeAccess | null;
}

export interface HoldemRoomConfig {
  readonly id: string;
  readonly name: string;
  readonly startingStack: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly winPoints: number;
}

export const DEFAULT_HOLDEM_ROOM: HoldemRoomConfig = {
  id: "holdem-garage",
  name: "车库桌",
  startingStack: 500,
  smallBlind: 10,
  bigBlind: 20,
  winPoints: 170,
};

export type HoldemServerPhase =
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "settled";

export type HoldemServerOutcome = "win" | "loss" | "tie" | null;
export type HoldemSettlementState = "pending" | "retrying" | "settled" | null;

export interface HoldemServerSeat {
  readonly seat: number;
  readonly name: string;
  readonly connected: boolean;
  readonly hole: readonly PokerCard[];
  readonly stack: number;
  readonly committedRound: number;
  readonly committedHand: number;
  readonly status: string;
  readonly outcome: HoldemServerOutcome;
  readonly settlementState: HoldemSettlementState;
}

export interface HoldemServerLegal {
  readonly fold: boolean;
  readonly check: boolean;
  readonly call: number;
  readonly minRaiseTo: number | null;
  readonly maxRaiseTo: number;
}

export interface HoldemServerSnapshot {
  readonly gameId: "holdem";
  readonly version: number;
  readonly roundId: number;
  readonly phase: HoldemServerPhase;
  readonly phaseEndsInMs: number;
  readonly selfSeat: number;
  readonly activeSeat: number | null;
  readonly dealerSeat: number;
  readonly currentBet: number;
  readonly minRaise: number;
  readonly pot: number;
  readonly community: readonly PokerCard[];
  readonly seats: readonly HoldemServerSeat[];
  readonly legal: HoldemServerLegal;
}

export type HoldemServerAction =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | { readonly type: "call" }
  | { readonly type: "raise"; readonly to: number };

export function HoldemGame({
  seed,
  participantDecisionMs,
  matchmakingDelayMs = 900,
  onSettle,
  onServerSettled,
  room = DEFAULT_HOLDEM_ROOM,
  entryPoints,
  realtime,
}: HoldemGameProps) {
  return (
    <LocalMatchmaking
      gameId="holdem"
      roomId={room.id}
      seatCount={3}
      playerNames={TABLE_PLAYER_NAMES}
      fillDelayMs={matchmakingDelayMs}
      realtime={realtime}
    >
      {(match) => (
        <MotionConfig reducedMotion="user">
          {realtime ? (
            <AuthoritativeHoldemTable
              key={match.matchId}
              entryPoints={entryPoints ?? room.bigBlind}
              match={match}
              onServerSettled={onServerSettled}
              room={room}
            />
          ) : (
            <HoldemTable
              key={match.matchId}
              seed={seed}
              participantDecisionMs={participantDecisionMs}
              onSettle={onSettle}
              room={room}
            />
          )}
        </MotionConfig>
      )}
    </LocalMatchmaking>
  );
}

interface ServerFeedItem {
  readonly id: string;
  readonly label: string;
  readonly seat: number | null;
  readonly amount: number;
}

export function AuthoritativeHoldemTable({
  entryPoints,
  match,
  onServerSettled,
  room,
}: {
  readonly entryPoints: number;
  readonly match: MatchmakingSnapshot;
  readonly onServerSettled?: () => void;
  readonly room: HoldemRoomConfig;
}) {
  const state = holdemServerState(match.serverState);
  const [raiseTo, setRaiseTo] = useState(0);
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feed, setFeed] = useState<readonly ServerFeedItem[]>([]);
  const previousState = useRef<HoldemServerSnapshot | null>(null);
  const notifiedRounds = useRef(new Set<number>());

  const seats = state?.seats.length ? state.seats : matchmakingSeats(match);
  const selfSeat =
    state?.selfSeat ?? seats.find((seat) => seat.name === "YOU")?.seat ?? 0;
  const hero = seats.find((seat) => seat.seat === selfSeat) ?? seats[0];
  const opponents = seats.filter((seat) => seat.seat !== hero?.seat);
  const left = opponents[0];
  const right = opponents[1];
  const myTurn = Boolean(
    state &&
      state.phase !== "settled" &&
      state.activeSeat === state.selfSeat &&
      match.sendAction,
  );
  const waitingForServer = pendingVersion !== null;

  const decisionWindow = useMemo<DecisionWindow | null>(() => {
    if (
      !state ||
      state.phase === "settled" ||
      state.activeSeat === null ||
      state.phaseEndsInMs <= 0
    ) {
      return null;
    }
    return {
      key: `holdem-server-${match.matchId ?? "match"}-${state.roundId}-${state.version}-${state.activeSeat}`,
      seat: state.activeSeat,
      startedAt: Date.now(),
      durationMs: state.phaseEndsInMs,
    };
  }, [
    match.matchId,
    state?.activeSeat,
    state?.phase,
    state?.phaseEndsInMs,
    state?.roundId,
    state?.version,
  ]);

  useEffect(() => {
    if (!state) return;
    const previous = previousState.current;
    previousState.current = state;

    if (!previous || previous.roundId !== state.roundId) {
      setFeed([
        {
          id: `${state.roundId}-${state.version}-start`,
          label: `第 ${state.roundId} 手已由服务器发牌`,
          seat: null,
          amount: 0,
        },
      ]);
      return;
    }
    if (state.version <= previous.version) return;
    const additions = describeServerTransition(previous, state);
    if (additions.length > 0) {
      setFeed((current) => [...current, ...additions].slice(-5));
    }
  }, [state]);

  useEffect(() => {
    if (pendingVersion !== null && state && state.version > pendingVersion) {
      setPendingVersion(null);
    }
  }, [pendingVersion, state]);

  useEffect(() => {
    if (
      !state ||
      hero?.settlementState !== "settled" ||
      notifiedRounds.current.has(state.roundId)
    ) {
      return;
    }
    notifiedRounds.current.add(state.roundId);
    playArcadeCue(
      hero.outcome === "win"
        ? "win"
        : hero.outcome === "loss"
          ? "lose"
          : "enter",
    );
    onServerSettled?.();
  }, [hero?.outcome, hero?.settlementState, onServerSettled, state]);

  useEffect(() => {
    const minimum = state?.legal.minRaiseTo;
    const maximum = state?.legal.maxRaiseTo;
    if (minimum === null || minimum === undefined || maximum === undefined) {
      return;
    }
    setRaiseTo((current) =>
      current < minimum || current > maximum ? minimum : current,
    );
  }, [state?.legal.maxRaiseTo, state?.legal.minRaiseTo, state?.roundId]);

  const sendAction = async (action: HoldemServerAction) => {
    if (!match.sendAction || !state || !myTurn || waitingForServer) return;
    setActionError(null);
    setPendingVersion(state.version);
    playArcadeCue("tap");
    try {
      await match.sendAction(1, action);
    } catch (error) {
      setPendingVersion(null);
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !state ||
        !myTurn ||
        waitingForServer ||
        event.repeat ||
        (event.target as HTMLElement | null)?.matches("input, button")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "f" && state.legal.fold) void sendAction({ type: "fold" });
      if (key === "c") {
        if (state.legal.check) void sendAction({ type: "check" });
        else if (state.legal.call > 0) void sendAction({ type: "call" });
      }
      if (key === "r" && state.legal.minRaiseTo !== null) {
        void sendAction({ type: "raise", to: raiseTo });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [myTurn, raiseTo, state, waitingForServer]);

  const latestAction = feed.at(-1) ?? null;
  const showdown = state?.phase === "settled";
  const activeName = state
    ? (seats.find((seat) => seat.seat === state.activeSeat)?.name ?? null)
    : null;

  return (
    <main className="bro-holdem bro-game-viewport">
      <section
        className="bro-holdem__table"
        data-authoritative=""
        aria-label="德州扑克牌桌"
      >
        <div className="bro-holdem__felt-lines" aria-hidden="true" />
        <header className="bro-holdem__hud">
          <div>
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{room.name}</span>
            <i>SERVER AUTHORITATIVE</i>
          </div>
          <strong>{state ? serverStageLabel(state.phase) : "同步中"}</strong>
          <span>
            第 {state?.roundId ?? "—"} 手 · 入场 {entryPoints}
          </span>
        </header>

        {left && (
          <Seat
            player={left}
            position="left"
            dealer={state?.dealerSeat === left.seat}
            active={state?.activeSeat === left.seat}
            thinking={state?.activeSeat === left.seat}
            decisionWindow={
              decisionWindow?.seat === left.seat ? decisionWindow : null
            }
            reveal={Boolean(showdown && left.hole.length)}
            handNumber={state?.roundId ?? 0}
          />
        )}
        {right && (
          <Seat
            player={right}
            position="right"
            dealer={state?.dealerSeat === right.seat}
            active={state?.activeSeat === right.seat}
            thinking={state?.activeSeat === right.seat}
            decisionWindow={
              decisionWindow?.seat === right.seat ? decisionWindow : null
            }
            reveal={Boolean(showdown && right.hole.length)}
            handNumber={state?.roundId ?? 0}
          />
        )}

        <div className="bro-holdem__center">
          <div className="bro-holdem__betting-summary">
            <div
              className="bro-holdem__pot"
              key={`${state?.roundId ?? 0}-${state?.pot ?? 0}`}
            >
              <CircleDollarSign size={15} aria-hidden="true" />
              底池 <strong>{state?.pot ?? 0}</strong>
            </div>
            <span>
              当前注额 <strong>{state?.currentBet ?? 0}</strong>
            </span>
          </div>
          <div className="bro-holdem__community" aria-label="公共牌">
            {(state?.community ?? []).map((card, index) => (
              <PlayingCard
                key={`${state?.roundId ?? 0}-${card.id}`}
                card={card}
                index={index}
                className="bro-holdem__community-card"
              />
            ))}
            {Array.from({
              length: Math.max(0, 5 - (state?.community.length ?? 0)),
            }).map((_, index) => (
              <div className="bro-holdem__card-slot" key={`slot-${index}`} />
            ))}
          </div>
          <div
            className="bro-holdem__action-feed-list"
            aria-label="牌桌操作记录"
            aria-live="polite"
          >
            {feed.length ? (
              feed.map((item, index) => (
                <motion.p
                  className="bro-holdem__action-feed"
                  data-latest={index === feed.length - 1 ? "" : undefined}
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {item.label}
                </motion.p>
              ))
            ) : (
              <p className="bro-holdem__action-feed" data-latest="">
                正在同步云端牌桌…
              </p>
            )}
          </div>
        </div>

        <div className="bro-holdem__deck" aria-hidden="true">
          <img src={pokerCardBackUrl()} alt="" />
          <span>SERVER</span>
        </div>

        <AnimatePresence>
          {latestAction?.amount ? (
            <motion.span
              key={latestAction.id}
              className="bro-holdem__flying-chip"
              data-seat={latestAction.seat ?? undefined}
              initial={{
                opacity: 1,
                scale: 0.75,
                ...chipOrigin(latestAction.seat ?? 0),
              }}
              animate={{ opacity: 0, scale: 1.2, x: 0, y: 0 }}
              transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {latestAction.amount}
            </motion.span>
          ) : null}
        </AnimatePresence>

        <AuthoritativeActionDock
          state={state}
          hero={hero}
          activeName={activeName}
          canAct={myTurn}
          decisionWindow={
            decisionWindow?.seat === state?.selfSeat ? decisionWindow : null
          }
          raiseTo={raiseTo}
          onRaiseTo={setRaiseTo}
          onAction={(action) => void sendAction(action)}
          sending={waitingForServer}
          actionError={actionError ?? match.error}
        />

        {hero && (
          <Seat
            player={hero}
            position="hero"
            dealer={state?.dealerSeat === hero.seat}
            active={state?.activeSeat === hero.seat}
            thinking={false}
            decisionWindow={
              decisionWindow?.seat === hero.seat ? decisionWindow : null
            }
            reveal
            handNumber={state?.roundId ?? 0}
          />
        )}

        <AnimatePresence>
          {state?.phase === "settled" && hero ? (
            <AuthoritativeResultOverlay
              entryPoints={entryPoints}
              state={state}
              hero={hero}
            />
          ) : null}
        </AnimatePresence>
      </section>
    </main>
  );
}

function matchmakingSeats(match: MatchmakingSnapshot): HoldemServerSeat[] {
  return Array.from({ length: 3 }, (_, seat) => {
    const matched = match.seats.find((item) => item.seat === seat);
    return {
      seat,
      name: matched?.name ?? (seat === 0 ? "YOU" : `玩家 ${seat + 1}`),
      connected: matched?.kind === "player",
      hole: [],
      stack: 0,
      committedRound: 0,
      committedHand: 0,
      status: "waiting",
      outcome: null,
      settlementState: null,
    };
  });
}

function holdemServerState(value: unknown): HoldemServerSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as HoldemServerSnapshot;
  if (
    raw.gameId !== "holdem" ||
    !Number.isFinite(raw.version) ||
    !Number.isFinite(raw.roundId) ||
    !isServerPhase(raw.phase) ||
    !Array.isArray(raw.community) ||
    !Array.isArray(raw.seats) ||
    !raw.legal ||
    typeof raw.legal !== "object"
  ) {
    return null;
  }
  return {
    ...raw,
    community: raw.community
      .map(serverPokerCard)
      .filter((card): card is PokerCard => card !== null),
    seats: raw.seats.map((seat) => ({
      ...seat,
      hole: Array.isArray(seat.hole)
        ? seat.hole
            .map(serverPokerCard)
            .filter(
              (card: PokerCard | null): card is PokerCard => card !== null,
            )
        : [],
    })),
  };
}

function isServerPhase(value: unknown): value is HoldemServerPhase {
  return ["preflop", "flop", "turn", "river", "settled"].includes(
    String(value),
  );
}

function serverPokerCard(value: unknown): PokerCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const suitMap: Readonly<Record<string, PokerCard["suit"]>> = {
    S: "S",
    H: "H",
    D: "D",
    C: "C",
    spades: "S",
    hearts: "H",
    diamonds: "D",
    clubs: "C",
    "♠": "S",
    "♥": "H",
    "♦": "D",
    "♣": "C",
  };
  const rankMap: Readonly<Record<string, PokerCard["rank"]>> = {
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
  };
  const suit = suitMap[String(raw.suit)];
  const numericRank = Number(raw.rank);
  const rank = Number.isInteger(numericRank)
    ? numericRank
    : rankMap[String(raw.rank).toUpperCase()];
  if (!suit || !rank || rank < 2 || rank > 14) return null;
  return {
    id: typeof raw.id === "string" ? raw.id : `${rank}${suit}`,
    suit,
    rank: rank as PokerCard["rank"],
  };
}

function serverStageLabel(phase: HoldemServerPhase): string {
  return phase === "settled" ? "摊牌结算" : STAGE_LABEL[phase];
}

function describeServerTransition(
  previous: HoldemServerSnapshot,
  current: HoldemServerSnapshot,
): ServerFeedItem[] {
  const additions: ServerFeedItem[] = [];
  const actedSeat = previous.activeSeat;
  const before = previous.seats.find((seat) => seat.seat === actedSeat);
  const after = current.seats.find((seat) => seat.seat === actedSeat);
  if (actedSeat !== null && before && after) {
    const amount = Math.max(0, after.committedHand - before.committedHand);
    if (!isFolded(before.status) && isFolded(after.status)) {
      additions.push({
        id: `${current.roundId}-${current.version}-fold`,
        label: `${after.name} 弃牌`,
        seat: actedSeat,
        amount: 0,
      });
    } else if (amount > 0) {
      const raised =
        current.currentBet > previous.currentBet &&
        after.committedRound === current.currentBet;
      additions.push({
        id: `${current.roundId}-${current.version}-${raised ? "raise" : "call"}`,
        label: raised
          ? `${after.name} 加注到 ${after.committedRound}`
          : `${after.name} 跟注 ${amount}`,
        seat: actedSeat,
        amount,
      });
    } else if (
      current.phase === previous.phase &&
      current.activeSeat !== previous.activeSeat &&
      before.committedRound >= previous.currentBet
    ) {
      additions.push({
        id: `${current.roundId}-${current.version}-check`,
        label: `${after.name} 过牌`,
        seat: actedSeat,
        amount: 0,
      });
    }
  }

  if (current.phase !== previous.phase) {
    const label =
      current.phase === "settled"
        ? settlementFeedLabel(current)
        : `进入${serverStageLabel(current.phase)}`;
    additions.push({
      id: `${current.roundId}-${current.version}-${current.phase}`,
      label,
      seat: null,
      amount: 0,
    });
  }
  return additions;
}

function settlementFeedLabel(state: HoldemServerSnapshot): string {
  const winners = state.seats
    .filter((seat) => seat.outcome === "win" || seat.outcome === "tie")
    .map((seat) => seat.name)
    .join(" / ");
  return winners ? `${winners} 赢得底池 ${state.pot}` : `本手进入结算`;
}

function AuthoritativeActionDock({
  state,
  hero,
  activeName,
  canAct,
  decisionWindow,
  raiseTo,
  onRaiseTo,
  onAction,
  sending,
  actionError,
}: {
  readonly state: HoldemServerSnapshot | null;
  readonly hero: HoldemServerSeat | undefined;
  readonly activeName: string | null;
  readonly canAct: boolean;
  readonly decisionWindow: DecisionWindow | null;
  readonly raiseTo: number;
  readonly onRaiseTo: (value: number) => void;
  readonly onAction: (action: HoldemServerAction) => void;
  readonly sending: boolean;
  readonly actionError: string | null;
}) {
  const legal: HoldemServerLegal = state?.legal ?? {
    fold: false,
    check: false,
    call: 0,
    minRaiseTo: null,
    maxRaiseTo: 0,
  };
  const raisePresets = state ? getServerRaisePresets(state) : [];
  const status = !state
    ? "同步云端牌桌"
    : sending
      ? "等待服务器确认"
      : canAct
        ? "轮到你"
        : state.phase === "settled"
          ? "本手已结束"
          : `${activeName ?? "其他玩家"} 行动中`;
  return (
    <div className="bro-holdem__actions" data-visible={canAct ? "" : undefined}>
      <div className="bro-holdem__turn-copy" aria-live="polite">
        <span>{status}</span>
        {canAct && decisionWindow && (
          <DecisionClock
            key={decisionWindow.key}
            window={decisionWindow}
            label="服务端倒计时"
          />
        )}
        <small>
          {sending
            ? "操作已发送，牌桌只接受服务端新快照"
            : canAct
              ? legal.call > 0
                ? `跟注需要 ${legal.call}`
                : "可以过牌免费看下一张"
              : "所有行动、发牌与结算均由服务器裁定"}
        </small>
      </div>
      <div className="bro-holdem__my-stake" aria-label="我的下注明细">
        <span>
          本轮下注 <strong>{hero?.committedRound ?? 0}</strong>
        </span>
        <span>
          本手投入 <strong>{hero?.committedHand ?? 0}</strong>
        </span>
        <span>
          剩余筹码 <strong>{hero?.stack ?? 0}</strong>
        </span>
      </div>
      <div className="bro-holdem__action-buttons">
        <button
          type="button"
          className="bro-holdem__button bro-holdem__button--danger"
          disabled={!canAct || sending || !legal.fold}
          onClick={() => onAction({ type: "fold" })}
        >
          <span>弃牌</span>
          <small>F</small>
        </button>
        {legal.check ? (
          <button
            type="button"
            className="bro-holdem__button"
            disabled={!canAct || sending}
            onClick={() => onAction({ type: "check" })}
          >
            <span>过牌</span>
            <small>无需投入</small>
          </button>
        ) : (
          <button
            type="button"
            className="bro-holdem__button"
            disabled={!canAct || sending || legal.call <= 0}
            onClick={() => onAction({ type: "call" })}
          >
            <span>跟注</span>
            <small>{legal.call} 筹码</small>
          </button>
        )}
        <button
          type="button"
          className="bro-holdem__button bro-holdem__button--primary"
          disabled={!canAct || sending || legal.minRaiseTo === null}
          onClick={() => onAction({ type: "raise", to: raiseTo })}
        >
          <span>加注</span>
          <small>{raiseTo} 筹码</small>
        </button>
      </div>
      {legal.minRaiseTo !== null && state && (
        <div className="bro-holdem__raise-panel">
          <div className="bro-holdem__raise-presets" aria-label="快捷加注">
            {raisePresets.map((preset) => (
              <button
                type="button"
                key={preset.label}
                disabled={!canAct || sending}
                data-selected={raiseTo === preset.value ? "" : undefined}
                onClick={() => onRaiseTo(preset.value)}
              >
                <Coins size={13} aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          <label className="bro-holdem__raise-control">
            <span>加到</span>
            <input
              aria-label="加注筹码"
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={Math.max(1, state.minRaise)}
              value={Math.min(
                Math.max(raiseTo, legal.minRaiseTo),
                legal.maxRaiseTo,
              )}
              disabled={!canAct || sending}
              onChange={(event) => onRaiseTo(Number(event.target.value))}
            />
            <output>{raiseTo}</output>
          </label>
        </div>
      )}
      {actionError ? (
        <p className="bro-holdem__action-error" role="alert">
          {actionError}
        </p>
      ) : (
        <p className="bro-holdem__authority-note">
          <ShieldCheck size={13} aria-hidden="true" />
          服务端确认后才更新筹码与牌面
        </p>
      )}
    </div>
  );
}

function getServerRaisePresets(
  state: HoldemServerSnapshot,
): readonly { label: string; value: number }[] {
  if (state.legal.minRaiseTo === null) return [];
  const clamp = (value: number) =>
    Math.min(
      state.legal.maxRaiseTo,
      Math.max(state.legal.minRaiseTo!, Math.ceil(value)),
    );
  return [
    { label: "半池", value: clamp(state.currentBet + state.pot * 0.5) },
    { label: "满池", value: clamp(state.currentBet + state.pot) },
    { label: "全押", value: state.legal.maxRaiseTo },
  ];
}

function AuthoritativeResultOverlay({
  entryPoints,
  state,
  hero,
}: {
  readonly entryPoints: number;
  readonly state: HoldemServerSnapshot;
  readonly hero: HoldemServerSeat;
}) {
  const winners = state.seats
    .filter((seat) => seat.outcome === "win" || seat.outcome === "tie")
    .map((seat) => seat.name)
    .join(" / ");
  const heroWins = hero.outcome === "win";
  const heroTies = hero.outcome === "tie";
  const winnerCount = Math.max(
    1,
    state.seats.filter(
      (seat) => seat.outcome === "win" || seat.outcome === "tie",
    ).length,
  );
  const payout =
    heroWins || heroTies
      ? Math.floor((entryPoints * state.seats.length) / winnerCount)
      : 0;
  const net = payout - entryPoints;
  const title = heroWins
    ? "漂亮拿下这一池"
    : heroTies
      ? "平分底池"
      : winners
        ? `${winners} 赢得底池`
        : "本手结束";
  const settlement =
    hero.settlementState === "settled"
      ? heroWins || heroTies
        ? "奖励已到账"
        : "本手已结算"
      : hero.settlementState === "retrying"
        ? "奖励入账重试中"
        : "等待服务器完成结算";
  return (
    <motion.div
      className="bro-holdem__result bro-holdem__result--server"
      role="status"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 180, damping: 18 }}
      >
        {hero.connected ? (
          <Crown size={28} aria-hidden="true" />
        ) : (
          <WifiOff size={28} aria-hidden="true" />
        )}
        <span>{heroWins ? "赢得底池" : heroTies ? "平局" : "摊牌完成"}</span>
        <h2>{title}</h2>
        <p>
          底池 {state.pot} · 返还 {payout} 积分 · 净收益{" "}
          {formatHoldemSigned(net)}
        </p>
        {net > 0 && <TableReward points={net} />}
        <div
          className="bro-holdem__server-settlement"
          data-state={hero.settlementState ?? "pending"}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{settlement}</span>
          <small>等待服务器开始下一手</small>
        </div>
      </motion.div>
      {(heroWins || heroTies) && hero.settlementState === "settled" && (
        <div className="bro-holdem__win-rings" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </motion.div>
  );
}

function formatHoldemSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function HoldemTable({
  seed,
  participantDecisionMs,
  onSettle,
  room,
}: Pick<HoldemGameProps, "seed" | "onSettle" | "participantDecisionMs"> & {
  readonly room: HoldemRoomConfig;
}) {
  const [game, setGame] = useState(() =>
    createHoldemGame({
      names: ["你", ...TABLE_PLAYER_NAMES],
      seed,
      startingStack: room.startingStack,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
    }),
  );
  const [decisionWindow, setDecisionWindow] = useState<DecisionWindow | null>(
    null,
  );
  const [raiseTo, setRaiseTo] = useState(40);
  const awardedHands = useRef(new Set<number>());

  const legal = legalActions(game, 0);
  const heroValue = useMemo(() => {
    const available = [...game.players[0].hole, ...game.community];
    return available.length >= 5 ? evaluateHoldemHand(available) : null;
  }, [game.players, game.community]);

  useEffect(() => {
    if (game.activeSeat === null || game.stage === "complete") {
      setDecisionWindow(null);
      return;
    }
    const seat = game.activeSeat;
    const durationMs =
      seat === 0
        ? PLAYER_DECISION_MS
        : (participantDecisionMs ?? tableDecisionDelay());
    const nextDecision: DecisionWindow = {
      key: `${game.handNumber}-${game.actionId}-${seat}`,
      seat,
      startedAt: Date.now(),
      durationMs,
    };
    setDecisionWindow(nextDecision);
    const timer = window.setTimeout(() => {
      setGame((current) => {
        if (current.activeSeat !== seat || current.stage === "complete") {
          return current;
        }
        if (seat === 0) {
          const currentLegal = legalActions(current, 0);
          return applyHoldemAction(
            current,
            0,
            currentLegal.check ? { type: "check" } : { type: "fold" },
          );
        }
        return applyHoldemAction(
          current,
          seat,
          chooseHoldemTableAction(current, seat),
        );
      });
      setDecisionWindow(null);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [
    game.activeSeat,
    game.actionId,
    game.handNumber,
    game.stage,
    participantDecisionMs,
  ]);

  useEffect(() => {
    if (
      game.stage !== "complete" ||
      !game.result?.winnerSeats.includes(0) ||
      awardedHands.current.has(game.handNumber)
    ) {
      return;
    }
    awardedHands.current.add(game.handNumber);
    onSettle?.(room.winPoints);
  }, [game, onSettle, room.winPoints]);

  useEffect(() => {
    if (legal.minRaiseTo !== null) setRaiseTo(legal.minRaiseTo);
  }, [game.activeSeat, game.currentBet, game.minRaise, legal.minRaiseTo]);

  const act = (action: HoldemAction) => {
    setGame((current) => applyHoldemAction(current, 0, action));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        game.activeSeat !== 0 ||
        game.stage === "complete" ||
        event.repeat ||
        (event.target as HTMLElement | null)?.matches("input, button")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "f" && legal.fold) act({ type: "fold" });
      if (key === "c") {
        if (legal.check) act({ type: "check" });
        else if (legal.call > 0) act({ type: "call" });
      }
      if (key === "r" && legal.minRaiseTo !== null) {
        act({ type: "raise", to: raiseTo });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [game, legal, raiseTo]);

  const displayPot = game.result?.pot ?? game.pot;
  return (
    <main className="bro-holdem bro-game-viewport">
      <section className="bro-holdem__table" aria-label="德州扑克牌桌">
        <div className="bro-holdem__felt-lines" aria-hidden="true" />
        <header className="bro-holdem__hud">
          <div>
            <Radio size={14} aria-hidden="true" />
            <span>{room.name}</span>
            <i>NO LIMIT HOLD'EM</i>
          </div>
          <strong>{STAGE_LABEL[game.stage]}</strong>
          <span>第 {game.handNumber} 手</span>
        </header>

        <Seat
          player={game.players[1]}
          position="left"
          dealer={game.dealerSeat === 1}
          active={game.activeSeat === 1}
          thinking={decisionWindow?.seat === 1}
          decisionWindow={decisionWindow?.seat === 1 ? decisionWindow : null}
          reveal={game.stage === "complete"}
          handNumber={game.handNumber}
        />
        <Seat
          player={game.players[2]}
          position="right"
          dealer={game.dealerSeat === 2}
          active={game.activeSeat === 2}
          thinking={decisionWindow?.seat === 2}
          decisionWindow={decisionWindow?.seat === 2 ? decisionWindow : null}
          reveal={game.stage === "complete"}
          handNumber={game.handNumber}
        />

        <div className="bro-holdem__center">
          <div
            className="bro-holdem__pot"
            key={`${game.handNumber}-${game.pot}`}
          >
            <CircleDollarSign size={15} aria-hidden="true" />
            底池 <strong>{displayPot}</strong>
          </div>
          <div className="bro-holdem__community" aria-label="公共牌">
            {game.community.map((card, index) => (
              <PlayingCard
                key={`${game.handNumber}-${card.id}`}
                card={card}
                index={index}
                className="bro-holdem__community-card"
              />
            ))}
            {Array.from({ length: 5 - game.community.length }).map(
              (_, index) => (
                <div className="bro-holdem__card-slot" key={`slot-${index}`} />
              ),
            )}
          </div>
          <AnimatePresence mode="wait">
            {game.lastAction && (
              <motion.p
                className="bro-holdem__action-feed"
                key={game.lastAction.id}
                initial={{ opacity: 0, y: 8, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
              >
                {game.lastAction.label}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="bro-holdem__deck" aria-hidden="true">
          <img src={pokerCardBackUrl()} alt="" />
          <span>{52 - game.deckIndex}</span>
        </div>

        <AnimatePresence>
          {game.lastAction?.amount ? (
            <motion.span
              key={game.lastAction.id}
              className="bro-holdem__flying-chip"
              data-seat={game.lastAction.seat}
              initial={{
                opacity: 1,
                scale: 0.75,
                ...chipOrigin(game.lastAction.seat),
              }}
              animate={{ opacity: 0, scale: 1.2, x: 0, y: 0 }}
              transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {game.lastAction.amount}
            </motion.span>
          ) : null}
        </AnimatePresence>

        <ActionDock
          game={game}
          legal={legal}
          raiseTo={raiseTo}
          onRaiseTo={setRaiseTo}
          onAction={act}
          decisionWindow={decisionWindow?.seat === 0 ? decisionWindow : null}
        />

        <Seat
          player={game.players[0]}
          position="hero"
          dealer={game.dealerSeat === 0}
          active={game.activeSeat === 0}
          thinking={false}
          decisionWindow={decisionWindow?.seat === 0 ? decisionWindow : null}
          reveal
          handNumber={game.handNumber}
          handLabel={heroValue?.label}
        />

        <AnimatePresence>
          {game.result && (
            <ResultOverlay
              game={game}
              winPoints={room.winPoints}
              onNext={() => setGame((current) => nextHoldemHand(current))}
            />
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}

function chipOrigin(seat: number): { x: number; y: number } {
  if (seat === 1) return { x: -330, y: -130 };
  if (seat === 2) return { x: 330, y: -130 };
  return { x: 0, y: 260 };
}

interface HoldemTableSeat {
  readonly seat: number;
  readonly name: string;
  readonly stack: number;
  readonly hole: readonly PokerCard[];
  readonly committedRound: number;
  readonly committedHand: number;
  readonly status: string;
  readonly connected?: boolean;
}

function isFolded(status: string): boolean {
  return status === "folded" || status === "fold";
}

function isAllIn(status: string): boolean {
  return status === "all-in" || status === "all_in";
}

function Seat({
  player,
  position,
  dealer,
  active,
  thinking,
  decisionWindow,
  reveal,
  handNumber,
  handLabel,
}: {
  readonly player: HoldemTableSeat;
  readonly position: "left" | "right" | "hero";
  readonly dealer: boolean;
  readonly active: boolean;
  readonly thinking: boolean;
  readonly decisionWindow: DecisionWindow | null;
  readonly reveal: boolean;
  readonly handNumber: number;
  readonly handLabel?: string;
}) {
  return (
    <div
      className="bro-holdem__seat"
      data-position={position}
      data-active={active ? "" : undefined}
      data-folded={isFolded(player.status) ? "" : undefined}
      data-disconnected={player.connected === false ? "" : undefined}
    >
      <div className="bro-holdem__player-card">
        <span className="bro-holdem__avatar" aria-hidden="true">
          {position === "hero" ? "我" : player.name.slice(0, 1)}
        </span>
        <span>
          <strong>{player.name}</strong>
          <small>
            {player.connected === false
              ? "连接中断"
              : thinking
                ? "正在看牌…"
                : isFolded(player.status)
                  ? "已弃牌"
                  : isAllIn(player.status)
                    ? "ALL IN"
                    : active
                      ? "行动中"
                      : "等待"}
          </small>
        </span>
        <b>{player.stack}</b>
        {dealer && <i className="bro-holdem__dealer">D</i>}
        {(position === "hero" ||
          player.committedRound > 0 ||
          player.committedHand > 0) && (
          <em
            className="bro-holdem__bet"
            aria-label={`本轮投入 ${player.committedRound}，本手投入 ${player.committedHand}`}
          >
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <span>
              {position === "hero"
                ? `本轮 ${player.committedRound} · 本手 ${player.committedHand}`
                : player.committedRound}
            </span>
          </em>
        )}
      </div>
      {active && decisionWindow && (
        <DecisionClock
          key={decisionWindow.key}
          window={decisionWindow}
          label={position === "hero" ? "你的决策" : "决策中"}
          compact={position !== "hero"}
        />
      )}
      <div className="bro-holdem__hole-cards">
        {!reveal && player.hole.length === 0
          ? Array.from({ length: 2 }, (_, index) => (
              <motion.img
                className="bro-holdem__playing-card"
                src={pokerCardBackUrl()}
                alt="对手手牌"
                key={`${handNumber}-${player.seat}-hidden-${index}`}
                initial={{ opacity: 0, scale: 0.35, y: -120 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
              />
            ))
          : null}
        {player.hole.map((card, index) => (
          <PlayingCard
            key={`${handNumber}-${player.seat}-${card.id}`}
            card={card}
            hidden={!reveal}
            index={player.seat * 2 + index}
          />
        ))}
      </div>
      {handLabel && <span className="bro-holdem__hand-label">{handLabel}</span>}
    </div>
  );
}

function PlayingCard({
  card,
  hidden = false,
  index,
  className = "",
}: {
  readonly card: PokerCard;
  readonly hidden?: boolean;
  readonly index: number;
  readonly className?: string;
}) {
  return (
    <motion.img
      className={`bro-holdem__playing-card ${className}`}
      src={hidden ? pokerCardBackUrl() : pokerCardAssetUrl(card)}
      alt={hidden ? "对手手牌" : pokerCardLabel(card)}
      initial={{ opacity: 0, scale: 0.35, x: 0, y: -120, rotate: -8 }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
      transition={{
        delay: Math.min(index * 0.08, 0.45),
        duration: 0.42,
        type: "spring",
        stiffness: 210,
        damping: 20,
      }}
    />
  );
}

function ActionDock({
  game,
  legal,
  raiseTo,
  onRaiseTo,
  onAction,
  decisionWindow,
}: {
  readonly game: HoldemState;
  readonly legal: ReturnType<typeof legalActions>;
  readonly raiseTo: number;
  readonly onRaiseTo: (value: number) => void;
  readonly onAction: (action: HoldemAction) => void;
  readonly decisionWindow: DecisionWindow | null;
}) {
  const myTurn = game.activeSeat === 0 && game.stage !== "complete";
  const raisePresets = getRaisePresets(game, legal);
  return (
    <div className="bro-holdem__actions" data-visible={myTurn ? "" : undefined}>
      <div className="bro-holdem__turn-copy" aria-live="polite">
        <span>{myTurn ? "轮到你" : "牌局进行中"}</span>
        {myTurn && decisionWindow && (
          <DecisionClock
            key={decisionWindow.key}
            window={decisionWindow}
            label="决策倒计时"
          />
        )}
        <small>
          {myTurn
            ? legal.call > 0
              ? `跟注需要 ${legal.call}`
              : "可以过牌免费看下一张"
            : (game.lastAction?.label ?? "牌局进行中")}
        </small>
      </div>
      <div className="bro-holdem__my-stake" aria-label="我的下注明细">
        <span>
          本轮下注 <strong>{game.players[0].committedRound}</strong>
        </span>
        <span>
          本手投入 <strong>{game.players[0].committedHand}</strong>
        </span>
        <span>
          剩余筹码 <strong>{game.players[0].stack}</strong>
        </span>
      </div>
      <div className="bro-holdem__action-buttons">
        <button
          type="button"
          className="bro-holdem__button bro-holdem__button--danger"
          disabled={!myTurn || !legal.fold}
          onClick={() => onAction({ type: "fold" })}
        >
          <span>弃牌</span>
          <small>F</small>
        </button>
        {legal.check ? (
          <button
            type="button"
            className="bro-holdem__button"
            disabled={!myTurn}
            onClick={() => onAction({ type: "check" })}
          >
            <span>过牌</span>
            <small>无需投入</small>
          </button>
        ) : (
          <button
            type="button"
            className="bro-holdem__button"
            disabled={!myTurn || legal.call <= 0}
            onClick={() => onAction({ type: "call" })}
          >
            <span>跟注</span>
            <small>{legal.call} 筹码</small>
          </button>
        )}
        <button
          type="button"
          className="bro-holdem__button bro-holdem__button--primary"
          disabled={!myTurn || legal.minRaiseTo === null}
          onClick={() => onAction({ type: "raise", to: raiseTo })}
        >
          <span>加注</span>
          <small>{raiseTo} 筹码</small>
        </button>
      </div>
      {legal.minRaiseTo !== null && (
        <div className="bro-holdem__raise-panel">
          <div className="bro-holdem__raise-presets" aria-label="快捷加注">
            {raisePresets.map((preset) => (
              <button
                type="button"
                key={preset.label}
                disabled={!myTurn}
                data-selected={raiseTo === preset.value ? "" : undefined}
                onClick={() => onRaiseTo(preset.value)}
              >
                <Coins size={13} aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          <label className="bro-holdem__raise-control">
            <span>投入</span>
            <input
              aria-label="加注筹码"
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={game.bigBlind}
              value={Math.min(raiseTo, legal.maxRaiseTo)}
              disabled={!myTurn}
              onChange={(event) => onRaiseTo(Number(event.target.value))}
            />
            <output>{raiseTo}</output>
          </label>
        </div>
      )}
    </div>
  );
}

function getRaisePresets(
  game: HoldemState,
  legal: ReturnType<typeof legalActions>,
): readonly { label: string; value: number }[] {
  if (legal.minRaiseTo === null) return [];
  const clamp = (value: number) =>
    Math.min(
      legal.maxRaiseTo,
      Math.max(
        legal.minRaiseTo!,
        Math.ceil(value / game.bigBlind) * game.bigBlind,
      ),
    );
  return [
    { label: "半池", value: clamp(game.currentBet + game.pot * 0.5) },
    { label: "满池", value: clamp(game.currentBet + game.pot) },
    { label: "全押", value: legal.maxRaiseTo },
  ];
}

function ResultOverlay({
  game,
  winPoints,
  onNext,
}: {
  readonly game: HoldemState;
  readonly winPoints: number;
  readonly onNext: () => void;
}) {
  const result = game.result!;
  const heroWins = result.winnerSeats.includes(0);
  const names = result.winnerSeats
    .map((seat) => game.players[seat].name)
    .join(" / ");
  return (
    <motion.div
      className="bro-holdem__result"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.88 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 180, damping: 18 }}
      >
        <Crown size={28} aria-hidden="true" />
        <span>{heroWins ? "赢得底池" : "本手结束"}</span>
        <h2>{heroWins ? "漂亮拿下这一池" : `${names} 赢得底池`}</h2>
        <p>
          {result.label} · 底池 {result.pot}
          {heroWins ? ` · 获得 ${winPoints} 积分` : ""}
        </p>
        {heroWins && <TableReward points={winPoints} />}
        <button type="button" onClick={onNext}>
          下一手
        </button>
      </motion.div>
      {heroWins && (
        <div className="bro-holdem__win-rings" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </motion.div>
  );
}
