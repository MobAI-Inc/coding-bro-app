import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, Radio, Users } from "lucide-react";
import { LocalMatchmaking } from "../core/LocalMatchmaking";
import { DecisionClock } from "../core/DecisionClock";
import { TableReward } from "../core/TableReward";
import { playArcadeCue } from "../core/audio";
import {
  playingCardAssetUrl,
  playingCardBackUrl,
  playingCardLabel,
} from "../core/playing-card-assets";
import type { MatchmakingSnapshot } from "../core/matchmaking";
import type { GameRealtimeAccess } from "../core/realtime";
import type { DecisionWindow } from "../core/decision-timing";
import { TABLE_BASE_QUALITY } from "../core/table-balance";
import "./baccarat.css";

type Side = "闲" | "和" | "庄";
type Suit = "♠" | "♥" | "♣" | "♦";
type BaccaratRank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export interface BaccaratCard {
  readonly rank: BaccaratRank;
  readonly suit: Suit;
  readonly value: number;
}

export interface Round {
  readonly player: readonly BaccaratCard[];
  readonly banker: readonly BaccaratCard[];
  readonly playerTotal: number;
  readonly bankerTotal: number;
  readonly winner: Side;
  /** Returned table chips, including the original stake. */
  readonly reward: number;
  readonly net: number;
}

const STAKE = 10;
const INITIAL_BALANCE = 200;
const STAKE_OPTIONS = [10, 25, 50] as const;
export const BACCARAT_BETTING_WINDOW_MS = 3_000;
export const BACCARAT_DEAL_DURATION_MS = 6_200;

export interface BaccaratRoomConfig {
  readonly id: string;
  readonly name: string;
  readonly initialBalance: number;
  readonly stakeOptions: readonly [number, number, number];
}

export const DEFAULT_BACCARAT_ROOM: BaccaratRoomConfig = {
  id: "baccarat-salon",
  name: "霁光厅",
  initialBalance: INITIAL_BALANCE,
  stakeOptions: STAKE_OPTIONS,
};

/** 托管席位以 95% 基准策略押庄，其余押闲；不选择高波动和局。 */
export function chooseBaccaratTableBet(
  random: () => number = Math.random,
): Side {
  return random() < TABLE_BASE_QUALITY ? "庄" : "闲";
}

function total(cards: readonly BaccaratCard[]) {
  return cards.reduce((sum, card) => sum + card.value, 0) % 10;
}

/** Standard punto banco drawing rules, including the banker's third-card table. */
export function settleBaccarat(winner: Side, bet: Side, stake: number) {
  if (winner === "和" && bet !== "和") {
    return { payout: stake, net: 0 };
  }
  if (winner !== bet) return { payout: 0, net: -stake };
  const payout =
    winner === "和"
      ? stake * 9
      : winner === "庄"
        ? stake + stake * 0.95
        : stake * 2;
  return { payout, net: payout - stake };
}

export function dealBaccarat(
  draw: () => BaccaratCard,
  bet: Side,
  stake = STAKE,
): Round {
  const player = [draw(), draw()];
  const banker = [draw(), draw()];
  let playerTotal = total(player);
  let bankerTotal = total(banker);

  if (playerTotal < 8 && bankerTotal < 8) {
    let playerThird: BaccaratCard | null = null;
    if (playerTotal <= 5) {
      playerThird = draw();
      player.push(playerThird);
      playerTotal = total(player);
    }

    const third = playerThird?.value;
    const bankerDraws =
      third === undefined
        ? bankerTotal <= 5
        : bankerTotal <= 2 ||
          (bankerTotal === 3 && third !== 8) ||
          (bankerTotal === 4 && third >= 2 && third <= 7) ||
          (bankerTotal === 5 && third >= 4 && third <= 7) ||
          (bankerTotal === 6 && third >= 6 && third <= 7);
    if (bankerDraws) {
      banker.push(draw());
      bankerTotal = total(banker);
    }
  }

  const winner: Side =
    playerTotal === bankerTotal
      ? "和"
      : playerTotal > bankerTotal
        ? "闲"
        : "庄";
  const settlement = settleBaccarat(winner, bet, stake);
  return {
    player,
    banker,
    playerTotal,
    bankerTotal,
    winner,
    reward: settlement.payout,
    net: settlement.net,
  };
}

export function BaccaratGame({
  onSettle,
  onServerSettled,
  matchmakingDelayMs = 900,
  room = DEFAULT_BACCARAT_ROOM,
  entryPoints,
  realtime,
}: {
  onSettle?: (points: number) => void;
  onServerSettled?: () => void;
  matchmakingDelayMs?: number;
  room?: BaccaratRoomConfig;
  entryPoints?: number;
  realtime?: GameRealtimeAccess | null;
} = {}) {
  return (
    <LocalMatchmaking
      gameId="baccarat"
      roomId={room.id}
      seatCount={4}
      playerNames={BACCARAT_PLAYER_NAMES}
      fillDelayMs={matchmakingDelayMs}
      realtime={realtime}
    >
      {(match) =>
        realtime ? (
          <AuthoritativeBaccaratTable
            entryPoints={entryPoints ?? room.stakeOptions[0]}
            match={match}
            onServerSettled={onServerSettled}
            room={room}
          />
        ) : (
          <BaccaratTable match={match} onSettle={onSettle} room={room} />
        )
      }
    </LocalMatchmaking>
  );
}

const BACCARAT_PLAYER_NAMES = ["林舟", "周祁", "沈时"] as const;

interface TableBet {
  readonly name: string;
  readonly side: Side;
}

type ServerSide = "player" | "tie" | "banker";

interface ServerSeat {
  readonly seat: number;
  readonly name: string;
  readonly connected: boolean;
  readonly balance: number;
  readonly bet: { readonly side: ServerSide; readonly stake: number } | null;
  readonly lastResult: {
    readonly side: ServerSide;
    readonly stake: number;
    readonly payout: number;
    readonly net: number;
  } | null;
  readonly settlementState: "pending" | "retrying" | "settled" | null;
}

interface BaccaratServerState {
  readonly schemaVersion: 1;
  readonly gameId: "baccarat";
  readonly matchId: string;
  readonly version: number;
  readonly roundId: number;
  readonly phase: "waiting" | "betting" | "dealing" | "settled";
  readonly phaseEndsInMs: number;
  readonly selfSeat: number | null;
  readonly seats: readonly ServerSeat[];
  readonly round: {
    readonly player: readonly BaccaratCard[];
    readonly banker: readonly BaccaratCard[];
    readonly playerTotal: number | null;
    readonly bankerTotal: number | null;
    readonly winner: ServerSide | null;
  } | null;
  readonly road: readonly ServerSide[];
}

export function AuthoritativeBaccaratTable({
  entryPoints,
  match,
  onServerSettled,
  room,
}: {
  entryPoints: number;
  match: MatchmakingSnapshot;
  onServerSettled?: () => void;
  room: BaccaratRoomConfig;
}) {
  const [selected, setSelected] = useState<ServerSide>("banker");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const notifiedRound = useRef<number | null>(null);
  const state = baccaratServerState(match.serverState);
  const self = state?.seats.find((seat) => seat.seat === state.selfSeat);
  const result = self?.lastResult ?? null;

  useEffect(() => {
    if (
      !state ||
      self?.settlementState !== "settled" ||
      notifiedRound.current === state.roundId
    ) {
      return;
    }
    notifiedRound.current = state.roundId;
    playArcadeCue(
      result && result.net > 0
        ? "win"
        : result && result.net < 0
          ? "lose"
          : "enter",
    );
    onServerSettled?.();
  }, [onServerSettled, result, self?.settlementState, state]);

  const placeBet = async () => {
    if (!match.sendAction || !state || state.phase !== "betting" || self?.bet) {
      return;
    }
    setSending(true);
    setActionError(null);
    try {
      await match.sendAction(1, { side: selected });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  const decisionWindow: DecisionWindow | null =
    state && state.phase === "betting"
      ? {
          key: `baccarat-server-${state.matchId}-${state.roundId}-${state.version}`,
          seat: state.selfSeat ?? 0,
          startedAt: Date.now(),
          durationMs: state.phaseEndsInMs,
        }
      : null;
  const winner = serverSideLabel(state?.round?.winner ?? null);
  const tableBets =
    state?.seats.filter((seat) => seat.bet && seat.seat !== state.selfSeat) ??
    [];
  const canBet =
    Boolean(match.sendAction) &&
    state?.phase === "betting" &&
    !self?.bet &&
    !sending;

  return (
    <main className="bro-baccarat bro-game-shell">
      <header className="bro-game-hero">
        <div>
          <span className="bro-game-kicker">百家乐 · 云端权威牌桌</span>
          <h2>{room.name}</h2>
          <p>
            <Users size={15} /> 四人牌桌 · 服务端发牌与结算
          </p>
        </div>
        <div className="bro-game-pot">
          <CircleDollarSign size={17} />
          <span>本局入场积分</span>
          <strong aria-label="本局入场积分">{entryPoints}</strong>
        </div>
      </header>
      <section
        className={`bro-baccarat__table ${state?.phase === "dealing" ? "is-dealing" : ""} ${result?.net && result.net > 0 ? "is-win" : ""} ${result?.net && result.net < 0 ? "is-loss" : ""}`}
        aria-label="云端百家乐牌桌"
      >
        <div className="bro-baccarat__ambient" aria-hidden="true" />
        <div className="bro-baccarat__feltline" />
        <div className="bro-baccarat__dealer" aria-hidden="true">
          <span className="bro-baccarat__dealer-head" />
          <span className="bro-baccarat__dealer-body" />
          <i>荷官</i>
        </div>
        <div className="bro-baccarat__shoe" aria-hidden="true">
          <span />
          <b>SERVER</b>
        </div>
        <div className="bro-baccarat__seats" aria-label="牌桌玩家">
          {(state?.seats ?? match.seats).map((seat) => (
            <span
              key={seat.seat}
              className={seat.seat === state?.selfSeat ? "is-you" : ""}
              title={seat.name}
            >
              {seat.seat === state?.selfSeat ? "YOU" : seat.name.slice(0, 2)}
            </span>
          ))}
        </div>
        <div className="bro-baccarat__hands">
          <Hand
            label="闲家"
            cards={state?.round?.player}
            value={state?.round?.playerTotal ?? undefined}
            dealing={state?.phase === "dealing"}
            revealCount={state?.round?.player.length ?? 0}
            winning={state?.phase === "settled" && winner === "闲"}
          />
          <div className="bro-baccarat__vs">
            <Radio size={13} /> 牌桌
          </div>
          <Hand
            label="庄家"
            cards={state?.round?.banker}
            value={state?.round?.bankerTotal ?? undefined}
            dealing={state?.phase === "dealing"}
            revealCount={state?.round?.banker.length ?? 0}
            winning={state?.phase === "settled" && winner === "庄"}
          />
        </div>
        <div
          className={`bro-baccarat__result ${result && result.net > 0 ? "is-reward" : ""} ${result && result.net < 0 ? "is-loss" : ""}`}
          role="status"
        >
          {!state
            ? "正在同步云端牌桌…"
            : state.phase === "betting"
              ? self?.bet
                ? `已押${serverSideLabel(self.bet.side)} ${self.bet.stake}，等待封盘`
                : `请选择下注区域，本局固定投入 ${entryPoints} 积分`
              : state.phase === "dealing"
                ? "荷官正在逐张开牌…"
                : result
                  ? `${outcomeLabel(winner ?? "和")} · 本局 ${formatSigned(result.net)} · 返还 ${result.payout} 积分`
                  : "本局已封盘"}
        </div>
        {decisionWindow && (
          <div className="bro-baccarat__betting-clock">
            <DecisionClock window={decisionWindow} label="决策倒计时" />
            <small>倒计时由游戏服务器控制</small>
          </div>
        )}
        {result && result.payout > 0 && state?.phase === "settled" && (
          <div className="bro-baccarat__reward-pop">
            <TableReward points={result.payout} />
          </div>
        )}
        {tableBets.length > 0 && (
          <div className="bro-baccarat__table-bets" aria-live="polite">
            {tableBets.map((seat) => (
              <span key={seat.seat}>
                <b>{seat.name}</b>
                <i data-side={serverSideLabel(seat.bet!.side)}>
                  {serverSideLabel(seat.bet!.side)}
                </i>
              </span>
            ))}
          </div>
        )}
        <div className="bro-baccarat__road" aria-label="最近牌路">
          <span>珠盘</span>
          {(state?.road.length
            ? state.road.map((side) => serverSideLabel(side))
            : ["·", "·", "·", "·", "·", "·"]
          ).map((item, index) => (
            <i key={index} data-side={item}>
              {item}
            </i>
          ))}
        </div>
        <div className="bro-baccarat__betting-console">
          <div className="bro-baccarat__odds-note">
            <strong>标准 Punto Banco 赔率</strong>
            <span>闲 1:1 · 和 8:1 · 庄 0.95:1；押闲或庄遇和退回本金</span>
          </div>
          <div className="bro-baccarat__bets" aria-label="选择下注区域">
            {(["player", "tie", "banker"] as const).map((side) => {
              const label = serverSideLabel(side)!;
              const odds =
                side === "tie"
                  ? "8 : 1"
                  : side === "banker"
                    ? "0.95 : 1"
                    : "1 : 1";
              const active = (self?.bet?.side ?? selected) === side;
              return (
                <button
                  key={side}
                  className={active ? "is-active" : ""}
                  data-side={label}
                  type="button"
                  aria-pressed={active}
                  disabled={!canBet}
                  onClick={() => setSelected(side)}
                >
                  <span>{label === "和" ? "和局" : `${label}家`}</span>
                  <strong>{odds}</strong>
                  <small>净赢赔率</small>
                  {active && (
                    <i className="bro-baccarat__placed-chip" aria-hidden="true">
                      {entryPoints}
                    </i>
                  )}
                </button>
              );
            })}
          </div>
          {actionError || match.error ? (
            <p className="bro-baccarat__action-error" role="alert">
              {actionError ?? match.error}
            </p>
          ) : null}
          <button
            className="bro-game-primary"
            type="button"
            onClick={() => void placeBet()}
            disabled={!canBet}
          >
            {sending
              ? "正在提交下注…"
              : self?.bet
                ? `已押${serverSideLabel(self.bet.side)} ${self.bet.stake}`
                : state?.phase === "betting"
                  ? `确认下注 ${entryPoints}`
                  : state?.phase === "dealing"
                    ? "发牌中"
                    : "本局已结束"}
          </button>
        </div>
      </section>
    </main>
  );
}

function baccaratServerState(value: unknown): BaccaratServerState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as BaccaratServerState;
  if (
    raw.schemaVersion !== 1 ||
    raw.gameId !== "baccarat" ||
    !Array.isArray(raw.seats)
  ) {
    return null;
  }
  return {
    ...raw,
    round: raw.round
      ? {
          ...raw.round,
          player: raw.round.player.map(serverCard),
          banker: raw.round.banker.map(serverCard),
        }
      : null,
  };
}

function serverCard(card: BaccaratCard): BaccaratCard {
  const suit = String(card.suit);
  return {
    ...card,
    suit:
      suit === "spades"
        ? "♠"
        : suit === "hearts"
          ? "♥"
          : suit === "clubs"
            ? "♣"
            : suit === "diamonds"
              ? "♦"
              : card.suit,
  };
}

function serverSideLabel(side: ServerSide | null): Side | null {
  if (side === "player") return "闲";
  if (side === "banker") return "庄";
  if (side === "tie") return "和";
  return null;
}

interface RoundHistory {
  readonly id: number;
  readonly bet: Side;
  readonly winner: Side;
  readonly stake: number;
  readonly net: number;
  readonly balanceAfter: number;
}

function BaccaratTable({
  match,
  onSettle,
  room,
}: {
  match: MatchmakingSnapshot;
  onSettle?: (points: number) => void;
  room: BaccaratRoomConfig;
}) {
  const shoeRef = useRef<BaccaratCard[]>(createShoe());
  const [bet, setBet] = useState<Side>("庄");
  const [stake, setStake] = useState<number>(room.stakeOptions[0]);
  const [balance, setBalance] = useState(room.initialBalance);
  const [round, setRound] = useState<Round | null>(null);
  const [revealed, setRevealed] = useState<readonly [number, number]>([0, 0]);
  const [resolved, setResolved] = useState(false);
  const [road, setRoad] = useState<Side[]>([]);
  const [history, setHistory] = useState<RoundHistory[]>([]);
  const [bettingLocked, setBettingLocked] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [decisionWindow, setDecisionWindow] = useState<DecisionWindow | null>(
    null,
  );
  const [tableBets, setTableBets] = useState<readonly TableBet[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const deal = () => {
    if (bettingLocked || dealing || balance < stake) return;
    const placedBet = bet;
    const placedStake = stake;
    const afterStake = balance - placedStake;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    if (shoeRef.current.length < 24) shoeRef.current = createShoe();
    const next = dealBaccarat(
      () => shoeRef.current.pop()!,
      placedBet,
      placedStake,
    );
    setBalance(afterStake);
    setBettingLocked(true);
    setDecisionWindow({
      key: `baccarat-${history.length + 1}-${Date.now()}`,
      seat: 0,
      startedAt: Date.now(),
      durationMs: BACCARAT_BETTING_WINDOW_MS,
    });
    setDealing(false);
    setResolved(false);
    setRound(next);
    setRevealed([0, 0]);
    playArcadeCue("enter");

    const revealOrder: { hand: 0 | 1; count: number }[] = [
      { hand: 0, count: 1 },
      { hand: 1, count: 1 },
      { hand: 0, count: 2 },
      { hand: 1, count: 2 },
    ];
    if (next.player.length === 3) revealOrder.push({ hand: 0, count: 3 });
    if (next.banker.length === 3) revealOrder.push({ hand: 1, count: 3 });
    revealOrder.forEach((step, index) => {
      timersRef.current.push(
        window.setTimeout(
          () => {
            setRevealed((current) => {
              const counts = [...current] as [number, number];
              counts[step.hand] = step.count;
              return counts;
            });
            playArcadeCue("tap");
          },
          BACCARAT_BETTING_WINDOW_MS + 220 + index * 420,
        ),
      );
    });

    timersRef.current.push(
      window.setTimeout(() => {
        setBettingLocked(false);
        setDecisionWindow(null);
        setDealing(true);
        playArcadeCue("enter");
      }, BACCARAT_BETTING_WINDOW_MS),
    );

    setTableBets(
      match.seats
        .filter((seat) => seat.kind === "player" && !seat.isSelf)
        .map((seat) => {
          return {
            name: seat.name,
            side: chooseBaccaratTableBet(),
          };
        }),
    );

    timersRef.current.push(
      window.setTimeout(() => {
        const balanceAfter = afterStake + next.reward;
        setResolved(true);
        setBalance(balanceAfter);
        setRoad((items) => [...items.slice(-11), next.winner]);
        setHistory((items) => [
          ...items.slice(-7),
          {
            id: (items.at(-1)?.id ?? 0) + 1,
            bet: placedBet,
            winner: next.winner,
            stake: placedStake,
            net: next.net,
            balanceAfter,
          },
        ]);
        // 桌内筹码可保留 0.5 / 0.25 以准确表达庄 5% 佣金；全局积分账本只收整数。
        if (next.net > 0) onSettle?.(Math.round(next.net));
        playArcadeCue(next.net > 0 ? "win" : next.net < 0 ? "lose" : "enter");
        setBettingLocked(false);
        setDecisionWindow(null);
        setDealing(false);
      }, BACCARAT_DEAL_DURATION_MS),
    );
  };

  return (
    <main className="bro-baccarat bro-game-shell">
      <header className="bro-game-hero">
        <div>
          <span className="bro-game-kicker">百家乐 · 八副牌牌靴</span>
          <h2>{room.name}</h2>
          <p>
            <Users size={15} /> 四人牌桌 · 标准补牌规则
          </p>
        </div>
        <div className="bro-game-pot">
          <CircleDollarSign size={17} />
          <span>我的桌内筹码</span>
          <strong aria-label="当前筹码余额">{balance}</strong>
        </div>
      </header>
      <section
        className={`bro-baccarat__table ${bettingLocked ? "is-betting-locked" : ""} ${dealing ? "is-dealing" : ""} ${resolved && round?.net && round.net > 0 ? "is-win" : ""} ${resolved && round?.net && round.net < 0 ? "is-loss" : ""}`}
        aria-label="百家乐牌桌"
      >
        <div className="bro-baccarat__ambient" aria-hidden="true" />
        <div className="bro-baccarat__feltline" />
        <div className="bro-baccarat__dealer" aria-hidden="true">
          <span className="bro-baccarat__dealer-head" />
          <span className="bro-baccarat__dealer-body" />
          <i>荷官</i>
        </div>
        <div className="bro-baccarat__shoe" aria-hidden="true">
          <span />
          <b>{Math.ceil(shoeRef.current.length / 52)}</b>
        </div>
        <div className="bro-baccarat__hands">
          <Hand
            label="闲家"
            cards={round?.player}
            value={round?.playerTotal}
            dealing={bettingLocked || dealing}
            revealCount={revealed[0]}
            winning={resolved && round?.winner === "闲"}
          />
          <div className="bro-baccarat__vs">
            <Radio size={13} /> 牌桌
          </div>
          <Hand
            label="庄家"
            cards={round?.banker}
            value={round?.bankerTotal}
            dealing={bettingLocked || dealing}
            revealCount={revealed[1]}
            winning={resolved && round?.winner === "庄"}
          />
        </div>
        <div
          className={`bro-baccarat__result ${resolved && round && round.net > 0 ? "is-reward" : ""} ${resolved && round && round.net < 0 ? "is-loss" : ""}`}
          role="status"
        >
          {bettingLocked
            ? `已下注 ${stake} · 封盘后开始发牌`
            : dealing
              ? "正在发牌…"
              : round && resolved
                ? `${outcomeLabel(round.winner)} · 本局 ${formatSigned(round.net)} · ${round.reward ? `返还 ${round.reward} 筹码` : "未返还筹码"} · 余额 ${balance}`
                : "选择下注区域，开始下一局"}
        </div>
        {bettingLocked && decisionWindow && (
          <div className="bro-baccarat__betting-clock">
            <DecisionClock
              key={decisionWindow.key}
              window={decisionWindow}
              label="封盘倒计时"
            />
            <small>封盘后逐张开牌</small>
          </div>
        )}
        {resolved && round && round.net > 0 && (
          <div className="bro-baccarat__reward-pop">
            <TableReward points={Math.round(round.net)} />
          </div>
        )}
        {tableBets.length > 0 && (
          <div className="bro-baccarat__table-bets" aria-live="polite">
            {tableBets.map((item) => (
              <span key={item.name}>
                <b>{item.name}</b>
                <i data-side={item.side}>{item.side}</i>
              </span>
            ))}
          </div>
        )}
        <div className="bro-baccarat__road" aria-label="最近牌路">
          <span>珠盘</span>
          {(road.length ? road : ["·", "·", "·", "·", "·", "·"]).map(
            (item, index) => (
              <i key={index} data-side={item}>
                {item}
              </i>
            ),
          )}
        </div>
        <div className="bro-baccarat__betting-console">
          <div className="bro-baccarat__odds-note">
            <strong>本桌固定赔率</strong>
            <span>押闲或庄遇和局退回本金 · 庄赢收取 5% 佣金</span>
          </div>
          <div className="bro-baccarat__bets" aria-label="选择下注区域">
            {(["闲", "和", "庄"] as const).map((side) => {
              const name =
                side === "闲" ? "闲家" : side === "庄" ? "庄家" : "和局";
              const odds =
                side === "和" ? "8 : 1" : side === "庄" ? "0.95 : 1" : "1 : 1";
              return (
                <button
                  key={side}
                  className={bet === side ? "is-active" : ""}
                  data-side={side}
                  type="button"
                  aria-label={`${name}，净赢 ${odds}`}
                  aria-pressed={bet === side}
                  disabled={bettingLocked || dealing}
                  onClick={() => setBet(side)}
                >
                  <span>{name}</span>
                  <strong>{odds}</strong>
                  <small>净赢赔率</small>
                  {bet === side && (
                    <i className="bro-baccarat__placed-chip" aria-hidden="true">
                      {stake}
                    </i>
                  )}
                </button>
              );
            })}
          </div>
          <div className="bro-baccarat__stake" aria-label="选择下注筹码">
            <span>选择筹码</span>
            {room.stakeOptions.map((amount) => (
              <button
                key={amount}
                type="button"
                className={stake === amount ? "is-active" : ""}
                aria-pressed={stake === amount}
                disabled={bettingLocked || dealing || amount > balance}
                onClick={() => setStake(amount)}
              >
                {amount}
              </button>
            ))}
          </div>
          <button
            className="bro-game-primary"
            type="button"
            onClick={deal}
            disabled={bettingLocked || dealing || balance < stake}
          >
            {bettingLocked
              ? `已下注 ${stake} · 等待封盘`
              : dealing
                ? `已下注 ${stake} · 发牌中`
                : balance < stake
                  ? "筹码不足"
                  : `下注 ${stake} · 发牌`}
          </button>
        </div>
        <section className="bro-baccarat__history" aria-label="连续战绩">
          <div className="bro-baccarat__history-head">
            <span>本桌战绩</span>
            <strong>
              {history.length ? `已完成 ${history.length} 局` : "等待首局"}
            </strong>
          </div>
          <ol>
            {history.length ? (
              history
                .slice()
                .reverse()
                .map((item) => (
                  <li key={item.id} data-net={Math.sign(item.net)}>
                    <span>#{String(item.id).padStart(2, "0")}</span>
                    <b>
                      押{item.bet} {item.stake}
                    </b>
                    <em>{outcomeLabel(item.winner)}</em>
                    <strong>{formatSigned(item.net)}</strong>
                    <small>余额 {item.balanceAfter}</small>
                  </li>
                ))
            ) : (
              <li className="is-empty">
                每局扣款、返还和净盈亏会连续记录在这里
              </li>
            )}
          </ol>
        </section>
      </section>
    </main>
  );
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function outcomeLabel(winner: Side): string {
  return winner === "和" ? "和局" : `${winner}赢`;
}

function Hand({
  label,
  cards,
  value,
  dealing,
  revealCount,
  winning,
}: {
  label: string;
  cards?: readonly BaccaratCard[];
  value?: number;
  dealing: boolean;
  revealCount: number;
  winning: boolean;
}) {
  return (
    <div className={`bro-baccarat__hand ${winning ? "is-winning" : ""}`}>
      <span>{label}</span>
      <div className="bro-baccarat__cards">
        {(cards ?? [null, null]).map((card, index) =>
          card && index < revealCount ? (
            <PlayingCard
              key={`${card.rank}-${card.suit}-${index}`}
              card={card}
              dealing={dealing}
            />
          ) : (
            <div
              key={index}
              className={`bro-baccarat__card ${cards ? "is-face-down" : "is-empty"}`}
            >
              {cards ? (
                <img src={playingCardBackUrl()} alt="牌背" draggable={false} />
              ) : (
                <b>?</b>
              )}
            </div>
          ),
        )}
      </div>
      <strong>
        {value === undefined
          ? "等待"
          : dealing
            ? `已开 ${revealCount} 张`
            : `${value} 点`}
      </strong>
    </div>
  );
}

function PlayingCard({
  card,
  dealing,
}: {
  card: BaccaratCard;
  dealing: boolean;
}) {
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={`bro-baccarat__card ${dealing ? "is-dealing" : ""}`}
      data-red={red ? "" : undefined}
    >
      <img
        src={playingCardAssetUrl(card)}
        alt={playingCardLabel(card)}
        draggable={false}
      />
    </div>
  );
}

function createShoe(): BaccaratCard[] {
  const suits: readonly Suit[] = ["♠", "♥", "♣", "♦"];
  const ranks: readonly BaccaratRank[] = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const cards: BaccaratCard[] = [];
  for (let deck = 0; deck < 8; deck += 1) {
    for (const suit of suits) {
      for (let index = 0; index < ranks.length; index += 1) {
        cards.push({
          rank: ranks[index],
          suit,
          value: index === 0 ? 1 : Math.min(index + 1, 10) % 10,
        });
      }
    }
  }
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
