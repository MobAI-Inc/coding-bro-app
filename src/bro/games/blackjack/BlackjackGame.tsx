import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  CircleDollarSign,
  Eye,
  Radio,
  ShieldCheck,
  TrendingUp,
  UserRound,
  WalletCards,
} from "lucide-react";
import { LocalMatchmaking } from "../core/LocalMatchmaking";
import { DecisionClock } from "../core/DecisionClock";
import { TableReward } from "../core/TableReward";
import { playArcadeCue } from "../core/audio";
import type { MatchmakingSnapshot } from "../core/matchmaking";
import type { GameRealtimeAccess } from "../core/realtime";
import {
  PLAYER_DECISION_MS,
  tableDecisionDelay,
  type DecisionWindow,
} from "../core/decision-timing";
import {
  playingCardAssetUrl,
  playingCardBackUrl,
  playingCardLabel,
} from "../core/playing-card-assets";
import {
  applyBlackjackAction,
  blackjackHandValue,
  canDouble,
  chooseBlackjackTableAction,
  createBlackjackRound,
  DEFAULT_BLACKJACK_ROOM,
  heroPointReward,
  nextBlackjackRound,
  type BlackjackAction,
  type BlackjackCard,
  type BlackjackPlayer,
  type BlackjackRoomConfig,
  type BlackjackState,
} from "./logic";
import "./blackjack.css";

export { DEFAULT_BLACKJACK_ROOM } from "./logic";
export type { BlackjackRoomConfig } from "./logic";

const BLACKJACK_PLAYER_NAMES = ["森川", "Mika"] as const;

export interface BlackjackGameProps {
  readonly room?: BlackjackRoomConfig;
  readonly seed?: number;
  readonly participantDecisionMs?: number;
  readonly matchmakingDelayMs?: number;
  readonly accountPoints?: number;
  readonly entryPoints?: number;
  readonly realtime?: GameRealtimeAccess | null;
  readonly onSettle?: (points: number) => void;
  readonly onServerSettled?: () => void;
}

export function BlackjackGame({
  room = DEFAULT_BLACKJACK_ROOM,
  seed,
  participantDecisionMs,
  matchmakingDelayMs = 900,
  accountPoints,
  entryPoints,
  realtime,
  onSettle,
  onServerSettled,
}: BlackjackGameProps) {
  return (
    <LocalMatchmaking
      gameId={realtime ? "blackjack" : `blackjack:${room.id}`}
      roomId={realtime ? room.id : undefined}
      seatCount={3}
      playerNames={BLACKJACK_PLAYER_NAMES}
      fillDelayMs={matchmakingDelayMs}
      realtime={realtime}
    >
      {(match) =>
        realtime ? (
          <AuthoritativeBlackjackTable
            accountPoints={accountPoints}
            entryPoints={entryPoints}
            match={match}
            onServerSettled={onServerSettled}
            room={room}
          />
        ) : (
          <BlackjackTable
            key={match.matchId}
            room={room}
            seed={seed}
            participantDecisionMs={participantDecisionMs}
            accountPoints={accountPoints}
            onSettle={onSettle}
          />
        )
      }
    </LocalMatchmaking>
  );
}

type BlackjackServerAction = Exclude<BlackjackAction["type"], "double">;
type BlackjackServerOutcome = "natural" | "win" | "push" | "loss" | null;
type BlackjackSettlementState = "pending" | "retrying" | "settled" | null;

interface BlackjackServerSeat {
  readonly seat: number;
  readonly name: string;
  readonly connected: boolean;
  readonly hand: readonly BlackjackCard[];
  readonly total: number;
  readonly wager: number;
  readonly outcome: BlackjackServerOutcome;
  readonly payout: number;
  readonly settlementState: BlackjackSettlementState;
}

interface BlackjackServerState {
  readonly gameId: "blackjack";
  readonly version: number;
  readonly roundId: number;
  readonly phase: "players" | "dealer" | "settled";
  readonly phaseEndsInMs: number;
  readonly selfSeat: number | null;
  readonly activeSeat: number | null;
  readonly dealer: {
    readonly cards: readonly BlackjackCard[];
    readonly total: number | null;
  };
  readonly seats: readonly BlackjackServerSeat[];
}

export function AuthoritativeBlackjackTable({
  accountPoints,
  entryPoints,
  match,
  onServerSettled,
  room,
}: {
  readonly accountPoints?: number;
  readonly entryPoints?: number;
  readonly match: MatchmakingSnapshot;
  readonly onServerSettled?: () => void;
  readonly room: BlackjackRoomConfig;
}) {
  const [sending, setSending] = useState<BlackjackServerAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const notifiedRound = useRef<number | null>(null);
  const state = blackjackServerState(match.serverState);
  const self = state?.seats.find((seat) => seat.seat === state.selfSeat);
  const otherSeats =
    state?.seats.filter((seat) => seat.seat !== state.selfSeat).slice(0, 2) ??
    [];
  const heroTurn =
    state?.phase === "players" && state.activeSeat === state.selfSeat;
  const canAct = Boolean(match.sendAction) && heroTurn && sending === null;
  const totalWager =
    state?.seats.reduce((sum, seat) => sum + seat.wager, 0) ?? 0;
  const heroRoundNet =
    state?.phase === "settled" && self ? self.payout - self.wager : null;
  const activePlayer = state?.seats.find(
    (seat) => seat.seat === state.activeSeat,
  );
  const operationState = !state
    ? "同步权威牌桌"
    : heroTurn
      ? "轮到你"
      : state.phase === "dealer"
        ? "庄家补牌"
        : state.phase === "settled"
          ? settlementLabel(self?.settlementState ?? null)
          : `${activePlayer?.name ?? "同桌玩家"}行动中`;
  const decisionWindow: DecisionWindow | null =
    state?.phase === "players" &&
    state.activeSeat !== null &&
    state.phaseEndsInMs > 0
      ? {
          key: `blackjack-server-${state.roundId}-${state.version}-${state.activeSeat}`,
          seat: state.activeSeat,
          startedAt: Date.now(),
          durationMs: state.phaseEndsInMs,
        }
      : null;

  useEffect(() => {
    if (
      !state ||
      state.phase !== "settled" ||
      self?.settlementState !== "settled" ||
      notifiedRound.current === state.roundId
    ) {
      return;
    }
    notifiedRound.current = state.roundId;
    const net = self.payout - self.wager;
    playArcadeCue(net > 0 ? "win" : net < 0 ? "lose" : "enter");
    onServerSettled?.();
  }, [onServerSettled, self, state]);

  const act = async (type: BlackjackServerAction) => {
    if (!match.sendAction || !canAct) return;
    setSending(type);
    setActionError(null);
    try {
      await match.sendAction(1, { type });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(null);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="bro-blackjack bro-game-viewport">
        <section className="bro-blackjack__table" aria-label="21点牌桌">
          <div className="bro-blackjack__grain" aria-hidden="true" />
          <header className="bro-blackjack__hud">
            <div>
              <Radio size={14} aria-hidden="true" />
              <strong>{room.label}</strong>
              <span>{room.tableLabel}</span>
            </div>
            <p>服务端发牌与裁定 · 庄家 17 点停牌</p>
            <span>
              第 {String(state?.roundId ?? 0).padStart(2, "0")} 局 · CLOUD
            </span>
          </header>

          <aside
            className="bro-blackjack__scoreboard"
            aria-label="我的牌桌状态"
          >
            <div>
              <WalletCards size={15} aria-hidden="true" />
              <span>账户积分</span>
              <strong>{accountPoints ?? "—"}</strong>
            </div>
            <div>
              <CircleDollarSign size={15} aria-hidden="true" />
              <span>入场积分</span>
              <strong aria-label="本局入场积分">{entryPoints ?? "—"}</strong>
            </div>
            <div>
              <CircleDollarSign size={15} aria-hidden="true" />
              <span>当前下注</span>
              <strong>{self?.wager ?? "—"}</strong>
            </div>
            <div
              data-result={
                heroRoundNet === null
                  ? "pending"
                  : heroRoundNet > 0
                    ? "win"
                    : heroRoundNet < 0
                      ? "loss"
                      : "push"
              }
            >
              <TrendingUp size={15} aria-hidden="true" />
              <span>回合盈亏</span>
              <strong>
                {heroRoundNet === null
                  ? "待结算"
                  : `${heroRoundNet > 0 ? "+" : ""}${heroRoundNet}`}
              </strong>
            </div>
            <div>
              <Radio size={15} aria-hidden="true" />
              <span>操作状态</span>
              <strong>{operationState}</strong>
            </div>
          </aside>

          <section
            className="bro-blackjack__visibility-rule"
            aria-label="牌面公开规则"
          >
            <Eye size={16} aria-hidden="true" />
            <span>
              <strong>玩家手牌全桌明牌</strong>
              <small>庄家行动前保留一张暗牌</small>
            </span>
          </section>

          <AuthoritativeDealerArea state={state} />

          <div className="bro-blackjack__bank" key={totalWager}>
            <CircleDollarSign size={16} aria-hidden="true" />
            桌面总下注 <strong>{totalWager}</strong>
          </div>

          {actionError || match.error ? (
            <p className="bro-blackjack__feed is-error" role="alert">
              {actionError ?? match.error}
            </p>
          ) : (
            <p className="bro-blackjack__feed" aria-live="polite">
              {!state
                ? "正在同步云端牌桌…"
                : state.phase === "players"
                  ? heroTurn
                    ? "轮到你，请在服务端倒计时结束前行动"
                    : `${activePlayer?.name ?? "同桌玩家"} 正在查看牌面…`
                  : state.phase === "dealer"
                    ? "玩家行动完成，庄家正在补牌…"
                    : settlementLabel(self?.settlementState ?? null)}
            </p>
          )}

          {otherSeats.map((seat, index) => (
            <AuthoritativePlayerArea
              key={seat.seat}
              active={state?.activeSeat === seat.seat}
              decisionWindow={
                decisionWindow?.seat === seat.seat ? decisionWindow : null
              }
              position={index === 0 ? "left" : "right"}
              round={state?.roundId ?? 0}
              seat={seat}
            />
          ))}
          {self && (
            <AuthoritativePlayerArea
              active={heroTurn}
              decisionWindow={heroTurn ? decisionWindow : null}
              position="hero"
              round={state?.roundId ?? 0}
              seat={self}
            />
          )}

          <div
            className="bro-blackjack__actions"
            data-active={heroTurn ? "" : undefined}
          >
            <div>
              <span>{heroTurn ? "你的牌" : "牌局进行中"}</span>
              <strong>{self?.total ?? "—"}</strong>
              <small>服务端计分</small>
            </div>
            {heroTurn && decisionWindow && (
              <DecisionClock
                key={decisionWindow.key}
                window={decisionWindow}
                label="决策倒计时"
              />
            )}
            <button
              type="button"
              disabled={!canAct}
              onClick={() => void act("hit")}
            >
              {sending === "hit" ? "提交中…" : "要牌"}
            </button>
            <button
              type="button"
              disabled={!canAct}
              onClick={() => void act("stand")}
            >
              {sending === "stand" ? "提交中…" : "停牌"}
            </button>
            <button
              type="button"
              className="bro-blackjack__double"
              disabled
              title="云端牌桌暂不支持加倍"
            >
              加倍 · 暂不可用
            </button>
          </div>

          <div
            className="bro-blackjack__wager bro-blackjack__server-state"
            aria-label="服务端结算状态"
            aria-live="polite"
          >
            <span>
              结算状态
              <strong>{settlementLabel(self?.settlementState ?? null)}</strong>
            </span>
            <div>
              <span data-state={self?.settlementState ?? "playing"}>
                SERVER
              </span>
            </div>
            <small>
              下注 {self?.wager ?? "—"} · 返还 {self?.payout ?? "—"}
            </small>
          </div>

          <AnimatePresence>
            {state?.phase === "settled" && self?.outcome && (
              <ServerRoundResult key={state.roundId} seat={self} />
            )}
          </AnimatePresence>
        </section>
      </main>
    </MotionConfig>
  );
}

function AuthoritativeDealerArea({
  state,
}: {
  readonly state: BlackjackServerState | null;
}) {
  const reveal = state?.phase === "dealer" || state?.phase === "settled";
  const cards = state?.dealer.cards ?? [];
  const visibleTotal = reveal ? state?.dealer.total : null;
  return (
    <div className="bro-blackjack__dealer">
      <div className="bro-blackjack__dealer-label">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>庄家</strong>
          <small>{reveal ? `${visibleTotal ?? "—"} 点` : "一张暗牌"}</small>
        </span>
      </div>
      <div className="bro-blackjack__dealer-hand" aria-label="庄家手牌">
        {cards.slice(0, reveal ? cards.length : 1).map((card, index) => (
          <BlackjackCardView
            key={`server-dealer-${state?.roundId ?? 0}-${card.id}-${index}`}
            card={card}
            delay={0.12 + index * 0.16}
          />
        ))}
        {!reveal && (
          <BlackjackCardView
            key={`server-dealer-hidden-${state?.roundId ?? 0}`}
            hidden
            delay={0.28}
          />
        )}
      </div>
    </div>
  );
}

function AuthoritativePlayerArea({
  active,
  decisionWindow,
  position,
  round,
  seat,
}: {
  readonly active: boolean;
  readonly decisionWindow: DecisionWindow | null;
  readonly position: "left" | "right" | "hero";
  readonly round: number;
  readonly seat: BlackjackServerSeat;
}) {
  const outcome = serverOutcomeLabel(seat.outcome);
  const status = !seat.connected
    ? "连接中"
    : (outcome ??
      (active
        ? position === "hero"
          ? "轮到你"
          : "行动中"
        : `下注 ${seat.wager}`));
  return (
    <div
      className="bro-blackjack__player"
      data-position={position}
      data-active={active ? "" : undefined}
      data-busted={seat.total > 21 ? "" : undefined}
      data-connected={seat.connected ? "" : undefined}
    >
      <div
        className="bro-blackjack__player-hand"
        aria-label={`${seat.name} 公开手牌`}
      >
        {seat.hand.map((card, index) => (
          <BlackjackCardView
            key={`${round}-${seat.seat}-${card.id}-${index}`}
            card={card}
            delay={0.08 * (seat.seat + index + 1)}
          />
        ))}
      </div>
      <div className="bro-blackjack__player-info">
        <span className="bro-blackjack__avatar" aria-hidden="true">
          <UserRound />
        </span>
        <span>
          <strong>
            {position === "hero" ? `${seat.name} · 你` : seat.name}
          </strong>
          <small>{status}</small>
        </span>
        <b>{seat.total}</b>
        <em>{seat.connected ? "已连接" : "重连中"}</em>
      </div>
      {active && decisionWindow && (
        <DecisionClock
          key={decisionWindow.key}
          window={decisionWindow}
          label={position === "hero" ? "你的决策" : "服务端决策"}
          compact={position !== "hero"}
        />
      )}
    </div>
  );
}

function ServerRoundResult({ seat }: { readonly seat: BlackjackServerSeat }) {
  const net = seat.payout - seat.wager;
  return (
    <motion.div
      className="bro-blackjack__result bro-blackjack__result--server"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 14 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      role="status"
    >
      <span>{serverOutcomeLabel(seat.outcome)}</span>
      <h2>{serverResultHeadline(seat.outcome)}</h2>
      <p>
        下注 {seat.wager} · 返还 {seat.payout} · 本局 {formatSigned(net)}
      </p>
      {net > 0 && <TableReward points={net} />}
      <small>{settlementLabel(seat.settlementState)}</small>
    </motion.div>
  );
}

function blackjackServerState(value: unknown): BlackjackServerState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as BlackjackServerState;
  if (
    raw.gameId !== "blackjack" ||
    !Array.isArray(raw.seats) ||
    !raw.dealer ||
    !Array.isArray(raw.dealer.cards)
  ) {
    return null;
  }
  return {
    ...raw,
    dealer: {
      ...raw.dealer,
      cards: raw.dealer.cards.map(serverBlackjackCard),
    },
    seats: raw.seats.map((seat) => ({
      ...seat,
      hand: seat.hand.map(serverBlackjackCard),
    })),
  };
}

function serverBlackjackCard(
  card: BlackjackCard | Readonly<Record<string, unknown>>,
  index: number,
): BlackjackCard {
  const rankValue = String(card.rank).toUpperCase();
  const rank =
    rankValue === "A"
      ? 14
      : rankValue === "K"
        ? 13
        : rankValue === "Q"
          ? 12
          : rankValue === "J"
            ? 11
            : Number(rankValue);
  const suitValue = String(card.suit).toLowerCase();
  const suit =
    suitValue === "spades" || suitValue === "♠"
      ? "S"
      : suitValue === "hearts" || suitValue === "♥"
        ? "H"
        : suitValue === "diamonds" || suitValue === "♦"
          ? "D"
          : suitValue === "clubs" || suitValue === "♣"
            ? "C"
            : String(card.suit).toUpperCase();
  return {
    id:
      typeof card.id === "string" && card.id
        ? card.id
        : `${rank}${suit}-${index}`,
    rank: rank as BlackjackCard["rank"],
    suit: suit as BlackjackCard["suit"],
  };
}

function serverOutcomeLabel(outcome: BlackjackServerOutcome): string | null {
  if (outcome === "natural") return "天然 21 点 · 3:2";
  if (outcome === "win") return "获胜";
  if (outcome === "push") return "推和";
  if (outcome === "loss") return "落败";
  return null;
}

function serverResultHeadline(outcome: BlackjackServerOutcome): string {
  if (outcome === "natural") return "天然 21 点";
  if (outcome === "win") return "这一手你赢了";
  if (outcome === "push") return "推和，退回下注";
  return "庄家拿下这一手";
}

function settlementLabel(state: BlackjackSettlementState): string {
  if (state === "pending") return "等待服务端结算";
  if (state === "retrying") return "服务端重试中";
  if (state === "settled") return "服务端已结算";
  return "牌局进行中";
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function BlackjackTable({
  room,
  seed,
  participantDecisionMs,
  accountPoints,
  onSettle,
}: Required<Pick<BlackjackGameProps, "room">> &
  Pick<
    BlackjackGameProps,
    "seed" | "accountPoints" | "onSettle" | "participantDecisionMs"
  >) {
  const [game, setGame] = useState(() => createBlackjackRound(room, { seed }));
  const [nextWager, setNextWager] = useState(room.defaultBet);
  const [decisionWindow, setDecisionWindow] = useState<DecisionWindow | null>(
    null,
  );
  const [resultReady, setResultReady] = useState(false);
  const settledRounds = useRef(new Set<number>());

  useEffect(() => {
    if (game.phase !== "settled") {
      setResultReady(false);
      return;
    }
    const timer = window.setTimeout(() => setResultReady(true), 780);
    if (!settledRounds.current.has(game.round)) {
      settledRounds.current.add(game.round);
      const points = heroPointReward(game);
      if (points > 0) onSettle?.(points);
    }
    return () => window.clearTimeout(timer);
  }, [game, onSettle]);

  useEffect(() => {
    const seat = game.activeSeat;
    if (game.phase !== "players" || seat === null) {
      setDecisionWindow(null);
      return;
    }
    const durationMs =
      seat === 0
        ? PLAYER_DECISION_MS
        : (participantDecisionMs ?? tableDecisionDelay());
    const nextDecision: DecisionWindow = {
      key: `${game.round}-${game.actionId}-${seat}`,
      seat,
      startedAt: Date.now(),
      durationMs,
    };
    setDecisionWindow(nextDecision);
    const timer = window.setTimeout(() => {
      setGame((current) => {
        if (current.activeSeat !== seat) return current;
        if (seat === 0) {
          return applyBlackjackAction(current, 0, { type: "stand" });
        }
        return applyBlackjackAction(
          current,
          seat,
          chooseBlackjackTableAction(current, seat, Math.random),
        );
      });
      setDecisionWindow(null);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [
    game.activeSeat,
    game.actionId,
    game.phase,
    game.round,
    participantDecisionMs,
  ]);

  const act = (action: BlackjackAction) => {
    setGame((current) => applyBlackjackAction(current, 0, action));
  };

  const hero = game.players[0];
  const heroValue = blackjackHandValue(hero.hand);
  const heroTurn = game.phase === "players" && game.activeSeat === 0;
  const totalWager = game.players.reduce(
    (sum, player) => sum + player.wager,
    0,
  );
  const heroRoundNet =
    game.phase === "settled" ? hero.payout - hero.wager : null;
  const operationState = heroTurn
    ? "轮到你"
    : game.phase === "settled"
      ? "本局已结算"
      : "等待桌上行动";
  const wagerOptions = Array.from(
    new Set([
      room.minBet,
      room.defaultBet,
      Math.max(room.defaultBet * 2, room.minBet * 5),
    ]),
  ).sort((left, right) => left - right);

  return (
    <MotionConfig reducedMotion="user">
      <main className="bro-blackjack bro-game-viewport">
        <section className="bro-blackjack__table" aria-label="21点牌桌">
          <div className="bro-blackjack__grain" aria-hidden="true" />
          <header className="bro-blackjack__hud">
            <div>
              <Radio size={14} aria-hidden="true" />
              <strong>{game.room.label}</strong>
              <span>{game.room.tableLabel}</span>
            </div>
            <p>天然 21 点赔 3:2 · 庄家 17 点停牌</p>
            <span>第 {String(game.round).padStart(2, "0")} 局</span>
          </header>

          <aside
            className="bro-blackjack__scoreboard"
            aria-label="我的牌桌状态"
          >
            <div>
              <WalletCards size={15} aria-hidden="true" />
              <span>账户积分</span>
              <strong>{accountPoints ?? "—"}</strong>
            </div>
            <div>
              <CircleDollarSign size={15} aria-hidden="true" />
              <span>桌内筹码</span>
              <strong>{hero.stack}</strong>
            </div>
            <div>
              <CircleDollarSign size={15} aria-hidden="true" />
              <span>当前下注</span>
              <strong>{hero.wager}</strong>
            </div>
            <div
              data-result={
                heroRoundNet === null
                  ? "pending"
                  : heroRoundNet > 0
                    ? "win"
                    : heroRoundNet < 0
                      ? "loss"
                      : "push"
              }
            >
              <TrendingUp size={15} aria-hidden="true" />
              <span>回合盈亏</span>
              <strong>
                {heroRoundNet === null
                  ? "待结算"
                  : `${heroRoundNet > 0 ? "+" : ""}${heroRoundNet}`}
              </strong>
            </div>
            <div>
              <Radio size={15} aria-hidden="true" />
              <span>操作状态</span>
              <strong>{operationState}</strong>
            </div>
          </aside>

          <section
            className="bro-blackjack__visibility-rule"
            aria-label="牌面公开规则"
          >
            <Eye size={16} aria-hidden="true" />
            <span>
              <strong>玩家手牌全桌明牌</strong>
              <small>仅庄家第二张为暗牌</small>
            </span>
          </section>

          <DealerArea game={game} />

          <div className="bro-blackjack__bank" key={totalWager}>
            <CircleDollarSign size={16} aria-hidden="true" />
            桌面总下注 <strong>{totalWager}</strong>
          </div>

          <p className="bro-blackjack__feed" aria-live="polite">
            {decisionWindow !== null
              ? `${game.players[decisionWindow.seat].name} 正在查看牌面…`
              : (game.lastAction ?? "发牌完成，请行动")}
          </p>

          <PlayerArea
            player={game.players[1]}
            position="left"
            active={game.activeSeat === 1}
            thinking={decisionWindow?.seat === 1}
            decisionWindow={decisionWindow?.seat === 1 ? decisionWindow : null}
            round={game.round}
          />
          <PlayerArea
            player={game.players[2]}
            position="right"
            active={game.activeSeat === 2}
            thinking={decisionWindow?.seat === 2}
            decisionWindow={decisionWindow?.seat === 2 ? decisionWindow : null}
            round={game.round}
          />
          <PlayerArea
            player={hero}
            position="hero"
            active={heroTurn}
            thinking={false}
            decisionWindow={decisionWindow?.seat === 0 ? decisionWindow : null}
            round={game.round}
          />

          <div
            className="bro-blackjack__actions"
            data-active={heroTurn ? "" : undefined}
          >
            <div>
              <span>{heroTurn ? "你的牌" : "牌局进行中"}</span>
              <strong>{heroValue.total}</strong>
              <small>{heroValue.soft ? "软牌" : "硬牌"}</small>
            </div>
            {heroTurn && decisionWindow?.seat === 0 && (
              <DecisionClock
                key={decisionWindow.key}
                window={decisionWindow}
                label="决策倒计时"
              />
            )}
            <button
              type="button"
              disabled={!heroTurn}
              onClick={() => act({ type: "hit" })}
            >
              要牌
            </button>
            <button
              type="button"
              disabled={!heroTurn}
              onClick={() => act({ type: "stand" })}
            >
              停牌
            </button>
            <button
              type="button"
              className="bro-blackjack__double"
              disabled={!canDouble(game, 0)}
              onClick={() => act({ type: "double" })}
            >
              加倍
            </button>
          </div>

          <div className="bro-blackjack__wager" aria-label="选择下一局下注">
            <span>
              下一局下注 <strong>{nextWager}</strong>
            </span>
            <div>
              {wagerOptions.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={nextWager === amount ? "is-active" : ""}
                  aria-label={`${amount} 筹码`}
                  aria-pressed={nextWager === amount}
                  disabled={amount > hero.stack}
                  onClick={() => setNextWager(amount)}
                >
                  {amount}
                </button>
              ))}
            </div>
            <small>当前局已押 {hero.wager}</small>
          </div>

          <AnimatePresence>
            {resultReady && game.phase === "settled" && (
              <RoundResult
                game={game}
                nextWager={nextWager}
                onNext={() =>
                  setGame((current) => nextBlackjackRound(current, nextWager))
                }
              />
            )}
          </AnimatePresence>
        </section>
      </main>
    </MotionConfig>
  );
}

function DealerArea({ game }: { readonly game: BlackjackState }) {
  const reveal = game.phase === "settled";
  const visibleHand = reveal ? game.dealer.hand : game.dealer.hand.slice(0, 1);
  const value = blackjackHandValue(visibleHand);
  return (
    <div className="bro-blackjack__dealer">
      <div className="bro-blackjack__dealer-label">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>庄家</strong>
          <small>{reveal ? `${value.total} 点` : "明牌计分"}</small>
        </span>
      </div>
      <div className="bro-blackjack__dealer-hand" aria-label="庄家手牌">
        {game.dealer.hand.map((card, index) => (
          <BlackjackCardView
            key={`${game.round}-dealer-${card.id}-${index}`}
            card={card}
            hidden={index === 1 && !reveal}
            delay={0.12 + index * 0.16}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerArea({
  player,
  position,
  active,
  thinking,
  decisionWindow,
  round,
}: {
  readonly player: BlackjackPlayer;
  readonly position: "left" | "right" | "hero";
  readonly active: boolean;
  readonly thinking: boolean;
  readonly decisionWindow: DecisionWindow | null;
  readonly round: number;
}) {
  const value = blackjackHandValue(player.hand);
  const outcome = player.outcome ? OUTCOME_LABEL[player.outcome] : null;
  return (
    <div
      className="bro-blackjack__player"
      data-position={position}
      data-active={active ? "" : undefined}
      data-busted={player.status === "busted" ? "" : undefined}
    >
      <div
        className="bro-blackjack__player-hand"
        aria-label={`${player.name} 公开手牌`}
      >
        {player.hand.map((card, index) => (
          <BlackjackCardView
            key={`${round}-${player.seat}-${card.id}-${index}`}
            card={card}
            delay={0.08 * (player.seat + index + 1)}
          />
        ))}
      </div>
      <div className="bro-blackjack__player-info">
        <span className="bro-blackjack__avatar" aria-hidden="true">
          <UserRound />
        </span>
        <span>
          <strong>{player.name}</strong>
          <small>
            {thinking
              ? "思考中"
              : (outcome ?? (active ? "行动中" : `下注 ${player.wager}`))}
          </small>
        </span>
        <b>{value.total}</b>
        <em>{player.stack}</em>
      </div>
      {active && decisionWindow && (
        <DecisionClock
          key={decisionWindow.key}
          window={decisionWindow}
          label={position === "hero" ? "你的决策" : "决策中"}
          compact={position !== "hero"}
        />
      )}
    </div>
  );
}

const OUTCOME_LABEL = {
  blackjack: "天然 21 点 · 3:2",
  win: "获胜",
  push: "推和",
  lose: "落败",
  bust: "爆牌",
} as const;

function BlackjackCardView({
  card,
  hidden = false,
  delay,
}: {
  readonly card?: BlackjackCard;
  readonly hidden?: boolean;
  readonly delay: number;
}) {
  return (
    <motion.img
      className="bro-blackjack__card"
      src={hidden || !card ? playingCardBackUrl() : playingCardAssetUrl(card)}
      alt={hidden || !card ? "庄家暗牌" : playingCardLabel(card)}
      initial={{ opacity: 0, x: 110, y: -90, rotate: 12, scale: 0.45 }}
      animate={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
      transition={{
        delay,
        duration: 0.48,
        type: "spring",
        stiffness: 190,
        damping: 20,
      }}
    />
  );
}

function RoundResult({
  game,
  nextWager,
  onNext,
}: {
  readonly game: BlackjackState;
  readonly nextWager: number;
  readonly onNext: () => void;
}) {
  const hero = game.players[0];
  const points = heroPointReward(game);
  return (
    <motion.div
      className="bro-blackjack__result"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 14 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <span>{OUTCOME_LABEL[hero.outcome!]}</span>
      <h2>{resultHeadline(hero)}</h2>
      <p>
        返还筹码 {hero.payout} · 当前筹码 {hero.stack}
        {points > 0 ? ` · +${points} 积分` : ""}
      </p>
      <TableReward points={points} />
      <button type="button" onClick={onNext}>
        下注 {nextWager} · 下一局
      </button>
    </motion.div>
  );
}

function resultHeadline(player: BlackjackPlayer): string {
  if (player.outcome === "blackjack") return "天然 21 点";
  if (player.outcome === "win") return "这一手你赢了";
  if (player.outcome === "push") return "推和，退回下注";
  if (player.outcome === "bust") return "超过 21 点";
  return "庄家拿下这一手";
}
