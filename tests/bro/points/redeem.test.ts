import { describe, expect, it } from "vitest";

import {
  RESET_PRICES,
  createResetGrant,
  redeemReset,
  resetPrice,
} from "@/bro/points/redeem";
import type { ResetOffer } from "@/bro/points/redeem";
import type { LedgerEntry } from "@/bro/points/types";

const ledger = (amount: number): LedgerEntry[] => [
  { id: "seed", kind: "cycle_gift", amount, at: 0, memo: "账期赠送" },
];

describe("three-window Reset catalog", () => {
  it("uses the approved Plan price matrix", () => {
    expect(RESET_PRICES).toEqual({
      lite: { reset_5h: 1_200, reset_week: 4_200, reset_month: 9_800 },
      pro: { reset_5h: 2_400, reset_week: 8_400, reset_month: 19_600 },
      ultra: { reset_5h: 4_800, reset_week: 16_800, reset_month: 39_200 },
    });
  });

  it.each(["lite", "pro", "ultra"] as const)(
    "%s keeps 5h < week < month",
    (plan) => {
      expect(resetPrice(plan, "reset_5h")).toBeLessThan(
        resetPrice(plan, "reset_week"),
      );
      expect(resetPrice(plan, "reset_week")).toBeLessThan(
        resetPrice(plan, "reset_month"),
      );
    },
  );

  it.each(["reset_5h", "reset_week", "reset_month"] as const)(
    "%s costs more on more expensive Plans",
    (sku) => {
      expect(resetPrice("lite", sku)).toBeLessThan(resetPrice("pro", sku));
      expect(resetPrice("pro", sku)).toBeLessThan(resetPrice("ultra", sku));
    },
  );
});

describe("Reset redemption", () => {
  it("deducts the selected SKU price and appends its product name", () => {
    const result = redeemReset(ledger(19_600), "pro", {
      id: "r1",
      sku: "reset_week",
      at: 10,
    });
    expect(result?.ledger.at(-1)).toMatchObject({
      kind: "redeem_reset",
      amount: 8_400,
      memo: "兑换 周 Reset · PRO",
    });
    expect(result?.grant).toMatchObject({
      sku: "reset_week",
      source: "points",
    });
  });

  it("rejects insufficient points, duplicate ids and server limits", () => {
    expect(
      redeemReset(ledger(2_399), "pro", {
        id: "r1",
        sku: "reset_5h",
        at: 10,
      }),
    ).toBeNull();
    expect(
      redeemReset(ledger(19_600), "pro", {
        id: "seed",
        sku: "reset_week",
        at: 10,
      }),
    ).toBeNull();
    const exhaustedOffer: ResetOffer = {
      sku: "reset_week",
      pricePoints: 8_400,
      redeemedCount: 4,
      maxRedemptions: 4,
      redeemable: false,
    };
    expect(
      redeemReset(
        ledger(100_000),
        "pro",
        { id: "r5", sku: "reset_week", at: 10 },
        exhaustedOffer,
      ),
    ).toBeNull();
  });

  it("keeps system and point grants structurally identical except source", () => {
    const base = { id: "g", sku: "reset_month" as const, grantedAt: 10 };
    const system = createResetGrant({ ...base, source: "system" });
    const points = createResetGrant({ ...base, source: "points" });
    expect({ ...system, source: undefined }).toEqual({
      ...points,
      source: undefined,
    });
  });
});
