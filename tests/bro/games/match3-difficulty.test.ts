

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  applySwap,
  createInitialState,
  findAvailableMoves,
} from "@/bro/games/match3/logic";
import type { Match3State } from "@/bro/games/match3/logic";
import {
  DEFAULT_MOVE_LIMIT,
  DEFAULT_TARGET_SCORE,
} from "@/bro/games/match3/view";

/**
 * 「会看盘但不刻意摆连锁」的普通玩家：每步随机看三个候选，挑其中最好的。
 *
 * 用固定的线性同余发生器选候选，不用 Math.random——测试必须每次跑出同一个
 * 数，否则通关率会在边界附近随机翻红，然后被当成 flaky 静音掉。
 */
function playAverage(seed: number): number {
  let state: Match3State = createInitialState(seed, DEFAULT_CONFIG);
  let rng = seed >>> 0;
  const rand = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  for (let move = 0; move < DEFAULT_MOVE_LIMIT; move++) {
    const moves = findAvailableMoves(state.grid);
    if (moves.length === 0) break;

    let best: Match3State | null = null;
    for (let i = 0; i < 3; i++) {
      const mv = moves[Math.floor(rand() * moves.length)];
      const out = applySwap(state, mv.a, mv.b);
      if (out.accepted && (best === null || out.state.score > best.score)) {
        best = out.state;
      }
    }
    if (best === null) break;
    state = best;
  }
  return state.score;
}

const SEEDS = 300;

describe("难度标定", () => {
  it("普通玩家通关率落在 40%~70%——积分赔付率就是这个数", () => {
    const cleared = Array.from({ length: SEEDS }, (_, i) =>
      playAverage(i + 1),
    ).filter((score) => score >= DEFAULT_TARGET_SCORE).length;
    const rate = cleared / SEEDS;

    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.7);
  });

  it("目标分与步数是一对，改一个另一个就得重标", () => {
    // 这条不验数值对错，只钉住「这两个数被一起动过」。25 步 / 2600 分是
    // 上面那次标定的产物；单独改任何一个，上面的通关率就不再成立
    expect(DEFAULT_MOVE_LIMIT).toBe(25);
    expect(DEFAULT_TARGET_SCORE).toBe(2600);
  });
});
