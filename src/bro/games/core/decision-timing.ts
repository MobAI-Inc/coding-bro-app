export const PLAYER_DECISION_MS = 15_000;
export const TABLE_DECISION_MIN_MS = 3_200;
export const TABLE_DECISION_MAX_MS = 6_200;

export interface DecisionWindow {
  readonly key: string;
  readonly seat: number;
  readonly startedAt: number;
  readonly durationMs: number;
}

export function tableDecisionDelay(random: () => number = Math.random): number {
  const sample = Math.max(0, Math.min(1, random()));
  return Math.round(
    TABLE_DECISION_MIN_MS +
      (TABLE_DECISION_MAX_MS - TABLE_DECISION_MIN_MS) * sample,
  );
}

export function decisionSecondsRemaining(
  window: DecisionWindow,
  now = Date.now(),
): number {
  return Math.max(
    0,
    Math.ceil((window.startedAt + window.durationMs - now) / 1_000),
  );
}
