import { tableStrategyProfile } from "../core/table-balance";

export type BlackjackSuit = "S" | "H" | "D" | "C";
export type BlackjackRank =
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14;

export interface BlackjackCard {
  readonly id: string;
  readonly suit: BlackjackSuit;
  readonly rank: BlackjackRank;
}

export interface BlackjackRoomConfig {
  readonly id: string;
  readonly label: string;
  readonly tableLabel: string;
  readonly startingChips: number;
  readonly minBet: number;
  readonly defaultBet: number;
  /** 玩家净赢筹码换算成积分时使用的房间倍率。 */
  readonly rewardMultiplier: number;
}

export const DEFAULT_BLACKJACK_ROOM: BlackjackRoomConfig = {
  id: "ceramic-club",
  label: "陶瓷俱乐部",
  tableLabel: "三人公开桌",
  startingChips: 500,
  minBet: 20,
  defaultBet: 40,
  rewardMultiplier: 1,
};

export type BlackjackPlayerStatus =
  | "playing"
  | "standing"
  | "busted"
  | "blackjack";

export type BlackjackOutcome = "blackjack" | "win" | "push" | "lose" | "bust";

export interface BlackjackPlayer {
  readonly seat: number;
  readonly name: string;
  readonly stack: number;
  readonly wager: number;
  readonly hand: readonly BlackjackCard[];
  readonly status: BlackjackPlayerStatus;
  readonly outcome: BlackjackOutcome | null;
  readonly payout: number;
}

export interface BlackjackDealer {
  readonly hand: readonly BlackjackCard[];
}

export interface BlackjackState {
  readonly round: number;
  readonly seed: number;
  readonly room: BlackjackRoomConfig;
  readonly deck: readonly BlackjackCard[];
  readonly deckIndex: number;
  readonly players: readonly BlackjackPlayer[];
  readonly dealer: BlackjackDealer;
  readonly activeSeat: number | null;
  readonly phase: "players" | "settled";
  readonly actionId: number;
  readonly lastAction: string | null;
}

export type BlackjackAction =
  | { readonly type: "hit" }
  | { readonly type: "stand" }
  | { readonly type: "double" };

export interface BlackjackHandValue {
  readonly total: number;
  readonly soft: boolean;
  readonly blackjack: boolean;
  readonly busted: boolean;
}

const SUITS: readonly BlackjackSuit[] = ["S", "H", "D", "C"];
const RANKS: readonly BlackjackRank[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

function seededRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export function shuffledBlackjackDeck(seed: number): BlackjackCard[] {
  const deck = SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${rank}${suit}`, suit, rank })),
  );
  const random = seededRandom(seed);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return deck;
}

export function blackjackHandValue(
  hand: readonly BlackjackCard[],
): BlackjackHandValue {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 14) {
      total += 11;
      aces += 1;
    } else {
      total += Math.min(10, card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return {
    total,
    soft: aces > 0,
    blackjack: hand.length === 2 && total === 21,
    busted: total > 21,
  };
}

function normalizedRoom(room: BlackjackRoomConfig): BlackjackRoomConfig {
  const minBet = Math.max(1, Math.round(room.minBet));
  const startingChips = Math.max(minBet, Math.round(room.startingChips));
  return {
    ...room,
    minBet,
    startingChips,
    defaultBet: Math.min(
      startingChips,
      Math.max(minBet, Math.round(room.defaultBet)),
    ),
    rewardMultiplier: Math.max(0, room.rewardMultiplier),
  };
}

function dealInitial(
  players: readonly BlackjackPlayer[],
  deck: readonly BlackjackCard[],
): {
  readonly players: BlackjackPlayer[];
  readonly dealer: BlackjackDealer;
  readonly deckIndex: number;
} {
  const hands = players.map(() => [] as BlackjackCard[]);
  const dealerHand: BlackjackCard[] = [];
  let deckIndex = 0;
  for (let round = 0; round < 2; round += 1) {
    for (const player of players) hands[player.seat].push(deck[deckIndex++]);
    dealerHand.push(deck[deckIndex++]);
  }
  return {
    players: players.map((player) => {
      const value = blackjackHandValue(hands[player.seat]);
      return {
        ...player,
        hand: hands[player.seat],
        status: value.blackjack ? "blackjack" : "playing",
      };
    }),
    dealer: { hand: dealerHand },
    deckIndex,
  };
}

export function createBlackjackRound(
  room: BlackjackRoomConfig = DEFAULT_BLACKJACK_ROOM,
  options: {
    readonly seed?: number;
    readonly names?: readonly string[];
    readonly previousPlayers?: readonly BlackjackPlayer[];
    readonly round?: number;
    readonly heroWager?: number;
  } = {},
): BlackjackState {
  const config = normalizedRoom(room);
  const names = options.names ?? ["你", "森川", "Mika"];
  const seed = options.seed ?? Date.now();
  const deck = shuffledBlackjackDeck(seed);
  const players = names.slice(0, 3).map((name, seat) => {
    const previous = options.previousPlayers?.[seat];
    const replenished =
      !previous || previous.stack < config.minBet
        ? config.startingChips
        : previous.stack;
    const requestedWager =
      seat === 0 && options.heroWager !== undefined
        ? Math.round(options.heroWager)
        : config.defaultBet;
    const wager = Math.min(
      replenished,
      Math.max(config.minBet, requestedWager),
    );
    return {
      seat,
      name,
      stack: replenished - wager,
      wager,
      hand: [] as readonly BlackjackCard[],
      status: "playing" as const,
      outcome: null,
      payout: 0,
    };
  });
  const dealt = dealInitial(players, deck);
  const activeSeat = dealt.players.find(
    (player) => player.status === "playing",
  )?.seat;
  const state: BlackjackState = {
    round: options.round ?? 1,
    seed,
    room: config,
    deck,
    deckIndex: dealt.deckIndex,
    players: dealt.players,
    dealer: dealt.dealer,
    activeSeat: activeSeat ?? null,
    phase: "players",
    actionId: 0,
    lastAction: null,
  };
  return activeSeat === undefined ||
    blackjackHandValue(dealt.dealer.hand).blackjack
    ? settleBlackjackRound(state)
    : state;
}

export function canDouble(state: BlackjackState, seat: number): boolean {
  const player = state.players[seat];
  return (
    state.phase === "players" &&
    state.activeSeat === seat &&
    player?.status === "playing" &&
    player.hand.length === 2 &&
    player.stack >= player.wager
  );
}

export function applyBlackjackAction(
  state: BlackjackState,
  seat: number,
  action: BlackjackAction,
): BlackjackState {
  const player = state.players[seat];
  if (
    state.phase !== "players" ||
    state.activeSeat !== seat ||
    player?.status !== "playing"
  ) {
    return state;
  }
  const players = state.players.map((entry) => ({ ...entry }));
  let deckIndex = state.deckIndex;
  let label = "";
  if (action.type === "hit") {
    const hand = [...player.hand, state.deck[deckIndex++]];
    const value = blackjackHandValue(hand);
    players[seat] = {
      ...player,
      hand,
      status: value.busted
        ? "busted"
        : value.total === 21
          ? "standing"
          : "playing",
    };
    label = value.busted
      ? `${player.name} 爆牌`
      : value.total === 21
        ? `${player.name} 21 点停牌`
        : `${player.name} 要牌`;
  } else if (action.type === "stand") {
    players[seat] = { ...player, status: "standing" };
    label = `${player.name} 停牌`;
  } else {
    if (!canDouble(state, seat)) return state;
    const hand = [...player.hand, state.deck[deckIndex++]];
    const value = blackjackHandValue(hand);
    players[seat] = {
      ...player,
      stack: player.stack - player.wager,
      wager: player.wager * 2,
      hand,
      status: value.busted ? "busted" : "standing",
    };
    label = value.busted
      ? `${player.name} 加倍后爆牌`
      : `${player.name} 加倍停牌`;
  }
  const next: BlackjackState = {
    ...state,
    players,
    deckIndex,
    actionId: state.actionId + 1,
    lastAction: label,
  };
  if (players[seat].status === "playing") return next;
  return advanceBlackjackTurn(next, seat);
}

function advanceBlackjackTurn(
  state: BlackjackState,
  seat: number,
): BlackjackState {
  for (let step = 1; step <= state.players.length; step += 1) {
    const candidate = state.players[(seat + step) % state.players.length];
    if (candidate.status === "playing") {
      return { ...state, activeSeat: candidate.seat };
    }
  }
  return settleBlackjackRound({ ...state, activeSeat: null });
}

export function settleBlackjackRound(state: BlackjackState): BlackjackState {
  let dealerHand = [...state.dealer.hand];
  let deckIndex = state.deckIndex;
  while (blackjackHandValue(dealerHand).total < 17) {
    dealerHand.push(state.deck[deckIndex++]);
  }
  const dealerValue = blackjackHandValue(dealerHand);
  const players = state.players.map((player) => {
    const value = blackjackHandValue(player.hand);
    let outcome: BlackjackOutcome;
    let payout = 0;
    if (value.busted) {
      outcome = "bust";
    } else if (value.blackjack && !dealerValue.blackjack) {
      outcome = "blackjack";
      payout = player.wager * 2.5;
    } else if (dealerValue.blackjack && !value.blackjack) {
      outcome = "lose";
    } else if (dealerValue.busted || value.total > dealerValue.total) {
      outcome = "win";
      payout = player.wager * 2;
    } else if (value.total === dealerValue.total) {
      outcome = "push";
      payout = player.wager;
    } else {
      outcome = "lose";
    }
    return {
      ...player,
      stack: player.stack + payout,
      outcome,
      payout,
    };
  });
  return {
    ...state,
    players,
    dealer: { hand: dealerHand },
    deckIndex,
    activeSeat: null,
    phase: "settled",
    actionId: state.actionId + 1,
    lastAction: dealerValue.busted
      ? "庄家爆牌，结算完成"
      : `庄家 ${dealerValue.total} 点，结算完成`,
  };
}

export function nextBlackjackRound(
  state: BlackjackState,
  heroWager = state.room.defaultBet,
): BlackjackState {
  return createBlackjackRound(state.room, {
    seed: state.seed + state.round * 6151,
    names: state.players.map((player) => player.name),
    previousPlayers: state.players,
    round: state.round + 1,
    heroWager,
  });
}

export function chooseBlackjackTableAction(
  state: BlackjackState,
  seat: number,
  random: () => number = () => 1,
): BlackjackAction {
  const player = state.players[seat];
  const basicAction = chooseBlackjackBasicAction(state, seat);
  const strategy = tableStrategyProfile(
    state.room.startingChips,
    player.stack + player.wager,
  );
  if (random() >= strategy.mistakeRate) return basicAction;

  const value = blackjackHandValue(player.hand);
  if (basicAction.type === "double") return { type: "hit" };
  if (basicAction.type === "stand" && value.total < 21) return { type: "hit" };
  if (basicAction.type === "hit" && value.total >= 12) return { type: "stand" };
  return basicAction;
}

function chooseBlackjackBasicAction(
  state: BlackjackState,
  seat: number,
): BlackjackAction {
  const player = state.players[seat];
  const value = blackjackHandValue(player.hand);
  const dealerUpCard = Math.min(
    11,
    state.dealer.hand[0]?.rank === 14
      ? 11
      : Math.min(10, state.dealer.hand[0]?.rank ?? 10),
  );
  const doubleAllowed = canDouble(state, seat);

  if (value.soft) {
    if (value.total >= 20) return { type: "stand" };
    if (value.total === 19) {
      if (doubleAllowed && dealerUpCard === 6) return { type: "double" };
      return { type: "stand" };
    }
    if (value.total === 18) {
      if (doubleAllowed && dealerUpCard >= 3 && dealerUpCard <= 6) {
        return { type: "double" };
      }
      return dealerUpCard === 2 || dealerUpCard === 7 || dealerUpCard === 8
        ? { type: "stand" }
        : { type: "hit" };
    }
    const doubleRange =
      value.total >= 13 && value.total <= 14
        ? dealerUpCard >= 5 && dealerUpCard <= 6
        : value.total >= 15 && value.total <= 16
          ? dealerUpCard >= 4 && dealerUpCard <= 6
          : value.total === 17
            ? dealerUpCard >= 3 && dealerUpCard <= 6
            : false;
    if (doubleAllowed && doubleRange) return { type: "double" };
    return { type: "hit" };
  }

  if (value.total <= 8) return { type: "hit" };
  if (value.total === 9) {
    return doubleAllowed && dealerUpCard >= 3 && dealerUpCard <= 6
      ? { type: "double" }
      : { type: "hit" };
  }
  if (value.total === 10) {
    return doubleAllowed && dealerUpCard >= 2 && dealerUpCard <= 9
      ? { type: "double" }
      : { type: "hit" };
  }
  if (value.total === 11) {
    return doubleAllowed && dealerUpCard >= 2 && dealerUpCard <= 10
      ? { type: "double" }
      : { type: "hit" };
  }
  if (value.total === 12) {
    return dealerUpCard >= 4 && dealerUpCard <= 6
      ? { type: "stand" }
      : { type: "hit" };
  }
  if (value.total <= 16) {
    return dealerUpCard >= 2 && dealerUpCard <= 6
      ? { type: "stand" }
      : { type: "hit" };
  }
  return { type: "stand" };
}

export function heroPointReward(state: BlackjackState): number {
  const hero = state.players[0];
  const net = Math.max(0, hero.payout - hero.wager);
  return Math.round(net * state.room.rewardMultiplier);
}
