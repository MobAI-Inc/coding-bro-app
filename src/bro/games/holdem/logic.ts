import { tableStrategyProfile } from "../core/table-balance";

export type Suit = "S" | "H" | "D" | "C";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface PokerCard {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
}

export type HoldemStage = "preflop" | "flop" | "turn" | "river" | "complete";

export type PlayerStatus = "active" | "folded" | "all-in";

export interface HoldemPlayer {
  readonly seat: number;
  readonly name: string;
  readonly stack: number;
  readonly hole: readonly PokerCard[];
  readonly status: PlayerStatus;
  readonly committedRound: number;
  readonly committedHand: number;
  readonly acted: boolean;
}

export type HoldemAction =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | { readonly type: "call" }
  | { readonly type: "raise"; readonly to: number };

export interface HoldemResult {
  readonly winnerSeats: readonly number[];
  readonly pot: number;
  readonly label: string;
  readonly reason: "fold" | "showdown";
  readonly winningCards: readonly PokerCard[];
}

export interface HoldemActionLog {
  readonly id: number;
  readonly seat: number;
  readonly type: HoldemAction["type"] | "small-blind" | "big-blind";
  readonly amount: number;
  readonly label: string;
}

export interface HoldemState {
  readonly handNumber: number;
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly activeSeat: number | null;
  readonly stage: HoldemStage;
  readonly deck: readonly PokerCard[];
  readonly deckIndex: number;
  readonly community: readonly PokerCard[];
  readonly players: readonly HoldemPlayer[];
  readonly pot: number;
  readonly currentBet: number;
  readonly minRaise: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startingStack: number;
  readonly seed: number;
  readonly actionId: number;
  readonly lastAction: HoldemActionLog | null;
  readonly result: HoldemResult | null;
}

export interface LegalActions {
  readonly fold: boolean;
  readonly check: boolean;
  readonly call: number;
  readonly minRaiseTo: number | null;
  readonly maxRaiseTo: number;
}

export interface HandValue {
  readonly category: number;
  readonly label: string;
  readonly score: readonly number[];
  readonly cards: readonly PokerCard[];
}

const SUITS: readonly Suit[] = ["S", "H", "D", "C"];
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const HAND_LABELS = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
] as const;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export function createDeck(): PokerCard[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${rank}${suit}`, suit, rank })),
  );
}

export function shuffledDeck(seed: number): PokerCard[] {
  const cards = createDeck();
  const random = seededRandom(seed);
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function nextSeat(seat: number, count: number): number {
  return (seat + 1) % count;
}

function firstSeatAfter(
  seat: number,
  players: readonly HoldemPlayer[],
  predicate: (player: HoldemPlayer) => boolean,
): number | null {
  for (let step = 1; step <= players.length; step += 1) {
    const candidate = players[(seat + step) % players.length];
    if (predicate(candidate)) return candidate.seat;
  }
  return null;
}

function commit(player: HoldemPlayer, requested: number): HoldemPlayer {
  const paid = Math.min(player.stack, Math.max(0, requested));
  const stack = player.stack - paid;
  return {
    ...player,
    stack,
    committedRound: player.committedRound + paid,
    committedHand: player.committedHand + paid,
    status: stack === 0 ? "all-in" : player.status,
  };
}

function dealHoleCards(
  players: readonly HoldemPlayer[],
  deck: readonly PokerCard[],
  dealerSeat: number,
): { players: HoldemPlayer[]; deckIndex: number } {
  const holes = players.map(() => [] as PokerCard[]);
  let deckIndex = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let step = 1; step <= players.length; step += 1) {
      const seat = (dealerSeat + step) % players.length;
      holes[seat].push(deck[deckIndex++]);
    }
  }
  return {
    players: players.map((player) => ({ ...player, hole: holes[player.seat] })),
    deckIndex,
  };
}

export function createHoldemGame(
  options: {
    readonly names?: readonly string[];
    readonly seed?: number;
    readonly startingStack?: number;
    readonly smallBlind?: number;
    readonly bigBlind?: number;
    readonly dealerSeat?: number;
  } = {},
): HoldemState {
  const names = options.names ?? ["你", "林川", "Mika"];
  if (names.length < 3) throw new Error("Texas Hold'em needs at least 3 seats");
  const startingStack = options.startingStack ?? 500;
  const players = names.slice(0, 3).map((name, seat) => ({
    seat,
    name,
    stack: startingStack,
    hole: [] as readonly PokerCard[],
    status: "active" as const,
    committedRound: 0,
    committedHand: 0,
    acted: false,
  }));
  return startHand({
    previousPlayers: players,
    dealerSeat: options.dealerSeat ?? 0,
    handNumber: 1,
    seed: options.seed ?? Date.now(),
    startingStack,
    smallBlind: options.smallBlind ?? 10,
    bigBlind: options.bigBlind ?? 20,
  });
}

function startHand(options: {
  readonly previousPlayers: readonly HoldemPlayer[];
  readonly dealerSeat: number;
  readonly handNumber: number;
  readonly seed: number;
  readonly startingStack: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
}): HoldemState {
  const deck = shuffledDeck(options.seed);
  const resetPlayers = options.previousPlayers.map((player) => ({
    ...player,
    stack:
      player.stack < options.bigBlind ? options.startingStack : player.stack,
    hole: [] as readonly PokerCard[],
    status: "active" as const,
    committedRound: 0,
    committedHand: 0,
    acted: false,
  }));
  const dealt = dealHoleCards(resetPlayers, deck, options.dealerSeat);
  const smallBlindSeat = nextSeat(options.dealerSeat, dealt.players.length);
  const bigBlindSeat = nextSeat(smallBlindSeat, dealt.players.length);
  const smallPaid = Math.min(
    dealt.players[smallBlindSeat].stack,
    options.smallBlind,
  );
  dealt.players[smallBlindSeat] = commit(
    dealt.players[smallBlindSeat],
    options.smallBlind,
  );
  const bigPaid = Math.min(dealt.players[bigBlindSeat].stack, options.bigBlind);
  dealt.players[bigBlindSeat] = commit(
    dealt.players[bigBlindSeat],
    options.bigBlind,
  );
  const activeSeat = firstSeatAfter(
    bigBlindSeat,
    dealt.players,
    (player) => player.status === "active",
  );
  return {
    handNumber: options.handNumber,
    dealerSeat: options.dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    activeSeat,
    stage: "preflop",
    deck,
    deckIndex: dealt.deckIndex,
    community: [],
    players: dealt.players,
    pot: smallPaid + bigPaid,
    currentBet: bigPaid,
    minRaise: options.bigBlind,
    smallBlind: options.smallBlind,
    bigBlind: options.bigBlind,
    startingStack: options.startingStack,
    seed: options.seed,
    actionId: 0,
    lastAction: null,
    result: null,
  };
}

export function nextHoldemHand(state: HoldemState): HoldemState {
  return startHand({
    previousPlayers: state.players,
    dealerSeat: nextSeat(state.dealerSeat, state.players.length),
    handNumber: state.handNumber + 1,
    seed: state.seed + state.handNumber * 7919,
    startingStack: state.startingStack,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
  });
}

export function legalActions(state: HoldemState, seat: number): LegalActions {
  const player = state.players[seat];
  if (
    state.stage === "complete" ||
    state.activeSeat !== seat ||
    !player ||
    player.status !== "active"
  ) {
    return {
      fold: false,
      check: false,
      call: 0,
      minRaiseTo: null,
      maxRaiseTo: 0,
    };
  }
  const call = Math.min(
    player.stack,
    Math.max(0, state.currentBet - player.committedRound),
  );
  const maxRaiseTo = player.committedRound + player.stack;
  const minimum = state.currentBet + state.minRaise;
  return {
    fold: state.players.filter((p) => p.status !== "folded").length > 1,
    check: call === 0,
    call,
    minRaiseTo: maxRaiseTo >= minimum ? minimum : null,
    maxRaiseTo,
  };
}

function actionLabel(
  player: HoldemPlayer,
  action: HoldemAction,
  amount: number,
): string {
  switch (action.type) {
    case "fold":
      return `${player.name} 弃牌`;
    case "check":
      return `${player.name} 过牌`;
    case "call":
      return `${player.name} 跟注 ${amount}`;
    case "raise":
      return `${player.name} 加注到 ${action.to}`;
  }
}

export function applyHoldemAction(
  state: HoldemState,
  seat: number,
  action: HoldemAction,
): HoldemState {
  const legal = legalActions(state, seat);
  const player = state.players[seat];
  if (!player || state.activeSeat !== seat) return state;
  const players = state.players.map((item) => ({ ...item }));
  let amount = 0;
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;

  if (action.type === "fold") {
    if (!legal.fold) return state;
    players[seat] = { ...players[seat], status: "folded", acted: true };
  } else if (action.type === "check") {
    if (!legal.check) return state;
    players[seat] = { ...players[seat], acted: true };
  } else if (action.type === "call") {
    if (legal.call <= 0) return state;
    amount = legal.call;
    players[seat] = { ...commit(players[seat], amount), acted: true };
  } else {
    if (
      legal.minRaiseTo === null ||
      action.to < legal.minRaiseTo ||
      action.to > legal.maxRaiseTo
    ) {
      return state;
    }
    amount = action.to - player.committedRound;
    minRaise = action.to - state.currentBet;
    currentBet = action.to;
    for (const contender of players) {
      if (contender.status === "active") contender.acted = false;
    }
    players[seat] = { ...commit(players[seat], amount), acted: true };
  }

  const next: HoldemState = {
    ...state,
    players,
    pot: state.pot + amount,
    currentBet,
    minRaise,
    actionId: state.actionId + 1,
    lastAction: {
      id: state.actionId + 1,
      seat,
      type: action.type,
      amount,
      label: actionLabel(player, action, amount),
    },
  };
  return advance(next, seat);
}

function advance(state: HoldemState, actedSeat: number): HoldemState {
  const contenders = state.players.filter((p) => p.status !== "folded");
  if (contenders.length === 1) return finishByFold(state, contenders[0].seat);

  const actors = state.players.filter((p) => p.status === "active");
  const roundComplete = actors.every(
    (player) => player.acted && player.committedRound === state.currentBet,
  );
  if (roundComplete) return advanceStreet(state);

  const activeSeat = firstSeatAfter(
    actedSeat,
    state.players,
    (player) => player.status === "active",
  );
  if (activeSeat === null) return runOutAndShowdown(state);
  return { ...state, activeSeat };
}

function reveal(
  state: HoldemState,
  count: number,
): Pick<HoldemState, "community" | "deckIndex"> {
  const firstCard = state.deckIndex + 1; // burn one card per street
  return {
    community: [
      ...state.community,
      ...state.deck.slice(firstCard, firstCard + count),
    ],
    deckIndex: firstCard + count,
  };
}

function advanceStreet(state: HoldemState): HoldemState {
  if (state.stage === "river") return finishShowdown(state);
  const nextStage: HoldemStage =
    state.stage === "preflop"
      ? "flop"
      : state.stage === "flop"
        ? "turn"
        : "river";
  const revealed = reveal(state, nextStage === "flop" ? 3 : 1);
  const players = state.players.map((player) => ({
    ...player,
    committedRound: 0,
    acted: false,
  }));
  const activeSeat = firstSeatAfter(
    state.dealerSeat,
    players,
    (player) => player.status === "active",
  );
  const next: HoldemState = {
    ...state,
    ...revealed,
    stage: nextStage,
    players,
    activeSeat,
    currentBet: 0,
    minRaise: state.bigBlind,
  };
  return activeSeat === null ? runOutAndShowdown(next) : next;
}

function runOutAndShowdown(state: HoldemState): HoldemState {
  let next = state;
  while (next.community.length < 5) {
    const count = next.community.length === 0 ? 3 : 1;
    const revealed = reveal(next, count);
    next = { ...next, ...revealed };
  }
  return finishShowdown(next);
}

function awardPot(
  state: HoldemState,
  winnerSeats: readonly number[],
): HoldemPlayer[] {
  const share = Math.floor(state.pot / winnerSeats.length);
  let remainder = state.pot - share * winnerSeats.length;
  return state.players.map((player) => {
    if (!winnerSeats.includes(player.seat)) return player;
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { ...player, stack: player.stack + share + extra };
  });
}

function finishByFold(state: HoldemState, winnerSeat: number): HoldemState {
  return {
    ...state,
    activeSeat: null,
    stage: "complete",
    players: awardPot(state, [winnerSeat]),
    pot: 0,
    result: {
      winnerSeats: [winnerSeat],
      pot: state.pot,
      label: "其余玩家弃牌",
      reason: "fold",
      winningCards: [],
    },
  };
}

function finishShowdown(state: HoldemState): HoldemState {
  const contenders = state.players.filter((p) => p.status !== "folded");
  const values = contenders.map((player) => ({
    seat: player.seat,
    value: evaluateHoldemHand([...player.hole, ...state.community]),
  }));
  let best = values[0];
  for (const candidate of values.slice(1)) {
    if (compareHandValues(candidate.value, best.value) > 0) best = candidate;
  }
  const winners = values
    .filter((candidate) => compareHandValues(candidate.value, best.value) === 0)
    .map((candidate) => candidate.seat);
  return {
    ...state,
    activeSeat: null,
    stage: "complete",
    players: awardPot(state, winners),
    pot: 0,
    result: {
      winnerSeats: winners,
      pot: state.pot,
      label: best.value.label,
      reason: "showdown",
      winningCards: best.value.cards,
    },
  };
}

function straightHigh(ranks: readonly number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  let length = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i - 1] - unique[i] === 1) {
      length += 1;
      if (length === 5) return unique[i - 4];
    } else {
      length = 1;
    }
  }
  return null;
}

export function evaluateFive(cards: readonly PokerCard[]): HandValue {
  if (cards.length !== 5) throw new Error("evaluateFive requires five cards");
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const groups = [...new Set(ranks)]
    .map((rank) => ({
      rank,
      count: ranks.filter((value) => value === rank).length,
    }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(ranks);
  let category = 0;
  let score: number[] = ranks;

  if (flush && straight !== null) {
    category = 8;
    score = [straight];
  } else if (groups[0].count === 4) {
    category = 7;
    score = [groups[0].rank, groups[1].rank];
  } else if (groups[0].count === 3 && groups[1].count === 2) {
    category = 6;
    score = [groups[0].rank, groups[1].rank];
  } else if (flush) {
    category = 5;
  } else if (straight !== null) {
    category = 4;
    score = [straight];
  } else if (groups[0].count === 3) {
    category = 3;
    score = [
      groups[0].rank,
      ...groups.filter((group) => group.count === 1).map((group) => group.rank),
    ];
  } else if (groups[0].count === 2 && groups[1].count === 2) {
    category = 2;
    const pairs = groups
      .filter((group) => group.count === 2)
      .map((group) => group.rank)
      .sort((a, b) => b - a);
    score = [...pairs, groups.find((group) => group.count === 1)!.rank];
  } else if (groups[0].count === 2) {
    category = 1;
    score = [
      groups[0].rank,
      ...groups.filter((group) => group.count === 1).map((group) => group.rank),
    ];
  }
  return { category, label: HAND_LABELS[category], score, cards: [...cards] };
}

export function compareHandValues(left: HandValue, right: HandValue): number {
  if (left.category !== right.category) return left.category - right.category;
  const length = Math.max(left.score.length, right.score.length);
  for (let i = 0; i < length; i += 1) {
    const difference = (left.score[i] ?? 0) - (right.score[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateHoldemHand(cards: readonly PokerCard[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("Texas Hold'em evaluation needs five to seven cards");
  }
  let best: HandValue | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const value = evaluateFive([
              cards[a],
              cards[b],
              cards[c],
              cards[d],
              cards[e],
            ]);
            if (!best || compareHandValues(value, best) > 0) best = value;
          }
        }
      }
    }
  }
  return best!;
}

export function chooseHoldemTableAction(
  state: HoldemState,
  seat: number,
  random: () => number = Math.random,
): HoldemAction {
  const legal = legalActions(state, seat);
  const player = state.players[seat];
  if (!player || state.activeSeat !== seat) return { type: "check" };

  const position = positionAdjustment(state, seat);
  const strategy = tableStrategyProfile(
    state.startingStack,
    player.stack + player.committedHand,
  );
  const equity =
    state.community.length === 0
      ? preflopStrength(player.hole) + position
      : estimateHoldemEquity(state, seat, random, 48) + position * 0.45;
  const potOdds = legal.call / Math.max(1, state.pot + legal.call);
  const stackPressure = legal.call / Math.max(1, player.stack + legal.call);
  const jitterSpan = 0.02 + strategy.mistakeRate * 1.2;
  const jitter = (random() - 0.5) * jitterSpan;
  const adjustedEquity = Math.max(0, Math.min(1, equity + jitter));
  const madeHand =
    state.community.length >= 3
      ? evaluateHoldemHand([...player.hole, ...state.community]).category
      : 0;

  if (
    legal.call > 0 &&
    (adjustedEquity <
      potOdds +
        0.045 +
        strategy.recoveryBias * 0.04 -
        strategy.releaseBias * 0.03 ||
      (stackPressure > 0.42 && adjustedEquity < 0.58))
  ) {
    return { type: "fold" };
  }

  const valueRaiseThreshold =
    (state.community.length ? 0.63 : 0.71) +
    strategy.recoveryBias * 0.04 -
    strategy.releaseBias * 0.1;
  const valueRaise = adjustedEquity > valueRaiseThreshold;
  const pressureRaise =
    legal.call === 0 &&
    adjustedEquity > 0.52 &&
    position > 0 &&
    random() < 0.22 * (1 - strategy.recoveryBias) + strategy.releaseBias * 0.3;
  const semiBluff =
    state.community.length >= 3 &&
    madeHand <= 1 &&
    adjustedEquity > 0.45 &&
    position >= 0 &&
    random() < 0.16 * (1 - strategy.recoveryBias) + strategy.releaseBias * 0.26;

  if (legal.minRaiseTo !== null && (valueRaise || pressureRaise || semiBluff)) {
    const potFraction =
      adjustedEquity > 0.79 ? 0.9 : adjustedEquity > 0.66 ? 0.7 : 0.5;
    const rawTarget =
      state.currentBet + Math.max(state.minRaise, state.pot * potFraction);
    const roundedTarget =
      Math.ceil(rawTarget / state.bigBlind) * state.bigBlind;
    return {
      type: "raise",
      to: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, roundedTarget)),
    };
  }
  if (legal.call > 0) return { type: "call" };
  return { type: "check" };
}

export function preflopStrength(hole: readonly PokerCard[]): number {
  if (hole.length !== 2) return 0;
  const [high, low] = [...hole].sort((left, right) => right.rank - left.rank);
  const pair = high.rank === low.rank;
  const suited = high.suit === low.suit;
  const gap = Math.max(0, high.rank - low.rank - 1);

  if (pair) {
    return Math.min(0.94, 0.5 + ((high.rank - 2) / 12) * 0.42);
  }

  let strength = 0.18 + (high.rank - 2) * 0.028 + (low.rank - 2) * 0.014;
  if (high.rank === 14) strength += 0.07;
  if (high.rank >= 13 && low.rank >= 10) strength += 0.08;
  if (suited) strength += 0.055;
  if (gap === 0) strength += 0.045;
  else if (gap === 1) strength += 0.02;
  else if (gap >= 4) strength -= 0.055;
  if (high.rank <= 7 && gap <= 1) strength += 0.018;
  return Math.max(0.12, Math.min(0.88, strength));
}

function positionAdjustment(state: HoldemState, seat: number): number {
  if (seat === state.dealerSeat) return 0.035;
  if (seat === state.smallBlindSeat) return -0.022;
  return 0;
}

export function estimateHoldemEquity(
  state: HoldemState,
  seat: number,
  random: () => number = Math.random,
  simulations = 48,
): number {
  const hero = state.players[seat];
  if (!hero || hero.hole.length !== 2) return 0;
  const opponentSeats = state.players
    .filter((player) => player.seat !== seat && player.status !== "folded")
    .map((player) => player.seat);
  if (opponentSeats.length === 0) return 1;

  const knownCards = new Set([
    ...hero.hole.map((card) => `${card.rank}${card.suit}`),
    ...state.community.map((card) => `${card.rank}${card.suit}`),
  ]);
  const unseen = createDeck().filter(
    (card) => !knownCards.has(`${card.rank}${card.suit}`),
  );
  const boardNeeded = 5 - state.community.length;
  let equity = 0;

  for (let trial = 0; trial < Math.max(1, simulations); trial += 1) {
    const sample = [...unseen];
    const needed = boardNeeded + opponentSeats.length * 2;
    for (let index = 0; index < needed; index += 1) {
      const swap = index + Math.floor(random() * (sample.length - index));
      [sample[index], sample[swap]] = [sample[swap], sample[index]];
    }
    const board = [...state.community, ...sample.slice(0, boardNeeded)];
    const heroValue = evaluateHoldemHand([...hero.hole, ...board]);
    const values = [heroValue];
    for (let index = 0; index < opponentSeats.length; index += 1) {
      const start = boardNeeded + index * 2;
      values.push(
        evaluateHoldemHand([...sample.slice(start, start + 2), ...board]),
      );
    }
    const best = values.reduce((current, candidate) =>
      compareHandValues(candidate, current) > 0 ? candidate : current,
    );
    const winners = values.filter(
      (candidate) => compareHandValues(candidate, best) === 0,
    );
    if (compareHandValues(heroValue, best) === 0) equity += 1 / winners.length;
  }

  return equity / Math.max(1, simulations);
}
