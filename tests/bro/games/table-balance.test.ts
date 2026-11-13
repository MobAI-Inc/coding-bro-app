import { describe, expect, it } from "vitest";
import {
  TABLE_BASE_QUALITY,
  TABLE_NEUTRAL_FLOOR,
  tableStrategyProfile,
} from "@/bro/games/core/table-balance";

describe("托管席位策略校准", () => {
  it("0.95 是基准决策质量，不是玩家积分折算", () => {
    const profile = tableStrategyProfile(500, 500);
    expect(TABLE_BASE_QUALITY).toBe(0.95);
    expect(profile.quality).toBe(0.95);
    expect(profile.mistakeRate).toBeCloseTo(0.05);
    expect(profile.recoveryBias).toBe(0);
    expect(profile.releaseBias).toBe(0);
  });

  it("席位低于 95% 初始筹码时收紧策略", () => {
    const profile = tableStrategyProfile(500, 400);
    expect(TABLE_NEUTRAL_FLOOR).toBe(0.95);
    expect(profile.bankrollRatio).toBe(0.8);
    expect(profile.quality).toBeGreaterThan(TABLE_BASE_QUALITY);
    expect(profile.mistakeRate).toBeLessThan(0.05);
    expect(profile.recoveryBias).toBeGreaterThan(0);
    expect(profile.releaseBias).toBe(0);
  });

  it("席位领先过多时适当放松，避免持续抽走牌桌筹码", () => {
    const profile = tableStrategyProfile(500, 650);
    expect(profile.bankrollRatio).toBe(1.3);
    expect(profile.quality).toBeLessThan(TABLE_BASE_QUALITY);
    expect(profile.mistakeRate).toBeGreaterThan(0.05);
    expect(profile.releaseBias).toBeGreaterThan(0);
    expect(profile.recoveryBias).toBe(0);
  });
});
