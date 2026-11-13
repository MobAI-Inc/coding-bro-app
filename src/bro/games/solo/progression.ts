export interface SoloLevelDefinition {
  /** Optional echo for game-specific level factories. Progression remains authoritative. */
  readonly levelNumber?: number;
  rewardPoints: number;
  difficulty: number;
}

interface StoredSoloProgress {
  highestCompletedLevel: number;
}

export interface SoloProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SoloLevelState extends SoloLevelDefinition {
  levelNumber: number;
  unlocked: boolean;
  claimed: boolean;
}

export interface SoloProgressSnapshot {
  gameId: string;
  nextUnlockedLevel: number;
  highestCompletedLevel: number;
}

export type SoloCompletionResult =
  | {
      status: "completed";
      firstCompletion: boolean;
      awardedPoints: number;
      unlockedLevelNumber: number;
      progress: SoloProgressSnapshot;
    }
  | {
      status: "locked" | "invalid-level";
      firstCompletion: false;
      awardedPoints: 0;
      unlockedLevelNumber: number;
      progress: SoloProgressSnapshot;
    };

/** Small Storage-compatible implementation for tests and session-only play. */
export class MemorySoloProgressStorage implements SoloProgressStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const fallbackMemoryStorage = new MemorySoloProgressStorage();

export interface SoloProgressionOptions {
  gameId: string;
  levelFor: (levelNumber: number) => SoloLevelDefinition;
  storage?: SoloProgressStorage;
  storageKeyPrefix?: string;
}

export interface CappedSoloLevelFactoryOptions {
  initialDifficulty: number;
  difficultyStep: number;
  maxDifficulty: number;
  rewardPoints: number | ((levelNumber: number) => number);
}

/** Creates endless levels whose difficulty rises linearly and then stays capped. */
export function createCappedSoloLevelFactory({
  initialDifficulty,
  difficultyStep,
  maxDifficulty,
  rewardPoints,
}: CappedSoloLevelFactoryOptions): (
  levelNumber: number,
) => SoloLevelDefinition {
  if (difficultyStep < 0)
    throw new Error("difficultyStep must not be negative");
  if (maxDifficulty < initialDifficulty) {
    throw new Error("maxDifficulty must be at least initialDifficulty");
  }

  return (levelNumber) => {
    assertLevelNumber(levelNumber);
    return {
      rewardPoints:
        typeof rewardPoints === "function"
          ? rewardPoints(levelNumber)
          : rewardPoints,
      difficulty: Math.min(
        maxDifficulty,
        initialDifficulty + (levelNumber - 1) * difficultyStep,
      ),
    };
  };
}

/** Endless sequential progression. Claimed lower levels stay replayable for zero points. */
export class SoloProgression {
  private readonly gameId: string;
  private readonly levelFor: (levelNumber: number) => SoloLevelDefinition;
  private readonly storage: SoloProgressStorage;
  private readonly storageKey: string;

  constructor({
    gameId,
    levelFor,
    storage = defaultSoloProgressStorage(),
    storageKeyPrefix = "coding-bro:solo-progress",
  }: SoloProgressionOptions) {
    if (!gameId.trim()) throw new Error("gameId must not be empty");
    this.gameId = gameId;
    this.levelFor = levelFor;
    this.storage = storage;
    this.storageKey = `${storageKeyPrefix}:${gameId}`;
  }

  canPlay(levelNumber: number): boolean {
    return (
      isLevelNumber(levelNumber) &&
      levelNumber <= this.snapshot().nextUnlockedLevel
    );
  }

  getLevel(levelNumber: number): SoloLevelState {
    assertLevelNumber(levelNumber);
    const progress = this.snapshot();
    const definition = this.levelFor(levelNumber);
    assertDefinition(definition, levelNumber);
    return {
      ...definition,
      levelNumber,
      unlocked: levelNumber <= progress.nextUnlockedLevel,
      claimed: levelNumber <= progress.highestCompletedLevel,
    };
  }

  snapshot(): SoloProgressSnapshot {
    const highestCompletedLevel = this.readHighestCompletedLevel();
    return {
      gameId: this.gameId,
      nextUnlockedLevel: highestCompletedLevel + 1,
      highestCompletedLevel,
    };
  }

  completeLevel(levelNumber: number): SoloCompletionResult {
    const before = this.snapshot();
    if (!isLevelNumber(levelNumber))
      return this.rejected("invalid-level", before);
    if (levelNumber > before.nextUnlockedLevel)
      return this.rejected("locked", before);
    if (levelNumber <= before.highestCompletedLevel) {
      return {
        status: "completed",
        firstCompletion: false,
        awardedPoints: 0,
        unlockedLevelNumber: before.nextUnlockedLevel,
        progress: before,
      };
    }

    const definition = this.levelFor(levelNumber);
    assertDefinition(definition, levelNumber);
    this.writeHighestCompletedLevel(levelNumber);
    const progress = this.snapshot();
    return {
      status: "completed",
      firstCompletion: true,
      awardedPoints: definition.rewardPoints,
      unlockedLevelNumber: progress.nextUnlockedLevel,
      progress,
    };
  }

  private rejected(
    status: "locked" | "invalid-level",
    progress: SoloProgressSnapshot,
  ): SoloCompletionResult {
    return {
      status,
      firstCompletion: false,
      awardedPoints: 0,
      unlockedLevelNumber: progress.nextUnlockedLevel,
      progress,
    };
  }

  private readHighestCompletedLevel(): number {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return 0;
    try {
      const stored = JSON.parse(raw) as Partial<StoredSoloProgress>;
      return typeof stored.highestCompletedLevel === "number" &&
        Number.isInteger(stored.highestCompletedLevel) &&
        stored.highestCompletedLevel >= 0
        ? stored.highestCompletedLevel
        : 0;
    } catch {
      return 0;
    }
  }

  private writeHighestCompletedLevel(highestCompletedLevel: number): void {
    const stored: StoredSoloProgress = {
      highestCompletedLevel,
    };
    this.storage.setItem(this.storageKey, JSON.stringify(stored));
  }
}

/** Completes a level and forwards points only for its first successful clear. */
export function settleFirstCompletion(
  progression: SoloProgression,
  levelNumber: number,
  onSettle?: (points: number) => void,
): SoloCompletionResult {
  const result = progression.completeLevel(levelNumber);
  if (result.firstCompletion) onSettle?.(result.awardedPoints);
  return result;
}

function defaultSoloProgressStorage(): SoloProgressStorage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Some embedded browsers expose localStorage but deny access to it.
  }
  return fallbackMemoryStorage;
}

function isLevelNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function assertLevelNumber(value: number): void {
  if (!isLevelNumber(value))
    throw new Error("levelNumber must be a positive integer");
}

function assertDefinition(
  definition: SoloLevelDefinition,
  levelNumber: number,
): void {
  if (
    !Number.isFinite(definition.rewardPoints) ||
    definition.rewardPoints < 0 ||
    !Number.isFinite(definition.difficulty)
  ) {
    throw new Error(`invalid level definition: ${levelNumber}`);
  }
}
