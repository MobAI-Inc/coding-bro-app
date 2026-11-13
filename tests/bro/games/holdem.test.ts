import { describe, expect, it } from "vitest";
import {
  applyHoldemAction,
  chooseHoldemTableAction,
  compareHandValues,
  createHoldemGame,
  estimateHoldemEquity,
  evaluateHoldemHand,
  legalActions,
  preflopStrength,
  type HoldemState,
  type PokerCard,
  type Rank,
  type Suit,
} from "@/bro/games/holdem/logic";

function cards(source: string): PokerCard[] {
  const ranks: Record<string, Rank> = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
  };
  return source.split(" ").map((token) => {
    const rank = ranks[token[0]];
    const suit = token[1].toUpperCase() as Suit;
    return { id: token, rank, suit };
  });
}

function act(
  state: HoldemState,
  seat: number,
  action: Parameters<typeof applyHoldemAction>[2],
): HoldemState {
  const next = applyHoldemAction(state, seat, action);
  expect(next, `seat ${seat} ${action.type} should be accepted`).not.toBe(
    state,
  );
  return next;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function decisionState(options: {
  readonly seat: number;
  readonly hole: string;
  readonly community?: string;
  readonly currentBet: number;
  readonly committedRound: number;
  readonly pot: number;
  readonly minRaise?: number;
  readonly stack?: number;
}): HoldemState {
  const game = createHoldemGame({ seed: 91, dealerSeat: 0 });
  return {
    ...game,
    activeSeat: options.seat,
    stage:
      (options.community?.split(" ").filter(Boolean).length ?? 0) >= 5
        ? "river"
        : options.community
          ? "turn"
          : "preflop",
    community: options.community ? cards(options.community) : [],
    currentBet: options.currentBet,
    minRaise: options.minRaise ?? 20,
    pot: options.pot,
    players: game.players.map((player) =>
      player.seat === options.seat
        ? {
            ...player,
            hole: cards(options.hole),
            committedRound: options.committedRound,
            stack: options.stack ?? player.stack,
          }
        : player,
    ),
  };
}

describe("Texas Hold'em 手牌评估", () => {
  it("七张牌里选出最好的五张同花顺", () => {
    const value = evaluateHoldemHand(cards("As Ks Qs Js Ts 2d 2c"));
    expect(value.label).toBe("同花顺");
    expect(value.score).toEqual([14]);
  });

  it("A2345 是五高顺子，不会被误判成 A 高顺", () => {
    const value = evaluateHoldemHand(cards("As 2d 3c 4h 5s Kd Qc"));
    expect(value.label).toBe("顺子");
    expect(value.score).toEqual([5]);
  });

  it("葫芦胜过同花", () => {
    const fullHouse = evaluateHoldemHand(cards("Ah Ad Ac Ks Kd 2s 3s"));
    const flush = evaluateHoldemHand(cards("As Js 9s 6s 3s Kd Qc"));
    expect(compareHandValues(fullHouse, flush)).toBeGreaterThan(0);
  });

  it("同一对时逐张比较踢脚", () => {
    const aceKicker = evaluateHoldemHand(cards("Kh Kd As 9c 5d 3s 2h"));
    const queenKicker = evaluateHoldemHand(cards("Kc Ks Qh 9d 5c 3h 2d"));
    expect(compareHandValues(aceKicker, queenKicker)).toBeGreaterThan(0);
  });
});

describe("三人单桌核心流程", () => {
  it("发两张底牌、下小盲大盲，并从大盲左侧开始", () => {
    const game = createHoldemGame({ seed: 7, dealerSeat: 0 });
    expect(game.players.map((player) => player.hole)).toHaveLength(3);
    expect(game.players.every((player) => player.hole.length === 2)).toBe(true);
    expect(game.smallBlindSeat).toBe(1);
    expect(game.bigBlindSeat).toBe(2);
    expect(game.players[1].committedRound).toBe(10);
    expect(game.players[2].committedRound).toBe(20);
    expect(game.pot).toBe(30);
    expect(game.activeSeat).toBe(0);
  });

  it("完整走过 preflop / flop / turn / river 后自动摊牌结算", () => {
    let game = createHoldemGame({ seed: 17, dealerSeat: 0 });
    game = act(game, 0, { type: "call" });
    game = act(game, 1, { type: "call" });
    game = act(game, 2, { type: "check" });
    expect(game.stage).toBe("flop");
    expect(game.community).toHaveLength(3);
    expect(game.activeSeat).toBe(1);

    for (const expected of ["turn", "river", "complete"] as const) {
      game = act(game, 1, { type: "check" });
      game = act(game, 2, { type: "check" });
      game = act(game, 0, { type: "check" });
      expect(game.stage).toBe(expected);
    }
    expect(game.community).toHaveLength(5);
    expect(game.result?.reason).toBe("showdown");
    expect(game.result?.winnerSeats.length).toBeGreaterThan(0);
    expect(game.players.reduce((sum, player) => sum + player.stack, 0)).toBe(
      1500,
    );
  });

  it("加注会重置其他玩家的行动义务，并按新注额推进", () => {
    let game = createHoldemGame({ seed: 23, dealerSeat: 0 });
    expect(legalActions(game, 0).minRaiseTo).toBe(40);
    game = act(game, 0, { type: "raise", to: 60 });
    expect(game.currentBet).toBe(60);
    expect(game.minRaise).toBe(40);
    expect(game.activeSeat).toBe(1);
    game = act(game, 1, { type: "call" });
    game = act(game, 2, { type: "call" });
    expect(game.stage).toBe("flop");
    expect(game.pot).toBe(180);
    expect(game.currentBet).toBe(0);
  });

  it("只剩一人未弃牌时立即赢得底池", () => {
    let game = createHoldemGame({ seed: 31, dealerSeat: 0 });
    game = act(game, 0, { type: "fold" });
    game = act(game, 1, { type: "fold" });
    expect(game.stage).toBe("complete");
    expect(game.result).toMatchObject({
      winnerSeats: [2],
      pot: 30,
      reason: "fold",
    });
    expect(game.players[2].stack).toBe(510);
  });

  it("不合法的过牌和不足额加注不会改变局面", () => {
    const game = createHoldemGame({ seed: 37, dealerSeat: 0 });
    expect(applyHoldemAction(game, 0, { type: "check" })).toBe(game);
    expect(applyHoldemAction(game, 0, { type: "raise", to: 30 })).toBe(game);
  });
});

describe("牌桌对手策略", () => {
  it("能区分顶级对子、同花大牌和弱非同花牌", () => {
    expect(preflopStrength(cards("As Ah"))).toBeGreaterThan(
      preflopStrength(cards("As Ks")),
    );
    expect(preflopStrength(cards("As Ks"))).toBeGreaterThan(
      preflopStrength(cards("7c 2d")),
    );
  });

  it("面对高压下注会放弃弱起手牌", () => {
    const game = decisionState({
      seat: 1,
      hole: "7c 2d",
      currentBet: 200,
      committedRound: 10,
      pot: 240,
      minRaise: 180,
    });
    expect(chooseHoldemTableAction(game, 1, seededRandom(2))).toEqual({
      type: "fold",
    });
  });

  it("拿到顶级起手牌时会做价值加注", () => {
    const game = decisionState({
      seat: 1,
      hole: "As Ah",
      currentBet: 20,
      committedRound: 10,
      pot: 30,
    });
    const action = chooseHoldemTableAction(game, 1, seededRandom(7));
    expect(action.type).toBe("raise");
    if (action.type === "raise") {
      expect(action.to).toBeGreaterThanOrEqual(
        legalActions(game, 1).minRaiseTo!,
      );
    }
  });

  it("翻后用未知牌模拟胜率，坚果牌会主动扩大底池", () => {
    const game = decisionState({
      seat: 1,
      hole: "Jh Th",
      community: "Ah Kh Qh 2c 3d",
      currentBet: 60,
      committedRound: 20,
      pot: 180,
      minRaise: 40,
    });
    expect(estimateHoldemEquity(game, 1, seededRandom(11), 32)).toBe(1);
    expect(chooseHoldemTableAction(game, 1, seededRandom(11)).type).toBe(
      "raise",
    );
  });

  it("补位席位落后时收紧边缘决策，领先时才增加施压频率", () => {
    const behind = decisionState({
      seat: 1,
      hole: "As 7s",
      currentBet: 20,
      committedRound: 10,
      pot: 80,
      stack: 330,
    });
    const ahead = decisionState({
      seat: 1,
      hole: "As 7s",
      currentBet: 20,
      committedRound: 10,
      pot: 80,
      stack: 660,
    });

    const behindAction = chooseHoldemTableAction(behind, 1, () => 0.5);
    const aheadAction = chooseHoldemTableAction(ahead, 1, () => 0.5);
    expect(behindAction.type).not.toBe("raise");
    expect(aheadAction.type).toBe("raise");
  });
});
