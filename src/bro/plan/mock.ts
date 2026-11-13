/**
 * Test/no-Provider fixture. Production is always backed by BackendProvider and
 * must use the server plan catalog plus the active subscription snapshot.
 */
import type { PlanId, PlanTier, Usage } from "./types";
import { PLAN_CYCLE_BONUS_PERCENT, PLAN_PRICE_CENTS } from "./types";
import { resetPrice } from "../points/redeem";

function tier(input: {
  id: PlanId;
  name: string;
  blurb: string;
  longContext: PlanTier["longContext"];
  concurrency: number;
}): PlanTier {
  const monthlyBaseCents = PLAN_PRICE_CENTS[input.id];
  const weeklyBaseCents = monthlyBaseCents / 4;
  const fiveHourBaseCents = weeklyBaseCents / 2;
  const cycleBonusCents = (monthlyBaseCents * PLAN_CYCLE_BONUS_PERCENT) / 100;
  return {
    ...input,
    priceCents: monthlyBaseCents,
    cycleBonusPercent: PLAN_CYCLE_BONUS_PERCENT,
    fiveHourBaseCents,
    weeklyBaseCents,
    monthlyBaseCents,
    cycleBonusCents,
    giftedPointsPerCycle: resetPrice(input.id, "reset_month"),
    cycleHardCapCents: monthlyBaseCents * 2 + cycleBonusCents,
    // No Reset has been redeemed in the catalog mock. Bonus is distributed
    // equally across four natural weeks by the backend contract.
    quota: {
      session: fiveHourBaseCents,
      week: weeklyBaseCents + cycleBonusCents / 4,
      month: monthlyBaseCents * 2 + cycleBonusCents,
    },
  };
}

const MOCK_TIERS: readonly PlanTier[] = [
  tier({
    id: "lite",
    name: "Lite",
    blurb: "中端模型池",
    longContext: "no",
    concurrency: 2,
  }),
  tier({
    id: "pro",
    name: "Pro",
    blurb: "高端模型池",
    longContext: "limited",
    concurrency: 5,
  }),
  tier({
    id: "ultra",
    name: "Ultra",
    blurb: "全池，含顶级与长上下文",
    longContext: "yes",
    concurrency: 10,
  }),
];

const MOCK_CURRENT: PlanId | null = "pro";
const MOCK_USAGE: Usage = { session: 180, week: 420, month: 1_160 };

export function usePlan() {
  return { tiers: MOCK_TIERS, current: MOCK_CURRENT, usage: MOCK_USAGE };
}

export { MOCK_TIERS, MOCK_CURRENT, MOCK_USAGE };
