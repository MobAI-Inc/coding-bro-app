/**
 * 台球：球与球桌状态。
 *
 * 这个文件只定义**状态**与状态上的纯函数，不含演算逻辑（那在 solver.ts）。
 * 分开是因为状态要跨进程比对：服务端演算一份、两端客户端各演算一份，三方
 * 逐字段比较的就是这里的结构。
 *
 * ## 为什么球要区分「滑动」和「滚动」
 *
 * 这是通用刚体引擎（Matter.js、cannon-es）建模不了台球的核心原因，也是
 * TECH-DESIGN.md §6.3 决定自研解算器的理由。
 *
 * 刚击出的母球是**滑动**的：球心速度与自转在接触点产生的线速度对不上，接触点
 * 相对台呢在打滑。这一段摩擦力大（滑动摩擦），方向由**接触点的相对速度**决定
 * 而非球心速度 —— 这就是「低杆缩回、高杆跟进」的全部来源：低杆时球在倒转，
 * 接触点向前滑，摩擦力朝后，球减速甚至倒退。
 *
 * 打滑消失后进入**滚动**：接触点相对速度为零，此后只受很小的滚动阻力，球近乎
 * 匀速地滚很远。
 *
 * 通用引擎只有一个「摩擦系数」，把这两段合成一段线性减速，于是塞（spin）完全
 * 失效 —— 所有球都像冰球一样直着滑到停。台球没有塞就不成立。
 */

import { ZERO, fromRatio } from "./fixed";
import type { Fixed } from "./fixed";
import { VEC2_ZERO, vAdd, vLen, vScale, vSub } from "./vec";
import type { Vec2 } from "./vec";
import { BALL_DIAMETER, BALL_RADIUS } from "./table";

/**
 * 球的运动状态。
 *
 * 不是给渲染层看的枚举，是解算器的**分支依据** —— 三种状态适用的方程不同。
 */
export type BallMotion =
  /** 接触点在打滑。摩擦力大，方向由接触点相对速度决定。塞在这一段起作用。 */
  | "sliding"
  /** 纯滚动。接触点不打滑，只受滚动阻力。 */
  | "rolling"
  | "stopped";

/**
 * 一颗球。
 *
 * 全部量在定点域内，逐位可比 —— 三方演算的一致性就是靠对这个结构做逐字段
 * 比较来验证的。
 */
export interface Ball {
  readonly id: number;
  readonly pos: Vec2;
  /** 球心速度（米/秒）。 */
  readonly vel: Vec2;
  /**
   * 自转在**接触点**产生的线速度（米/秒），已按半径折算。
   *
   * 不存角速度而存折算后的线速度：解算里每次用到它都是 `ω × R` 这个组合，
   * 存角速度就要在每个用到的地方各乘一次半径，而每次乘法都是一次截断。
   * 折算一次存起来，截断也只发生一次。
   *
   * x 分量对应上下旋（高杆/低杆），y 分量对应侧向的滑动分量。
   */
  readonly spin: Vec2;
  /**
   * 绕竖直轴的自转（弧度/秒）。正为逆时针。
   *
   * 单独拿出来：它不改变球心的直线运动，只在**碰库**和**撞球**时改变切向
   * 摩擦，也就是「左塞右塞让球吃库后拐弯」。混进 spin 会让两种完全不同的
   * 效应共用一套衰减，是个很难查的错误。
   */
  readonly spinZ: Fixed;
  /** 已入袋的球不参与任何演算。 */
  readonly pocketed: boolean;
}

/** 球桌上的完整状态。演算的输入与输出都是它。 */
export interface TableState {
  readonly balls: readonly Ball[];
}

/**
 * 静止判定速度：1/256 米/秒 ≈ 3.9 毫米/秒。
 *
 * 阈值必须存在。没有它，球会以 1e-9 米/秒的速度永远滚下去：`allStopped` 永远
 * 不为真，一杆结束不了、击球权换不了、对局卡死。而**取值多少不敏感** ——
 * 3.9 毫米/秒的球在画面上完全看不出在动。
 */
const STOP_SPEED: Fixed = fromRatio(1, 256);

/** 打滑判定阈值。同样的量级，同样的理由：低于此值认为接触点已不打滑。 */
const SLIDE_EPS: Fixed = STOP_SPEED;

/**
 * 接触点相对台呢的速度。
 *
 * **滑动段一切计算的基准量** —— 摩擦力方向是 `-u/|u|`，不是 `-v/|v|`。
 * 用后者的话低杆缩回就不存在了：那正是 v 与 u 方向相反的情形。
 */
export function contactVelocity(ball: Ball): Vec2 {
  return vAdd(ball.vel, ball.spin);
}

/**
 * 判定球当前的运动状态。
 *
 * ## 为什么比较速度而不是速度的平方
 *
 * 用 `vLenSq(v) > STOP_SPEED_SQ` 省一次开方，听起来是免费的优化，实际上把阈值的
 * 分辨率压没了：3.9 毫米/秒平方之后是 **raw 1**，也就是 Q16.16 能表示的最小正数。
 * 低于这个速度的一切都被平方**自己**截断成 0，阈值常数形同虚设 —— 探针实测把
 * 阈值改成 0，行为几乎不变（变异测试正是这样发现它的）。
 *
 * 顺带一提，改用 `vLen` 之所以真的管用，是因为 `vLen` 本身也被一并修好了：它
 * 原先是 `sqrt(vLenSq(v))`，平方和照样先落回 Q16.16，开方恢复不了已经丢掉的位，
 * 于是长度只能取 {0, 256, 362, 443, …} 这一串离散值，边界照样不存在。现在它走
 * fixed.ts 的 `hypot`，在原始整数域里求斜边，1/256 米/秒对应精确的 raw 256。
 *
 * 一次开方换回一个真正可调、可读、可测的阈值，这笔交易划算：这个函数每帧每球
 * 调一次，而 `isqrt` 是纯整数逐位法，开销远小于一次碰撞求解。
 *
 * ## 判定顺序
 *
 * **先判打滑，再判停。** 一颗球心速度为零但仍在原地空转的球（原地低杆打出来
 * 就是这样），接触点仍在打滑，必须归为 sliding——它下一刻会被摩擦力推着动起来。
 * 反过来先用 `vel` 判停，就会把它错判成 stopped，塞直接消失，而画面上看不出
 * 任何异常：球本来就没在动。
 */
export function motionOf(ball: Ball): BallMotion {
  if (vLen(contactVelocity(ball)) > SLIDE_EPS) {
    return "sliding";
  }
  return vLen(ball.vel) > STOP_SPEED ? "rolling" : "stopped";
}

/** 全桌是否已静止 —— 一杆结束、可以交换击球权的判定。 */
export function allStopped(state: TableState): boolean {
  return state.balls.every((b) => b.pocketed || motionOf(b) === "stopped");
}

/** 台面上仍在运动的球数。解算器据此决定是否还要继续推进。 */
export function movingCount(state: TableState): number {
  return state.balls.filter((b) => !b.pocketed && motionOf(b) !== "stopped")
    .length;
}

/**
 * 造一颗静止的球。
 *
 * 显式列出所有字段而不是展开 `Partial`：新增字段时这里会编译报错，逼调用方
 * 想清楚初值。物理状态漏初始化一个字段，表现是「偶尔有球行为诡异」。
 */
export function makeBall(id: number, pos: Vec2): Ball {
  return {
    id,
    pos,
    vel: VEC2_ZERO,
    spin: VEC2_ZERO,
    spinZ: ZERO,
    pocketed: false,
  };
}

/** 施加速度与旋转。击球的唯一入口 —— 见 solver.ts 的 `strike`。 */
export function withVelocity(
  ball: Ball,
  vel: Vec2,
  spin: Vec2,
  spinZ: Fixed,
): Ball {
  return { ...ball, vel, spin, spinZ };
}

/** 入袋。位置保留在原处供渲染做落袋动画；解算器只看 `pocketed`。 */
export function pocketBall(ball: Ball): Ball {
  return {
    ...ball,
    vel: VEC2_ZERO,
    spin: VEC2_ZERO,
    spinZ: ZERO,
    pocketed: true,
  };
}

/**
 * 两球是否重叠。
 *
 * 摆球与解算后的自检都用它。重叠的球会让碰撞求解得到负的分离时间，两球于是
 * **粘在一起**互相推挤 —— 一个经典的、看起来像「物理引擎抽风」的现象。
 *
 * 阈值直接用 table.ts 的 `BALL_DIAMETER`，不在这里另算一次直径：同一个量算
 * 两遍，两处的截断结果可能差一个最低位，于是「刚好接触」的两球在摆球检查里
 * 合法、在解算自检里非法。
 *
 * 比较**长度**而不是长度的平方。理由与 `motionOf` 完全相同（见上），而且这里
 * 曾经就栽在这上面：阈值原先是 `BALL_DIAMETER_SQ`，判定写成 `vLenSq(d) < 它`，
 * 结果球心距 3737~3743 raw（直径 3744）这一整段真实重叠全部被判为不重叠 ——
 * 平方把阈值的低 7 位碾没了。solver.ts 的 `resolvePair` 判的是线性域的
 * `dist >= 直径`，于是同一个谓词两处各执一词。详见 table.ts 里
 * `BALL_DIAMETER` 的说明。
 */
export function overlapping(a: Ball, b: Ball): boolean {
  if (a.pocketed || b.pocketed) {
    return false;
  }
  return vLen(vSub(a.pos, b.pos)) < BALL_DIAMETER;
}

/** 逐字段比较两颗球。三方演算一致性校验用。 */
export function ballsEqual(a: Ball, b: Ball): boolean {
  return (
    a.id === b.id &&
    a.pos.x === b.pos.x &&
    a.pos.y === b.pos.y &&
    a.vel.x === b.vel.x &&
    a.vel.y === b.vel.y &&
    a.spin.x === b.spin.x &&
    a.spin.y === b.spin.y &&
    a.spinZ === b.spinZ &&
    a.pocketed === b.pocketed
  );
}

/** 整桌逐字段比较。不一致即两端演算分叉，是必须立刻暴露的事故。 */
export function statesEqual(a: TableState, b: TableState): boolean {
  return (
    a.balls.length === b.balls.length &&
    a.balls.every((ball, i) => ballsEqual(ball, b.balls[i]))
  );
}

/**
 * 角速度（弧度/秒）折算成接触点线速度。
 *
 * 只在**输入边界**用一次 —— 击球参数进来时折算，此后全程用折算后的量。
 * 反向折算（线速度回角速度）刻意不提供：渲染层要的球面转角可以直接用
 * `spin` 配合半径现算，而多一个反向函数就多一条「来回折算导致误差累积」
 * 的路径，而那种误差只在长时间对局后才显形。
 */
export function spinFromAngular(angular: Vec2): Vec2 {
  return vScale(angular, BALL_RADIUS);
}
