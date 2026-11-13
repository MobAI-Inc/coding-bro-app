/**
 * 台球：球与球桌状态。
 *
 * 这层的核心是 `motionOf` 的三态判定。它看起来只是几个阈值比较，但它决定了
 * 解算器走哪条方程分支 —— 判错了，塞就消失，或者一杆永远结束不了。
 *
 * 下面着重钉两件容易写反的事：
 *   1. 先判打滑再判停（顺序反了，原地空转的球会被当成停下的球）；
 *   2. 摩擦基准是**接触点**速度而非球心速度（否则低杆缩回不存在）。
 */

import { describe, expect, it } from "vitest";
import {
  allStopped,
  ballsEqual,
  contactVelocity,
  makeBall,
  motionOf,
  movingCount,
  overlapping,
  pocketBall,
  spinFromAngular,
  statesEqual,
  withVelocity,
} from "@/bro/games/billiards/logic/ball";
import type { Ball } from "@/bro/games/billiards/logic/ball";
import { BALL_DIAMETER, BALL_RADIUS } from "@/bro/games/billiards/logic/table";
import { VEC2_ZERO, vLen, vSub, vec2 } from "@/bro/games/billiards/logic/vec";
import { ONE, ZERO, fromInt, fromRatio, mul, neg, toFloat } from "@/bro/games/billiards/logic/fixed";

const f = toFloat;

/** 造一颗带速度的球，省去每次写全字段。 */
function moving(vel = VEC2_ZERO, spin = VEC2_ZERO, spinZ = ZERO): Ball {
  return withVelocity(makeBall(0, vec2(ZERO, ZERO)), vel, spin, spinZ);
}

describe("billiards/ball 运动状态判定", () => {
  it("静止的球是 stopped", () => {
    expect(motionOf(makeBall(0, vec2(ZERO, ZERO)))).toBe("stopped");
  });

  it("有速度无旋转的球在打滑 —— 纯平移的球接触点必然在蹭台呢", () => {
    // 球心向前但完全不转，接触点相对台呢的速度就等于球心速度。
    expect(motionOf(moving(vec2(fromInt(2), ZERO)))).toBe("sliding");
  });

  /**
   * 纯滚动的定义：接触点相对速度为零，即 `vel + spin === 0`。
   *
   * spin 存的是「自转在接触点产生的线速度」，滚动时它与球心速度大小相等、
   * 方向相反 —— 接触点正好被自转抵消，不打滑。
   */
  it("接触点速度为零且球心在动 = rolling", () => {
    const v = vec2(fromInt(2), ZERO);
    const ball = moving(v, vec2(neg(fromInt(2)), ZERO));
    expect(f(vLen(contactVelocity(ball)))).toBe(0);
    expect(motionOf(ball)).toBe("rolling");
  });

  /**
   * **判定顺序的用例。**
   *
   * 原地低杆：球心速度为零，但球在倒转。接触点仍在高速打滑，摩擦力下一刻会
   * 把球推着往回走 —— 这正是「低杆缩回」的极端情形。
   *
   * 若把判定顺序写反（先用 `vel` 判停），这颗球会被判成 stopped，解算器直接
   * 跳过它，塞凭空消失。画面上看不出任何异常：球本来就没在动。
   */
  it("球心不动但在空转 = sliding，不是 stopped —— 判定顺序写反这里会红", () => {
    const ball = moving(VEC2_ZERO, vec2(fromInt(3), ZERO));
    expect(f(vLen(ball.vel))).toBe(0);
    expect(motionOf(ball)).toBe("sliding");
  });

  /**
   * 阈值必须存在。
   *
   * 没有它，球会以 1e-9 米/秒的速度永远滚下去：`allStopped` 永远不为真，
   * 一杆结束不了、击球权换不了、对局卡死。而阈值**取值多少不敏感**——
   * 3.9 毫米/秒的球在画面上完全看不出在动。
   */
  it("极慢的球判为 stopped —— 没有阈值的话一杆永远结束不了", () => {
    // 1/2000 米/秒，远低于 1/256 的阈值。
    const crawling = vec2(fromRatio(1, 2000), ZERO);
    expect(motionOf(moving(crawling))).toBe("stopped");
  });

  it("阈值之上的慢球仍在动 —— 阈值不能大到把正常滚动也吞掉", () => {
    // 1/16 米/秒：肉眼可见的慢滚，必须仍算在动。
    const slow = vec2(fromRatio(1, 16), ZERO);
    expect(motionOf(moving(slow))).not.toBe("stopped");
  });

  /**
   * 边界取严格大于：速度**恰好等于**阈值的球算停下。
   *
   * 这条能写出来，全靠 `motionOf` 比较的是速度而不是速度的平方。原先的实现
   * 图省一次开方，用 `vLenSq > STOP_SPEED_SQ` —— 而 3.9 毫米/秒平方之后是
   * **raw 1**，Q16.16 能表示的最小正数。低于它的一切都被平方自己截断成 0，
   * 阈值常数形同虚设：探针实测把阈值改成 0 行为几乎不变。那种情况下边界根本
   * 不存在，`>` 和 `>=` 也就无从区分。
   *
   * 改成比较速度之后，1/256 米/秒在定点域里是精确的 raw 256，边界是真的。
   */
  it("速度恰好等于阈值判为 stopped —— 边界是严格大于", () => {
    const exactly = vec2(fromRatio(1, 256), ZERO);
    expect(f(vLen(vec2(fromRatio(1, 256), ZERO)))).toBe(f(fromRatio(1, 256)));
    expect(motionOf(moving(exactly))).toBe("stopped");
    // 再快一个最低位就在动了。
    expect(motionOf(moving(vec2(fromRatio(1, 256) + 1, ZERO)))).not.toBe("stopped");
  });

  it("绕竖直轴的自转不影响运动状态 —— 它只在碰撞时起作用", () => {
    // 原地转 spinZ 的球仍然是停的：竖直轴自转不推动球心，接触点也不打滑。
    expect(motionOf(moving(VEC2_ZERO, VEC2_ZERO, fromInt(50)))).toBe("stopped");
  });
});

describe("billiards/ball 接触点速度", () => {
  /**
   * 摩擦力方向的基准量。
   *
   * 用球心速度当基准（`-v/|v|`）的话，摩擦力永远与球心运动反向，球只会
   * 减速到停 —— 低杆缩回、高杆跟进全都不存在。台球没有塞就不成立。
   */
  it("接触点速度 = 球心速度 + 自转贡献", () => {
    const ball = moving(vec2(fromInt(3), ZERO), vec2(fromInt(1), ZERO));
    expect(f(contactVelocity(ball).x)).toBe(4);
  });

  /**
   * 低杆：球心向前，但接触点**向前**滑得更快（球在倒转）。
   *
   * 于是摩擦力朝后，既减速球心又反过来把倒转磨掉。倒转足够强时球心速度
   * 会先归零再反向 —— 这就是缩杆。这条用例钉的是「u 与 v 可以同向但更大」
   * 以及「u 与 v 可以反向」这两种情形都能被正确表达。
   */
  it("低杆：接触点速度与球心速度同向但更大", () => {
    const ball = moving(vec2(fromInt(2), ZERO), vec2(fromInt(3), ZERO));
    expect(f(contactVelocity(ball).x)).toBeGreaterThan(f(ball.vel.x));
  });

  it("高杆过头：接触点速度可以与球心速度反向", () => {
    const ball = moving(vec2(fromInt(2), ZERO), vec2(neg(fromInt(5)), ZERO));
    expect(f(contactVelocity(ball).x)).toBeLessThan(0);
    expect(f(ball.vel.x)).toBeGreaterThan(0);
  });

  it("角速度按半径折算成接触点线速度", () => {
    const angular = vec2(fromInt(10), ZERO);
    expect(f(spinFromAngular(angular).x)).toBeCloseTo(10 * f(BALL_RADIUS), 4);
  });
});

describe("billiards/ball 入袋与重叠", () => {
  it("入袋的球速度归零且标记 pocketed", () => {
    const ball = pocketBall(moving(vec2(fromInt(3), fromInt(1)), vec2(ONE, ONE), fromInt(2)));
    expect(ball.pocketed).toBe(true);
    expect(ball.vel).toEqual(VEC2_ZERO);
    expect(ball.spin).toEqual(VEC2_ZERO);
    expect(ball.spinZ).toBe(ZERO);
  });

  it("入袋保留位置 —— 渲染要用它做落袋动画", () => {
    const before = makeBall(3, vec2(fromInt(1), fromInt(-1)));
    expect(pocketBall(before).pos).toEqual(before.pos);
  });

  /**
   * 重叠判定用的直径直接取自 table.ts，不在 ball.ts 里另算一次。
   *
   * 同一个量算两遍，两处的截断可能差一个最低位，于是「刚好接触」的两球在
   * 摆球检查里合法、在解算自检里非法（或反过来）。这条用例把两个模块的
   * 口径钉在一起。
   */
  it("圆心距小于一个直径即重叠", () => {
    const a = makeBall(0, vec2(ZERO, ZERO));
    const near = makeBall(1, vec2(BALL_RADIUS, ZERO));
    const far = makeBall(2, vec2(mul(fromInt(4), BALL_RADIUS), ZERO));
    expect(overlapping(a, near)).toBe(true);
    expect(overlapping(a, far)).toBe(false);
  });

  /**
   * 边界必须精确到**最低位**，这是回归用例。
   *
   * 阈值曾经是直径的平方（`vLenSq(d) < BALL_DIAMETER_SQ`），平方把 3744 压成
   * 213，判定实际生效在 3736 上 —— 球心距差 1 到 7 个 raw 的**真实重叠**全部
   * 判为不重叠。而 solver 的 `resolvePair` 判的是线性域的 `dist >= 直径`，
   * 同一个谓词两处各执一词：解算器认为在碰撞，自检认为没挨着。
   *
   * 逐 raw 扫过边界，比「取两个相隔很远的点」强得多：后者在错误的阈值下
   * 照样全绿（3744×0.5 和 3744×4 离 3736 都远得很），正是它放跑了这个 bug。
   */
  it("边界精确到最低位：差 1 个 raw 也算重叠", () => {
    const a = makeBall(0, vec2(ZERO, ZERO));
    const atDiameter = makeBall(1, vec2(BALL_DIAMETER, ZERO));
    expect(overlapping(a, atDiameter)).toBe(false);

    // 直径往内 1~8 个 raw，全部是真重叠。平方版在这里会给出 8 个 false。
    for (let d = 1; d <= 8; d += 1) {
      const inside = makeBall(1, vec2(BALL_DIAMETER - d, ZERO));
      expect(overlapping(a, inside), `球心距 = 直径-${d} raw 应判为重叠`).toBe(true);
    }
  });

  it("斜向的边界与轴向一致 —— 判定走长度，不该有方向偏好", () => {
    // 45° 方向上球心距略小于直径。x=y=trunc(D/√2) 之后长度必然 ≤ D。
    const a = makeBall(0, vec2(ZERO, ZERO));
    const leg = Math.trunc(BALL_DIAMETER / Math.SQRT2);
    const diag = makeBall(1, vec2(leg, leg));
    expect(vLen(vSub(diag.pos, a.pos))).toBeLessThan(BALL_DIAMETER);
    expect(overlapping(a, diag)).toBe(true);
  });

  it("入袋的球不参与重叠判定 —— 它的位置只是动画残留", () => {
    const a = makeBall(0, vec2(ZERO, ZERO));
    const b = pocketBall(makeBall(1, vec2(ZERO, ZERO)));
    expect(overlapping(a, b)).toBe(false);
    expect(overlapping(b, a)).toBe(false);
  });
});

describe("billiards/ball 全桌状态", () => {
  it("全部静止时 allStopped 为真，有球在动即为假", () => {
    const still = { balls: [makeBall(0, vec2(ZERO, ZERO)), makeBall(1, vec2(ONE, ZERO))] };
    expect(allStopped(still)).toBe(true);
    expect(movingCount(still)).toBe(0);

    const rolling = { balls: [...still.balls, moving(vec2(fromInt(2), ZERO))] };
    expect(allStopped(rolling)).toBe(false);
    expect(movingCount(rolling)).toBe(1);
  });

  it("入袋的球不算在动 —— 否则最后一颗球落袋后一杆永远结束不了", () => {
    const state = { balls: [pocketBall(moving(vec2(fromInt(5), ZERO)))] };
    expect(allStopped(state)).toBe(true);
    expect(movingCount(state)).toBe(0);
  });

  /**
   * 豁免的判据是 `pocketed` 这个**标记**，不是「入袋的球恰好速度为零」。
   *
   * 上一条用例走 `pocketBall`，而它会把速度清零，于是球本来就判为 stopped ——
   * 豁免那一句删掉，用例照样绿（变异测试正是这样发现的）。看上去像死代码。
   *
   * 但它不是。`Ball` 是普通接口，解算器在一步之内完全可能先算出新速度、再
   * 检出入袋，中间态就是「pocketed 为真且速度非零」。真按那时的速度去判，
   * 这颗球会被算成还在运动，`allStopped` 永不为真——最后一颗球落袋后对局卡死，
   * 而且**只在最后一杆复现**，是最难查的那类 bug。
   *
   * 所以这里刻意绕过 `pocketBall` 手工构造中间态。
   */
  it("豁免看的是 pocketed 标记而非速度 —— 解算器中间态可能带速度入袋", () => {
    const midStep = { ...moving(vec2(fromInt(5), ZERO)), pocketed: true };
    expect(motionOf(midStep)).not.toBe("stopped");
    expect(allStopped({ balls: [midStep] })).toBe(true);
    expect(movingCount({ balls: [midStep] })).toBe(0);
  });
});

describe("billiards/ball 逐字段比较（三方演算一致性的判据）", () => {
  /**
   * 两端演算分叉是台球同步方案的**唯一**失败模式，而它的表现极其隐蔽：
   * 球的位置差 15 微米，画面上完全看不出，但几次碰撞放大之后就是「我这边
   * 进袋了，你那边没进」。所以比较必须是逐位的，不能有任何容差。
   */
  it("差一个最低位即判为不同 —— 容差比较在这里等于没比较", () => {
    const a = makeBall(0, vec2(fromInt(1), ZERO));
    const b = makeBall(0, vec2(fromInt(1) + 1, ZERO));
    expect(ballsEqual(a, b)).toBe(false);
    expect(ballsEqual(a, a)).toBe(true);
  });

  it("每个字段都参与比较 —— 漏掉哪个，那个字段的分叉就查不出来", () => {
    const base = makeBall(0, vec2(ZERO, ZERO));
    const variants: Ball[] = [
      { ...base, id: 1 },
      { ...base, pos: vec2(ONE, ZERO) },
      { ...base, pos: vec2(ZERO, ONE) },
      { ...base, vel: vec2(ONE, ZERO) },
      { ...base, vel: vec2(ZERO, ONE) },
      { ...base, spin: vec2(ONE, ZERO) },
      { ...base, spin: vec2(ZERO, ONE) },
      { ...base, spinZ: ONE },
      { ...base, pocketed: true },
    ];
    for (const v of variants) {
      expect(ballsEqual(base, v)).toBe(false);
    }
  });

  it("整桌比较：球数不同或任一球不同即为假", () => {
    const s1 = { balls: [makeBall(0, vec2(ZERO, ZERO)), makeBall(1, vec2(ONE, ZERO))] };
    expect(statesEqual(s1, s1)).toBe(true);
    expect(statesEqual(s1, { balls: [s1.balls[0]] })).toBe(false);
    expect(statesEqual(s1, { balls: [s1.balls[1], s1.balls[0]] })).toBe(false);
  });
});
