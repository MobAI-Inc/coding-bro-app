import { describe, expect, it } from "vitest";
import {
  PLAYER_DECISION_MS,
  TABLE_DECISION_MAX_MS,
  TABLE_DECISION_MIN_MS,
  decisionSecondsRemaining,
  tableDecisionDelay,
} from "@/bro/games/core/decision-timing";

describe("牌桌决策倒计时", () => {
  it("玩家固定获得 15 秒决策时间", () => {
    expect(PLAYER_DECISION_MS).toBe(15_000);
    expect(
      decisionSecondsRemaining(
        {
          key: "turn-1",
          seat: 0,
          startedAt: 1_000,
          durationMs: PLAYER_DECISION_MS,
        },
        1_000,
      ),
    ).toBe(15);
  });

  it("桌上其他座位在 3.2 到 6.2 秒内完成决策", () => {
    expect(tableDecisionDelay(() => 0)).toBe(TABLE_DECISION_MIN_MS);
    expect(tableDecisionDelay(() => 1)).toBe(TABLE_DECISION_MAX_MS);
    expect(tableDecisionDelay(() => 0.5)).toBe(4_700);
  });

  it("倒计时不会出现负数", () => {
    expect(
      decisionSecondsRemaining(
        {
          key: "turn-2",
          seat: 2,
          startedAt: 0,
          durationMs: 3_200,
        },
        5_000,
      ),
    ).toBe(0);
  });
});
