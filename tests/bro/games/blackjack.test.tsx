import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlackjackGame } from "@/bro/games/blackjack/BlackjackGame";
import {
  applyBlackjackAction,
  blackjackHandValue,
  canDouble,
  chooseBlackjackTableAction,
  createBlackjackRound,
  DEFAULT_BLACKJACK_ROOM,
  heroPointReward,
  nextBlackjackRound,
  settleBlackjackRound,
  type BlackjackCard,
  type BlackjackRank,
  type BlackjackState,
  type BlackjackSuit,
} from "@/bro/games/blackjack/logic";

function cards(source: string): BlackjackCard[] {
  const ranks: Record<string, BlackjackRank> = {
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
  return source.split(" ").map((token) => ({
    id: token,
    rank: ranks[token[0]],
    suit: token[1].toUpperCase() as BlackjackSuit,
  }));
}

describe("21 点牌值", () => {
  it("A 可以从 11 自动降为 1", () => {
    expect(blackjackHandValue(cards("As 9d 5c"))).toMatchObject({
      total: 15,
      soft: false,
      busted: false,
    });
  });

  it("两张 21 是 Blackjack，三张 21 只是普通 21", () => {
    expect(blackjackHandValue(cards("As Kd")).blackjack).toBe(true);
    expect(blackjackHandValue(cards("7s 7d 7c")).blackjack).toBe(false);
  });

  it("超过 21 标记爆牌", () => {
    expect(blackjackHandValue(cards("Ks Qd 2c")).busted).toBe(true);
  });
});

describe("三玩家对庄家流程", () => {
  it("初始每人两张牌、扣默认下注且真人先行动", () => {
    const game = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 12 });
    expect(game.players).toHaveLength(3);
    expect(game.players.every((player) => player.hand.length === 2)).toBe(true);
    expect(game.dealer.hand).toHaveLength(2);
    expect(game.players[0].wager).toBe(40);
    expect(game.players[0].stack).toBe(460);
    expect(game.activeSeat).toBe(0);
  });

  it("要牌只给当前席位一张，并在爆牌或21点时自动换人", () => {
    const game = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 23 });
    const next = applyBlackjackAction(game, 0, { type: "hit" });
    expect(next.deckIndex).toBe(game.deckIndex + 1);
    expect(next.players[0].hand).toHaveLength(3);
    const value = blackjackHandValue(next.players[0].hand);
    expect(next.activeSeat).toBe(value.total >= 21 ? 1 : 0);
  });

  it("加倍会补一张、下注翻倍并立即停牌", () => {
    const game = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 31 });
    expect(canDouble(game, 0)).toBe(true);
    const next = applyBlackjackAction(game, 0, { type: "double" });
    expect(next.players[0].wager).toBe(80);
    expect(next.players[0].stack).toBe(420);
    expect(next.players[0].hand).toHaveLength(3);
    expect(["standing", "busted"]).toContain(next.players[0].status);
    expect(next.activeSeat).toBe(
      next.players.find((player) => player.status === "playing")?.seat ?? null,
    );
  });

  it("桌上玩家按庄家明牌执行硬牌基础策略", () => {
    const base = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 43 });
    const state = (
      hand: BlackjackCard[],
      dealer: BlackjackCard[],
    ): BlackjackState => ({
      ...base,
      activeSeat: 1,
      dealer: { hand: dealer },
      players: base.players.map((player, seat) =>
        seat === 1 ? { ...player, hand } : player,
      ),
    });
    expect(
      chooseBlackjackTableAction(state(cards("5s 5d"), cards("6c 9h")), 1).type,
    ).toBe("double");
    expect(
      chooseBlackjackTableAction(state(cards("Ts 6d"), cards("5c 9h")), 1).type,
    ).toBe("stand");
    expect(
      chooseBlackjackTableAction(state(cards("Ts 6d"), cards("Tc 9h")), 1).type,
    ).toBe("hit");
    expect(
      chooseBlackjackTableAction(state(cards("Ts 2d"), cards("4c 9h")), 1).type,
    ).toBe("stand");
  });

  it("桌上玩家能识别软牌并在不可加倍时回退到正确动作", () => {
    const base = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 47 });
    const state = (
      hand: BlackjackCard[],
      dealer: BlackjackCard[],
      stack = base.players[1].stack,
    ): BlackjackState => ({
      ...base,
      activeSeat: 1,
      dealer: { hand: dealer },
      players: base.players.map((player, seat) =>
        seat === 1 ? { ...player, hand, stack } : player,
      ),
    });
    expect(
      chooseBlackjackTableAction(state(cards("As 7d"), cards("6c 9h")), 1).type,
    ).toBe("double");
    expect(
      chooseBlackjackTableAction(state(cards("As 7d"), cards("9c 9h")), 1).type,
    ).toBe("hit");
    expect(
      chooseBlackjackTableAction(state(cards("As 8d"), cards("Tc 9h")), 1).type,
    ).toBe("stand");
    expect(
      chooseBlackjackTableAction(state(cards("5s 6d"), cards("6c 9h"), 0), 1)
        .type,
    ).toBe("hit");
  });

  it("补位席位落后时不执行随机偏差，回到完整基础策略", () => {
    const base = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 49 });
    const game: BlackjackState = {
      ...base,
      activeSeat: 1,
      dealer: { hand: cards("5c 9h") },
      players: base.players.map((player, seat) =>
        seat === 1 ? { ...player, hand: cards("Ts 6d"), stack: 350 } : player,
      ),
    };

    expect(chooseBlackjackTableAction(game, 1, () => 0).type).toBe("stand");
  });

  it("补位席位在中性筹码时按 95% 决策质量保留少量自然偏差", () => {
    const base = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 50 });
    const game: BlackjackState = {
      ...base,
      activeSeat: 1,
      dealer: { hand: cards("5c 9h") },
      players: base.players.map((player, seat) =>
        seat === 1 ? { ...player, hand: cards("Ts 6d") } : player,
      ),
    };

    expect(chooseBlackjackTableAction(game, 1, () => 0).type).toBe("hit");
    expect(chooseBlackjackTableAction(game, 1, () => 0.99).type).toBe("stand");
  });

  it("所有玩家停牌后庄家补到17并完成结算", () => {
    let game = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 51 });
    let guard = 0;
    while (game.phase === "players" && guard++ < 20) {
      const seat = game.activeSeat!;
      game = applyBlackjackAction(game, seat, { type: "stand" });
    }
    const dealer = blackjackHandValue(game.dealer.hand);
    expect(game.phase).toBe("settled");
    expect(dealer.total >= 17 || dealer.busted).toBe(true);
    expect(game.players.every((player) => player.outcome !== null)).toBe(true);
  });

  it("Blackjack 3:2、普通胜 1:1、推和退本金", () => {
    const base = createBlackjackRound(DEFAULT_BLACKJACK_ROOM, { seed: 61 });
    const game: BlackjackState = {
      ...base,
      activeSeat: null,
      players: [
        { ...base.players[0], hand: cards("As Kd"), status: "blackjack" },
        { ...base.players[1], hand: cards("Ts Qd"), status: "standing" },
        { ...base.players[2], hand: cards("9s 9d"), status: "standing" },
      ],
      dealer: { hand: cards("Tc Qc") },
    };
    const settled = settleBlackjackRound(game);
    expect(settled.players.map((player) => player.outcome)).toEqual([
      "blackjack",
      "push",
      "lose",
    ]);
    expect(settled.players.map((player) => player.payout)).toEqual([
      100, 40, 0,
    ]);
  });

  it("房间配置影响筹码、下注、标签和积分倍率，下一局保留房间", () => {
    const room = {
      ...DEFAULT_BLACKJACK_ROOM,
      id: "high-limit",
      label: "HIGH LIMIT",
      tableLabel: "NIGHT TABLE",
      startingChips: 900,
      minBet: 50,
      defaultBet: 75,
      rewardMultiplier: 2,
    };
    const game = createBlackjackRound(room, { seed: 71 });
    expect(game.players[0]).toMatchObject({ stack: 825, wager: 75 });
    const rewarded: BlackjackState = {
      ...game,
      players: game.players.map((player, seat) =>
        seat === 0 ? { ...player, payout: 150, outcome: "win" } : player,
      ),
    };
    expect(heroPointReward(rewarded)).toBe(150);
    const next = nextBlackjackRound(rewarded, 150);
    expect(next.room.label).toBe("HIGH LIMIT");
    expect(next.players[0].wager).toBe(150);
    expect(next.players[1].wager).toBe(75);
  });
});

describe("BlackjackGame 房间界面", () => {
  it("自定义房间标签与三项操作都在牌桌内部", () => {
    vi.useFakeTimers();
    render(
      <BlackjackGame
        accountPoints={1280}
        seed={81}
        matchmakingDelayMs={0}
        room={{
          ...DEFAULT_BLACKJACK_ROOM,
          label: "TEST CLUB",
          tableLabel: "TABLE QA",
        }}
      />,
    );
    act(() => vi.runOnlyPendingTimers());
    const table = screen.getByRole("region", { name: "21点牌桌" });
    expect(table).toHaveTextContent("TEST CLUB");
    expect(table).toHaveTextContent("TABLE QA");
    expect(table).toContainElement(
      screen.getByRole("button", { name: /要牌/ }),
    );
    expect(table).toContainElement(
      screen.getByRole("button", { name: /停牌/ }),
    );
    expect(table).toContainElement(
      screen.getByRole("button", { name: /加倍/ }),
    );
    const scoreboard = screen.getByRole("complementary", {
      name: "我的牌桌状态",
    });
    expect(scoreboard).toHaveTextContent("账户积分1280");
    expect(scoreboard).toHaveTextContent("桌内筹码460");
    expect(scoreboard).toHaveTextContent("当前下注");
    expect(scoreboard).toHaveTextContent("回合盈亏");
    expect(scoreboard).toHaveTextContent("操作状态");
    expect(table).toHaveTextContent("玩家手牌全桌明牌");
    expect(table).toHaveTextContent("仅庄家第二张为暗牌");
    expect(table).toHaveTextContent("天然 21 点赔 3:2");
    expect(screen.getByLabelText("选择下一局下注")).toHaveTextContent(
      /下一局下注\s*40/,
    );
    expect(screen.getByRole("button", { name: "40 筹码" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "100 筹码" }));
    expect(screen.getByRole("button", { name: "100 筹码" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("选择下一局下注")).toHaveTextContent(
      /下一局下注\s*100/,
    );
    expect(table).not.toHaveTextContent(/AI FILL|THINKING|YOUR TURN/);
    expect(screen.getByLabelText("森川 公开手牌")).toBeVisible();
    expect(screen.getByLabelText("Mika 公开手牌")).toBeVisible();
    expect(screen.getAllByAltText("庄家暗牌")).toHaveLength(1);
    expect(
      screen.getByRole("timer", { name: /你的决策剩余 15 秒/ }),
    ).toBeVisible();
    vi.useRealTimers();
  });
});
