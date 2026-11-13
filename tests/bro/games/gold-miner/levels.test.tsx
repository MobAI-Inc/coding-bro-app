import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createGoldMinerRun,
  GOLD_MINER_GEOMETRY,
  GOLD_MINER_MAX_DIFFICULTY,
  GOLD_MINER_MAX_ROPE_LENGTH,
  GOLD_MINER_MAX_SWING_RAD,
  GoldMinerGame,
  goldMinerAimTo,
  goldMinerDifficultyProfile,
  goldMinerLayout,
  goldMinerLevel,
  goldMinerRetractSpeed,
  settleGoldMinerOre,
} from "@/bro/games/gold-miner/GoldMinerGame";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("黄金矿工关卡", () => {
  it("先显示关卡简报，确认后才生成游戏矿区", () => {
    render(<GoldMinerGame />);
    expect(screen.queryByRole("application")).toBeNull();
    expect(screen.getByText(/60 秒内回收至少 135 分/)).toBeInTheDocument();
    expect(screen.getAllByText("1/100")).toHaveLength(2);
    expect(screen.getByText("SCORE")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "本关目标进度" }),
    ).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByRole("button", { name: "开始第 1 关" }));
    expect(
      screen.getByRole("application", { name: "黄金矿工第 1 关游戏画面" }),
    ).toBeInTheDocument();
  });

  it("下一关使用不同矿物布局，并随难度平滑增加更多障碍", () => {
    expect(goldMinerLayout(2)).not.toEqual(goldMinerLayout(1));
    expect(goldMinerDifficultyProfile(100).rockChance).toBeGreaterThan(
      goldMinerDifficultyProfile(1).rockChance,
    );
    expect(goldMinerDifficultyProfile(100).oreCount).toBeGreaterThan(
      goldMinerDifficultyProfile(1).oreCount,
    );
    expect(goldMinerLevel(100).target).toBeGreaterThan(
      goldMinerLevel(1).target,
    );
    expect(goldMinerLevel(100).seconds).toBeLessThan(goldMinerLevel(1).seconds);
  });

  it("1/25/50/75/100 级逐段推进，101 级起保持封顶参数", () => {
    const checkpoints = [
      { level: 1, target: 135, seconds: 60, oreCount: 7 },
      { level: 25, target: 171, seconds: 56, oreCount: 8 },
      { level: 50, target: 227, seconds: 52, oreCount: 10 },
      { level: 75, target: 304, seconds: 48, oreCount: 11 },
      { level: 100, target: 400, seconds: 44, oreCount: 13 },
    ] as const;

    for (const expected of checkpoints) {
      const level = goldMinerLevel(expected.level);
      const profile = goldMinerDifficultyProfile(expected.level);
      expect(level.difficulty).toBe(expected.level);
      expect(level.target).toBe(expected.target);
      expect(level.seconds).toBe(expected.seconds);
      expect(profile.oreCount).toBe(expected.oreCount);
    }

    const cap = goldMinerLevel(100);
    const afterCap = goldMinerLevel(101);
    expect(afterCap).toMatchObject({
      difficulty: GOLD_MINER_MAX_DIFFICULTY,
      target: cap.target,
      seconds: cap.seconds,
      rewardPoints: cap.rewardPoints,
    });
    expect(goldMinerDifficultyProfile(101)).toEqual(
      goldMinerDifficultyProfile(100),
    );
    expect(goldMinerLayout(101)).not.toEqual(goldMinerLayout(100));
  });

  it("前期不陡增：每 25 级时间稳定递减，目标和石块压力后置", () => {
    const levels = [1, 25, 50, 75, 100].map(goldMinerLevel);
    const profiles = [1, 25, 50, 75, 100].map(goldMinerDifficultyProfile);
    const targetIncreases = levels
      .slice(1)
      .map((level, index) => level.target - levels[index].target);
    const timeDrops = levels
      .slice(1)
      .map((level, index) => levels[index].seconds - level.seconds);
    const rockIncreases = profiles
      .slice(1)
      .map((profile, index) => profile.rockChance - profiles[index].rockChance);

    expect(timeDrops).toEqual([4, 4, 4, 4]);
    expect(targetIncreases[0]).toBeLessThan(targetIncreases.at(-1)!);
    expect(Math.max(...rockIncreases)).toBeLessThan(0.07);
  });

  it("摆幅覆盖两侧边缘，所有代表关卡生成的目标都在绳长内可达", () => {
    expect(GOLD_MINER_MAX_SWING_RAD).toBeGreaterThan((70 * Math.PI) / 180);
    expect(
      goldMinerAimTo(GOLD_MINER_GEOMETRY.mineMinX, GOLD_MINER_GEOMETRY.mineMinY)
        .reachable,
    ).toBe(true);
    expect(
      goldMinerAimTo(GOLD_MINER_GEOMETRY.mineMaxX, GOLD_MINER_GEOMETRY.mineMinY)
        .reachable,
    ).toBe(true);

    for (let level = 1; level <= 101; level += 1) {
      const mine = goldMinerLayout(level);
      expect(
        mine.reduce((sum, ore) => sum + ore.value, 0),
        `level ${level} total value`,
      ).toBeGreaterThanOrEqual(goldMinerLevel(level).target);
      for (const ore of mine) {
        const aim = goldMinerAimTo(ore.x, ore.y);
        expect(aim.reachable, `level ${level}: (${ore.x}, ${ore.y})`).toBe(
          true,
        );
        expect(aim.length).toBeLessThanOrEqual(GOLD_MINER_MAX_ROPE_LENGTH);
      }
    }
  });

  it("抓取后只移除并结算命中的矿物，不会刷新整片矿区", () => {
    const started = createGoldMinerRun(4);
    const afterFirstCatch = settleGoldMinerOre(started, 1, 38, 135);

    expect(afterFirstCatch).toEqual({
      score: 38,
      phase: "playing",
      remainingOreIds: [0, 2, 3],
    });
    expect(afterFirstCatch.remainingOreIds).toHaveLength(
      started.remainingOreIds.length - 1,
    );

    const duplicateCatch = settleGoldMinerOre(afterFirstCatch, 1, 38, 135);
    expect(duplicateCatch).toBe(afterFirstCatch);
  });

  it("达到目标后冻结为通关态，直到玩家明确进入下一关", () => {
    const nearlyCleared = settleGoldMinerOre(
      createGoldMinerRun(3),
      0,
      100,
      135,
    );
    const cleared = settleGoldMinerOre(nearlyCleared, 2, 40, 135);

    expect(cleared.phase).toBe("cleared");
    expect(cleared.score).toBe(140);
    expect(settleGoldMinerOre(cleared, 1, 50, 135)).toBe(cleared);
    expect(createGoldMinerRun(3)).toEqual({
      score: 0,
      phase: "playing",
      remainingOreIds: [0, 1, 2],
    });
  });

  it("负载越重，钩爪回收越慢", () => {
    expect(goldMinerRetractSpeed(0.7)).toBeGreaterThan(
      goldMinerRetractSpeed(3),
    );
  });
});
