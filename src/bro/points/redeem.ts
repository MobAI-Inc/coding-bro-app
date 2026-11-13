/** Client mirror of the server-owned Reset catalog. */
import { balanceOf } from "./types";
import type { LedgerEntry } from "./types";
import type { PlanId } from "../plan/types";

export type { PlanId } from "../plan/types";
export type ResetSku = "reset_5h" | "reset_week" | "reset_month";
export type ResetSource = "system" | "points";

export interface ResetProduct {
  readonly sku: ResetSku;
  readonly title: string;
  readonly shortTitle: string;
  readonly description: string;
}

/**
 * Price and availability returned by the subscription service. Product copy
 * stays in the client; price, counters and final eligibility belong to the
 * server.
 */
export interface ResetOffer {
  readonly sku: ResetSku;
  readonly pricePoints: number;
  readonly redeemedCount: number;
  readonly maxRedemptions: number | null;
  readonly redeemable: boolean;
  readonly unavailableReason?: string;
}

export interface ResetGrant {
  readonly id: string;
  readonly sku: ResetSku;
  readonly source: ResetSource;
  readonly grantedAt: number;
}

export const RESET_PRODUCTS: readonly ResetProduct[] = [
  {
    sku: "reset_5h",
    title: "5 小时 Reset",
    shortTitle: "5H",
    description: "立即重置当前 5 小时用量窗口",
  },
  {
    sku: "reset_week",
    title: "周 Reset",
    shortTitle: "WEEK",
    description: "重置本周限额，并同步刷新 5 小时窗口",
  },
  {
    sku: "reset_month",
    title: "月 Reset",
    shortTitle: "MONTH",
    description: "重置本账期、周与 5 小时全部用量窗口",
  },
] as const;

export const RESET_PRICES: Readonly<Record<PlanId, Record<ResetSku, number>>> =
  {
    lite: { reset_5h: 1_200, reset_week: 4_200, reset_month: 9_800 },
    pro: { reset_5h: 2_400, reset_week: 8_400, reset_month: 19_600 },
    ultra: { reset_5h: 4_800, reset_week: 16_800, reset_month: 39_200 },
  };

export function resetPrice(plan: PlanId, sku: ResetSku): number {
  return RESET_PRICES[plan][sku];
}

export function resetOffersForPlan(plan: PlanId): ResetOffer[] {
  return RESET_PRODUCTS.map((product) => ({
    sku: product.sku,
    pricePoints: resetPrice(plan, product.sku),
    redeemedCount: 0,
    maxRedemptions: null,
    redeemable: true,
  }));
}

export function canRedeemReset(
  ledger: readonly LedgerEntry[],
  plan: PlanId,
  sku: ResetSku,
  offer?: ResetOffer,
): boolean {
  const price = offer?.pricePoints ?? resetPrice(plan, sku);
  const belowLimit =
    offer?.maxRedemptions == null || offer.redeemedCount < offer.maxRedemptions;
  return (
    (offer?.redeemable ?? true) && belowLimit && balanceOf(ledger) >= price
  );
}

export function createResetGrant(input: {
  id: string;
  sku: ResetSku;
  source: ResetSource;
  grantedAt: number;
}): ResetGrant {
  return { ...input };
}

export function redeemReset(
  ledger: readonly LedgerEntry[],
  plan: PlanId,
  redeem: { id: string; sku: ResetSku; at: number },
  offer?: ResetOffer,
): { ledger: LedgerEntry[]; grant: ResetGrant } | null {
  const price = offer?.pricePoints ?? resetPrice(plan, redeem.sku);
  if (
    !Number.isInteger(price) ||
    price <= 0 ||
    !canRedeemReset(ledger, plan, redeem.sku, offer) ||
    ledger.some((entry) => entry.id === redeem.id)
  ) {
    return null;
  }
  const product = RESET_PRODUCTS.find((item) => item.sku === redeem.sku);
  if (!product) return null;
  return {
    ledger: [
      ...ledger,
      {
        id: redeem.id,
        kind: "redeem_reset",
        amount: price,
        at: redeem.at,
        memo: `兑换 ${product.title} · ${plan.toUpperCase()}`,
      },
    ],
    grant: createResetGrant({
      id: `grant-${redeem.id}`,
      sku: redeem.sku,
      source: "points",
      grantedAt: redeem.at,
    }),
  };
}
