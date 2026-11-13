import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { match3Level } from "@/bro/games/match3/Match3Game";
import { goldMinerLevel } from "@/bro/games/gold-miner/GoldMinerGame";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("无限闯关单机难度", () => {
  it("消消乐与黄金矿工逐关变难，并在高关卡封顶", () => {
    expect(match3Level(2).targetScore).toBeGreaterThan(
      match3Level(1).targetScore,
    );
    expect(match3Level(999).difficulty).toBe(match3Level(10).difficulty);
    expect(goldMinerLevel(2).target).toBeGreaterThan(goldMinerLevel(1).target);
    expect(goldMinerLevel(999).difficulty).toBe(goldMinerLevel(100).difficulty);
  });

  it("难度封顶后仍继续产生有奖励的新关卡", () => {
    expect(match3Level(999).levelNumber).toBe(999);
    expect(goldMinerLevel(999).levelNumber).toBe(999);
    expect(goldMinerLevel(999).rewardPoints).toBeGreaterThan(0);
  });
});
