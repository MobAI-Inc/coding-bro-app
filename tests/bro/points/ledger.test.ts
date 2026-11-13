import { describe, expect, it } from "vitest";
import {
  awardResult,
  balanceOf,
  chargeEntry,
  signedAmount,
} from "@/bro/points/types";
import type { LedgerEntry } from "@/bro/points/types";

const entry = (kind: LedgerEntry["kind"], amount: number): LedgerEntry => ({
  id: `${kind}-${amount}`,
  kind,
  amount,
  at: 0,
  memo: "test",
});

describe("积分账本", () => {
  it("游戏和用量产出为正，入场与 Reset 兑换为负", () => {
    expect(signedAmount(entry("earn_usage", 100))).toBe(100);
    expect(signedAmount(entry("award_result", 100))).toBe(100);
    expect(signedAmount(entry("redeem_reset", 100))).toBe(-100);
  });

  it("余额从流水计算", () => {
    expect(
      balanceOf([entry("earn_usage", 1000), entry("redeem_reset", 650)]),
    ).toBe(350);
  });

  it("入场扣费保留原有行为", () => {
    const result = chargeEntry([entry("earn_usage", 100)], {
      id: "play",
      price: 80,
      at: 1,
      memo: "德州扑克入场",
    });
    expect(balanceOf(result!)).toBe(20);
  });

  it("同一结算标识最多发放一次游戏奖励", () => {
    const initial = [entry("earn_usage", 100)];
    const once = awardResult(initial, {
      id: "gold-miner:level:12",
      points: 30,
      at: 1,
      memo: "黄金矿工 · 第 12 关",
    });
    const repeated = awardResult(once, {
      id: "gold-miner:level:12",
      points: 30,
      at: 2,
      memo: "黄金矿工 · 第 12 关",
    });

    expect(balanceOf(repeated)).toBe(130);
    expect(
      repeated.filter(({ id }) => id === "gold-miner:level:12"),
    ).toHaveLength(1);
  });

  it("拒绝零分、负分和非整数奖励", () => {
    const initial = [entry("earn_usage", 100)];
    for (const points of [0, -1, 1.5, Number.NaN]) {
      expect(
        awardResult(initial, {
          id: `bad-${points}`,
          points,
          at: 1,
          memo: "bad",
        }),
      ).toBe(initial);
    }
  });
});
