import { describe, expect, it, vi } from "vitest";
import {
  createCappedSoloLevelFactory,
  MemorySoloProgressStorage,
  settleFirstCompletion,
  SoloProgression,
  type SoloProgressStorage,
} from "@/bro/games/solo";

const levelFor = createCappedSoloLevelFactory({
  initialDifficulty: 1,
  difficultyStep: 0.5,
  maxDifficulty: 2,
  rewardPoints: (levelNumber) => levelNumber * 10,
});

function createProgression(
  storage: SoloProgressStorage = new MemorySoloProgressStorage(),
) {
  return new SoloProgression({ gameId: "gold-miner", levelFor, storage });
}

describe("SoloProgression", () => {
  it("starts at level 1 and locks later levels", () => {
    const progression = createProgression();
    expect(progression.snapshot()).toEqual({
      gameId: "gold-miner",
      nextUnlockedLevel: 1,
      highestCompletedLevel: 0,
    });
    expect(progression.canPlay(1)).toBe(true);
    expect(progression.canPlay(2)).toBe(false);
  });

  it("awards once and unlocks the next level", () => {
    const progression = createProgression();
    expect(progression.completeLevel(1)).toMatchObject({
      status: "completed",
      firstCompletion: true,
      awardedPoints: 10,
      unlockedLevelNumber: 2,
    });
    expect(progression.completeLevel(1)).toMatchObject({
      status: "completed",
      firstCompletion: false,
      awardedPoints: 0,
      unlockedLevelNumber: 2,
    });
  });

  it("calls onSettle only for the first completion of a level", () => {
    const progression = createProgression();
    const onSettle = vi.fn();

    settleFirstCompletion(progression, 1, onSettle);
    settleFirstCompletion(progression, 1, onSettle);

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(10);
  });

  it("rejects a locked level without changing claimed history", () => {
    const progression = createProgression();
    expect(progression.completeLevel(2)).toMatchObject({
      status: "locked",
      firstCompletion: false,
      awardedPoints: 0,
    });
    expect(progression.snapshot().highestCompletedLevel).toBe(0);
  });

  it("continues unlocking without a final level", () => {
    const progression = createProgression();
    for (let level = 1; level <= 100; level += 1) {
      const result = progression.completeLevel(level);
      expect(result.firstCompletion).toBe(true);
      expect(result.unlockedLevelNumber).toBe(level + 1);
    }
    expect(progression.canPlay(101)).toBe(true);
    expect(progression.snapshot().highestCompletedLevel).toBe(100);
  });

  it("raises difficulty and holds it at the cap", () => {
    const progression = createProgression();
    expect(progression.getLevel(1).difficulty).toBe(1);
    expect(progression.getLevel(2).difficulty).toBe(1.5);
    expect(progression.getLevel(3).difficulty).toBe(2);
    expect(progression.getLevel(200).difficulty).toBe(2);
  });

  it("persists claimed levels per game through injected storage", () => {
    const storage = new MemorySoloProgressStorage();
    createProgression(storage).completeLevel(1);
    const restored = createProgression(storage);
    expect(restored.snapshot()).toMatchObject({
      nextUnlockedLevel: 2,
      highestCompletedLevel: 1,
    });
    expect(restored.completeLevel(1).awardedPoints).toBe(0);

    const slots = new SoloProgression({ gameId: "slots", levelFor, storage });
    expect(slots.snapshot().highestCompletedLevel).toBe(0);
  });

  it("uses browser localStorage by default and restores a rebuilt instance", () => {
    const storageKeyPrefix = `test:solo:${crypto.randomUUID()}`;
    const first = new SoloProgression({
      gameId: "match3",
      levelFor,
      storageKeyPrefix,
    });
    first.completeLevel(1);

    const rebuilt = new SoloProgression({
      gameId: "match3",
      levelFor,
      storageKeyPrefix,
    });
    expect(rebuilt.snapshot()).toMatchObject({
      nextUnlockedLevel: 2,
      highestCompletedLevel: 1,
    });
  });

  it("rejects invalid level numbers without awarding points", () => {
    expect(createProgression().completeLevel(0)).toMatchObject({
      status: "invalid-level",
      firstCompletion: false,
      awardedPoints: 0,
    });
  });
});
