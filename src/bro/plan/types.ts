/** Subscription contract values are integer cents in the client. */
export type PlanId = "lite" | "pro" | "ultra";

export const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  lite: 1_000,
  pro: 2_000,
  ultra: 4_000,
};

export const PLAN_CYCLE_BONUS_PERCENT = 40;
export const PLAN_ORDER: readonly PlanId[] = ["lite", "pro", "ultra"];

/** All three quota windows are live at the same time, shortest first. */
export type QuotaWindow = "session" | "week" | "month";
export const QUOTA_WINDOWS: readonly QuotaWindow[] = [
  "session",
  "week",
  "month",
];

/**
 * `session` is the rolling five-hour allowance, `week` the current natural
 * week and `month` the billing-cycle ceiling.
 */
export interface PlanQuota {
  readonly session: number;
  readonly week: number;
  readonly month: number;
}

export type Usage = PlanQuota;

export interface PlanTier {
  readonly id: PlanId;
  readonly name: string;
  readonly priceCents: number;
  readonly cycleBonusPercent: number;
  readonly fiveHourBaseCents: number;
  readonly weeklyBaseCents: number;
  readonly monthlyBaseCents: number;
  readonly cycleBonusCents: number;
  readonly giftedPointsPerCycle: number;
  readonly cycleHardCapCents: number;
  readonly quota: PlanQuota;
  readonly blurb: string;
  readonly longContext: "no" | "limited" | "yes";
  readonly concurrency: number;
  /** Server catalog metadata; absent only in legacy responses and fixtures. */
  readonly publicModelId?: string;
  readonly maxResponseOutputTokens?: number;
  readonly catalogVersion?: string;
  readonly profileVersion?: string;
  readonly planVersion?: string;
}

export type OverageAction = "normal" | "downgrade" | "paused";

export interface QuotaStatus {
  readonly window: QuotaWindow;
  readonly usedCents: number;
  readonly capCents: number;
  readonly remainingCents: number;
  readonly percent: number;
  readonly exhausted: boolean;
}

export function isExhausted(
  quota: PlanQuota,
  usage: Usage,
  window: QuotaWindow,
): boolean {
  return quota[window] <= 0 || usage[window] >= quota[window];
}

export function windowStatus(
  quota: PlanQuota,
  usage: Usage,
  window: QuotaWindow,
): QuotaStatus {
  const capCents = quota[window];
  const usedCents = usage[window];
  const percent =
    capCents <= 0
      ? 100
      : Math.min(100, Math.floor((usedCents * 100) / capCents));
  return {
    window,
    usedCents,
    capCents,
    remainingCents: Math.max(0, capCents - usedCents),
    percent,
    exhausted: isExhausted(quota, usage, window),
  };
}

export function allStatuses(quota: PlanQuota, usage: Usage): QuotaStatus[] {
  return QUOTA_WINDOWS.map((window) => windowStatus(quota, usage, window));
}

export function tightest(quota: PlanQuota, usage: Usage): QuotaStatus {
  return tightestOf(allStatuses(quota, usage));
}

/** Equal utilization chooses the billing-cycle window because it hard-stops. */
export function tightestOf(statuses: readonly QuotaStatus[]): QuotaStatus {
  if (statuses.length === 0) {
    throw new Error("tightestOf：没有窗口可比，调用方应先判断是否已订阅");
  }
  let best = statuses[0];
  for (const status of statuses.slice(1)) {
    if (!looserThan(status, best)) best = status;
  }
  return best;
}

function looserThan(a: QuotaStatus, b: QuotaStatus): boolean {
  if (a.capCents <= 0) return false;
  if (b.capCents <= 0) return true;
  return a.usedCents * b.capCents < b.usedCents * a.capCents;
}

export const WINDOW_ACTION: Record<
  QuotaWindow,
  Exclude<OverageAction, "normal">
> = {
  session: "downgrade",
  week: "downgrade",
  month: "paused",
};

export function currentAction(quota: PlanQuota, usage: Usage): OverageAction {
  for (let index = QUOTA_WINDOWS.length - 1; index >= 0; index -= 1) {
    const window = QUOTA_WINDOWS[index];
    if (isExhausted(quota, usage, window)) return WINDOW_ACTION[window];
  }
  return "normal";
}

export function nextTier(id: PlanId): PlanId | null {
  const index = PLAN_ORDER.indexOf(id);
  return index >= 0 && index < PLAN_ORDER.length - 1
    ? PLAN_ORDER[index + 1]
    : null;
}
