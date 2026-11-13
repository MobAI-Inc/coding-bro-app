/**
 * 陪练机器人。
 *
 * 瞄准一颗合法目标球直接打，力度带一点随机。不做走位、不算反弹 —— 真正的对手
 * 来自匹配，这里只是让球桌在服务端就绪前能一个人玩起来。
 *
 * RNG 由外部注入而非直接用 `Math.random()`，测试才能固定种子断言着手。
 */

import { toFloat } from "../logic/fixed";
import type { EightBallState } from "../logic/rules";
import { cueBallOf, legalTargets } from "../logic/rules";
import type { StrikeParams } from "../logic/solver";
import { angleToBrad, powerToFixed } from "../render/layout";

/**
 * 选一杆。
 *
 * 没有合法目标（理论上不该发生）时随便打一杆 —— 返回 `null` 会让页面卡住，
 * 而一杆废球至少能推进对局，服务端会照常判它犯规。
 */
export function chooseShot(
  state: EightBallState,
  random: () => number,
): StrikeParams {
  return chooseShotDecision(state, random).shot;
}

export interface BilliardsBotDecision {
  readonly shot: StrikeParams;
  readonly explanation: string;
}

/** 返回击球参数与不依赖隐藏信息的简短理由，供本地演示展示 AI 思路。 */
export function chooseShotDecision(
  state: EightBallState,
  random: () => number,
): BilliardsBotDecision {
  const cue = cueBallOf(state);
  const targets = legalTargets(state, state.turn);
  const onTable = state.table.balls.filter(
    (b) => !b.pocketed && targets.includes(b.id),
  );

  if (cue === undefined || onTable.length === 0) {
    return {
      shot: {
        angle: Math.floor(random() * 16384),
        power: powerToFixed(0.5),
        offsetX: 0,
        offsetY: 0,
      },
      explanation: "没有清晰合法目标，选择中等力度安全推进",
    };
  }

  const target = onTable[Math.floor(random() * onTable.length)];
  const dx = toFloat(target.pos.x) - toFloat(cue.pos.x);
  const dy = toFloat(target.pos.y) - toFloat(cue.pos.y);

  // 瞄准方向上加一点抖动，否则每一杆都精确命中，看着像开挂。
  const jitter = Math.floor((random() - 0.5) * 400);

  return {
    shot: {
      angle: (angleToBrad(dx, dy) + jitter + 16384) % 16384,
      power: powerToFixed(0.45 + random() * 0.35),
      offsetX: 0,
      offsetY: 0,
    },
    explanation: `瞄准合法目标 ${target.id} 号球，使用中等力度直接进攻`,
  };
}
