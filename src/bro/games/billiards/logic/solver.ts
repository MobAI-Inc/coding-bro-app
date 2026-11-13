/**
 * 台球：确定性物理解算器。
 *
 * 台球是六款游戏里唯一**不传状态、传输入**的（TECH-DESIGN.md §6.3）：玩家提交
 * 「角度 + 力度 + 击球点」，两端客户端与服务端各自演算，必须逐位一致。这个文件
 * 就是那份「完全相同的物理引擎」。
 *
 * ## 为什么不用现成的刚体引擎
 *
 * Matter.js、cannon-es 这类通用引擎只有**一个**摩擦系数，把滑动段与滚动段合成
 * 一段线性减速。台球的塞（spin）全部来自这两段的区别 —— 合并之后低杆不会缩、
 * 高杆不会跟、侧塞吃库不会拐，所有球都像冰球一样直着滑到停。它们也没有「接触点
 * 相对速度」这个概念，而那才是滑动段摩擦力的方向基准。
 *
 * ## 时间推进：整拍算摩擦，子步走位移
 *
 * 每拍 1/256 秒。位移按需拆成 2 的幂个子步（高速球一拍能走 156 毫米，而球直径
 * 只有 57 毫米，不拆就会**穿过**另一颗球），但摩擦**每拍只算一次**。
 *
 * 后者是实测定下来的：滚动阻力每拍的速度增量是 raw 25，拆成 16 子步之后每步
 * raw 1.57 —— 定点截断成 1，相对误差 36%，而且是**单向**的（截断永远朝零），
 * 几百拍累积下来球会明显多滚一截。整拍算一次则始终在 raw 25 这个量级上，
 * 截断误差可以忽略。子步只负责「不穿模」，不该替摩擦承担精度责任。
 *
 * ## 确定性的三条纪律
 *
 * 1. 全程定点，不碰浮点（见 fixed.ts）；
 * 2. 碰撞按**固定顺序**处理：球对按下标升序、库边按数组序、最后查袋。任何依赖
 *    遍历顺序的写法都会在两端给出不同结果，而这里的顺序是写死的；
 * 3. 子步数由速度**离散地**推出（2 的幂），不是浮点比较的产物。
 */

import {
  HALF,
  ONE,
  ZERO,
  add,
  div,
  fromInt,
  fromRatio,
  mul,
  neg,
  sub,
} from "./fixed";
import type { Fixed } from "./fixed";
import {
  VEC2_ZERO,
  bradToDir,
  vAdd,
  vDot,
  vLen,
  vNormalize,
  vPerp,
  vScale,
  vSub,
} from "./vec";
import type { Vec2 } from "./vec";
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUSHIONS,
  POCKETS,
  pocketAt,
} from "./table";
import { allStopped, contactVelocity, motionOf, pocketBall } from "./ball";
import type { Ball, TableState } from "./ball";

// ───────────────────────── 物理系数 ─────────────────────────

/** 重力加速度（米/秒²）。 */
const GRAVITY: Fixed = fromRatio(98, 10);

/** 滑动摩擦系数。台呢与球之间，典型值 0.2。 */
const MU_SLIDE: Fixed = fromRatio(2, 10);

/** 滚动阻力系数。比滑动小一个数量级 —— 这正是球止滑后能滚很远的原因。 */
const MU_ROLL: Fixed = fromRatio(1, 100);

/** 球与球之间的摩擦系数。决定「塞能传多少给目标球」（throw）。 */
const MU_BALL: Fixed = fromRatio(6, 100);

/** 球与库边之间的摩擦系数。决定侧塞吃库后拐多少。 */
const MU_CUSHION: Fixed = fromRatio(2, 10);

/** 球与球的恢复系数。象牙球接近完全弹性，树脂球约 0.95。 */
const RESTITUTION_BALL: Fixed = fromRatio(95, 100);

/** 球与库边的恢复系数。库边吃掉的能量比撞球多得多。 */
const RESTITUTION_CUSHION: Fixed = fromRatio(75, 100);

/**
 * 竖直轴自转的衰减率（弧度/秒²）：15μg/(16R)。
 *
 * 系数来自「圆盘状接触斑上的钻磨摩擦」模型。μ 取比滑动摩擦小得多的值 —— 竖直轴
 * 自转靠接触斑内部的相对滑移消耗，力臂只有接触斑半径那么大，衰减比平动慢得多。
 * 实测 50 弧度/秒要 5 秒才磨光，与「侧塞能一直留到吃库」的手感相符。
 */
const SPIN_Z_DECAY: Fixed = div(
  mul(mul(fromInt(15), fromRatio(3, 100)), GRAVITY),
  mul(fromInt(16), BALL_RADIUS),
);

/**
 * 滑动段接触点速度的衰减率 = (7/2)μg。
 *
 * 球体转动惯量 I = (2/5)mR²，摩擦力作用在接触点上，于是自转的变化率是球心的
 * 5/2 倍，方向相同（都在消解接触点的相对滑动）。两者相加，接触点速度的衰减是
 * 球心的 **7/2 倍** —— 这个 7/2 是台球物理里最常出现的数，撞球与碰库的切向
 * 冲量也由它决定。
 */
const SLIDE_DECEL_U: Fixed = mul(fromRatio(7, 2), mul(MU_SLIDE, GRAVITY));

/** 滑动段球心速度的衰减率 = μg。 */
const SLIDE_DECEL_V: Fixed = mul(MU_SLIDE, GRAVITY);

/** 滚动段球心速度的衰减率 = μ_r·g。 */
const ROLL_DECEL: Fixed = mul(MU_ROLL, GRAVITY);

// ───────────────────────── 时间 ─────────────────────────

/** 一拍的时长：1/256 秒。分母取 2 的幂，定点里是精确值。 */
export const TICK: Fixed = fromRatio(1, 256);

/** 单个子步允许的最大位移：半个球半径。再大就有穿过另一颗球的风险。 */
const MAX_SUBSTEP_TRAVEL: Fixed = mul(BALL_RADIUS, HALF);

/** 子步数上限。40 米/秒（远超实际击球速度）时也只要 16 步。 */
const MAX_SUBSTEPS = 64;

// ───────────────────────── 击球 ─────────────────────────

/** 击球参数。这是**唯一**跨网络传输的东西 —— 状态两端各自演算。 */
export interface StrikeParams {
  /** 瞄准角度，BRAD（16384 等分整圈，见 vec.ts）。 */
  readonly angle: number;
  /** 出杆速度（米/秒）。 */
  readonly power: Fixed;
  /** 击球点横向偏移，单位为球半径。正为右塞。 */
  readonly offsetX: Fixed;
  /** 击球点纵向偏移，单位为球半径。正为高杆。 */
  readonly offsetY: Fixed;
}

/** 出杆速度上限（米/秒）。职业选手的大力开球约 8~9 米/秒。 */
export const MAX_POWER: Fixed = fromInt(10);

/**
 * 击球点偏离球心的上限，单位为球半径。
 *
 * 超过半个半径就会**滑杆**（miscue）—— 皮头抓不住球面。这是真实存在的物理上限，
 * 不是为了平衡瞎定的数：不设的话玩家可以打出 offsetY = 1 的球，那等于从球的
 * 最顶端击打，算出来的自转会大到让球倒着飞。
 */
export const MAX_TIP_OFFSET: Fixed = HALF;

/**
 * 把击球参数折算成初速度与旋转。
 *
 * ## 高低杆
 *
 * 击球点在球心上方 b（单位为半径）时，自转角速度 ω = 5bv/(2R)，折算到接触点
 * 的线速度是 `-（5/2)·b·v` —— 负号是因为上旋让接触点相对球心**向后**滑。
 *
 * 代进 b = 2/5 得到 spin = -v，也就是接触点相对台呢速度为零：**自然滚动**。
 * 这正是教科书里「击打球心上方 2R/5 处球不打滑」的结论，可以用来自检折算是否
 * 写反了（见用例）。
 *
 * ## 侧塞
 *
 * 竖直轴自转 ω_z = 5·b_x·v/(2R)，单独存。它不产生接触点速度 —— 接触点正在
 * 自转轴上，`ω_z ẑ × (-R ẑ) = 0` —— 所以完全不影响球在台面上的直线运动，
 * 只在**碰库**和**撞球**时通过切向摩擦起作用。ball.ts 把它与 spin 分开存，
 * 理由就在这里。
 */
export function strikeVelocity(params: StrikeParams): {
  vel: Vec2;
  spin: Vec2;
  spinZ: Fixed;
} {
  const power = clampMagnitude(params.power, MAX_POWER);
  const { x: offsetX, y: offsetY } = clampTipOffset(
    params.offsetX,
    params.offsetY,
  );

  const dir = bradToDir(params.angle);
  const vel = vScale(dir, power);

  // spin = -(5/2)·b_y·v，沿运动方向。
  const spinScale = neg(mul(fromRatio(5, 2), offsetY));
  const spin = vScale(vel, spinScale);

  // ω_z = 5·b_x·v/(2R)
  const spinZ = div(
    mul(mul(fromInt(5), offsetX), power),
    mul(fromInt(2), BALL_RADIUS),
  );

  return { vel, spin, spinZ };
}

/** 力度取绝对值并封顶。负力度是上游算错了，但不该让整局炸掉。 */
function clampMagnitude(value: Fixed, limit: Fixed): Fixed {
  const magnitude = value < ZERO ? neg(value) : value;
  return magnitude > limit ? limit : magnitude;
}

/**
 * 击球点按**整体长度**封顶，不是逐轴封顶。
 *
 * 逐轴各夹一次的话，(0.5, 0.5) 这个组合会原样通过 —— 而它离球心 0.707 个半径，
 * 早就滑杆了。皮头能不能抓住球面取决于偏离球心的**距离**，与分到哪个轴无关。
 */
function clampTipOffset(x: Fixed, y: Fixed): Vec2 {
  const offset = { x, y };
  const len = vLen(offset);
  if (len <= MAX_TIP_OFFSET) {
    return offset;
  }
  return vScale(vNormalize(offset), MAX_TIP_OFFSET);
}

/** 对母球施加一杆。返回新状态，不改原状态。 */
export function strike(
  state: TableState,
  cueBallId: number,
  params: StrikeParams,
): TableState {
  const { vel, spin, spinZ } = strikeVelocity(params);
  return {
    balls: state.balls.map((b) =>
      b.id === cueBallId && !b.pocketed ? { ...b, vel, spin, spinZ } : b,
    ),
  };
}

// ───────────────────────── 事件 ─────────────────────────

/**
 * 演算过程中发生的事件，按**时间顺序**排列。
 *
 * 规则层要靠它判罚：八球里「母球第一个碰到的是不是自己的球」、斯诺克里
 * 「有没有碰到任何球」都只能从这个序列读出来。渲染层用它触发音效与特效。
 */
export type BilliardsEvent =
  | {
      readonly kind: "ball-hit";
      readonly a: number;
      readonly b: number;
      readonly speed: Fixed;
    }
  | {
      readonly kind: "cushion-hit";
      readonly ball: number;
      readonly cushion: number;
      readonly speed: Fixed;
    }
  | {
      readonly kind: "pocketed";
      readonly ball: number;
      readonly pocket: number;
    };

export interface StepResult {
  readonly state: TableState;
  readonly events: readonly BilliardsEvent[];
}

// ───────────────────────── 摩擦 ─────────────────────────

/**
 * 一拍的摩擦积分。
 *
 * 滑动段与滚动段用**不同的方程**，这是自研解算器的全部理由：
 *
 * - 滑动：摩擦力方向由**接触点**相对速度 u 决定（不是球心速度 v）。球心以 μg
 *   减速，自转以 (5/2)μg 变化，两者都在消解 u。低杆时 u 与 v 反向，于是摩擦力
 *   朝**前**推球心 —— 这就是缩杆。
 * - 滚动：接触点不打滑，只剩很小的滚动阻力，方向沿 v。
 *
 * 止滑的时刻精确处理：若这一拍内 u 会减到零，就按「恰好减到零」折算球心速度，
 * 然后把 spin 钉成 -v（纯滚动的定义）。不这么做的话 u 会**越过**零并反向，
 * 球会开始反向打滑，表现是球快停时莫名抖动。
 */
function applyFriction(ball: Ball, dt: Fixed): Ball {
  if (ball.pocketed) {
    return ball;
  }

  const decayedSpinZ = decaySpinZ(ball.spinZ, dt);
  const motion = motionOf(ball);

  if (motion === "stopped") {
    // 球心与接触点都已静止，只有竖直轴自转还在磨。
    return { ...ball, vel: VEC2_ZERO, spin: VEC2_ZERO, spinZ: decayedSpinZ };
  }

  if (motion === "rolling") {
    // 这里不需要「drop >= speed 就归零」的兜底：滚动的前提是球心速度超过停止
    // 阈值 raw 256，而滚动阻力一拍只削 raw 25，差一个数量级。变异测试把这个
    // 判断改成恒真、恒假都杀不掉（探针实测滚动球的最低速度 261，从没低于 25），
    // 那是死代码，删掉比留着强 —— 留着会让人以为存在「一拍停住」的路径。
    const drop = mul(ROLL_DECEL, dt);
    const dir = vNormalize(ball.vel);
    const vel = vSub(ball.vel, vScale(dir, drop));
    // 滚动的定义就是 u = 0，即 spin = -v。每拍重新钉一次，免得截断误差累积
    // 让球「悄悄」漂回滑动状态。
    return { ...ball, vel, spin: vNeg2(vel), spinZ: decayedSpinZ };
  }

  // —— 滑动段 ——
  const u = contactVelocity(ball);
  const uLen = vLen(u);
  const uDir = vNormalize(u);
  const uDrop = mul(SLIDE_DECEL_U, dt);

  if (uDrop >= uLen) {
    // 这一拍内止滑。u 恰好减到零所需的球心速度变化量 = uLen·(2/7)，
    // 因为 u 的衰减是球心的 7/2 倍。
    const vDrop = mul(uLen, fromRatio(2, 7));
    const vel = vSub(ball.vel, vScale(uDir, vDrop));
    return { ...ball, vel, spin: vNeg2(vel), spinZ: decayedSpinZ };
  }

  const vel = vSub(ball.vel, vScale(uDir, mul(SLIDE_DECEL_V, dt)));
  // 自转的变化率是球心的 5/2 倍，方向相同 —— 两者相加正好是 u 的 7/2 倍。
  const spin = vSub(
    ball.spin,
    vScale(uDir, mul(mul(fromRatio(5, 2), MU_SLIDE), mul(GRAVITY, dt))),
  );
  return { ...ball, vel, spin, spinZ: decayedSpinZ };
}

function vNeg2(v: Vec2): Vec2 {
  return { x: neg(v.x), y: neg(v.y) };
}

/** 竖直轴自转的衰减。到零就停，不许穿过零变成反向自转。 */
function decaySpinZ(spinZ: Fixed, dt: Fixed): Fixed {
  const drop = mul(SPIN_Z_DECAY, dt);
  if (spinZ > ZERO) {
    return drop >= spinZ ? ZERO : sub(spinZ, drop);
  }
  if (spinZ < ZERO) {
    const magnitude = neg(spinZ);
    return drop >= magnitude ? ZERO : add(spinZ, drop);
  }
  return ZERO;
}

// ───────────────────────── 碰撞 ─────────────────────────

/**
 * 处理一对球：先判接触，再分离，最后施加冲量。
 *
 * 三件事写在**同一个函数**里，是因为它们的顺序错不得，而拆开之后调用方几乎必然
 * 会写错顺序 —— 这个文件就犯过：`separate` 与 `collideBalls` 原本是两个函数，由
 * 调用方依次调用，而 `collideBalls` 只判了「是否正在靠近」，**没判是否真的接触**。
 * 于是隔着半张台子相向而行的两球每个子步都互相施加一次冲量。实测一杆开球打出
 * 2777 次撞击、其中 2551 次速度低于 0.05 米/秒，母球在离目标球 0.34 米处就把速度
 * 「隔空」交了出去。
 *
 * 那个判断当时之所以漏掉，是因为看起来 `separate` 已经在做距离检查了 —— 它确实
 * 有 `dist >= diameter` 这一句，但那是**提前返回**，不接触就原样返回两颗球，
 * 对后面的冲量计算没有任何约束力。合并之后不接触是**唯一**的提前返回口，
 * 想绕过它得先把这个函数拆了。
 *
 * ## 为什么分离要在判「是否靠近」之前
 *
 * 分离只在真的重叠时做，且做完**不**重新判距离：分离后两球恰好相切，再判一次
 * `dist >= diameter` 就会把冲量整个跳过。已经重叠但正在分离的一对（碰撞已在上一
 * 个子步处理过）则只分离、不再给冲量 —— 反复施加冲量会让两球**粘在一起**，是最
 * 经典的物理引擎故障现象。
 *
 * ## 冲量
 *
 * 法向走等质量弹性碰撞：速度的法向分量互换（乘恢复系数）。切向是**塞传递**
 * （throw）的来源 —— 两球接触点存在切向相对滑动时，摩擦会把一部分侧塞传给目标球，
 * 目标球于是不完全沿法线走。老球手所谓「吃塞」就是这个。
 *
 * 切向冲量的上限是 |u_t|/7：等质量两球的接触点相对切向速度以 7j_t 的速率被消解
 * （两球线速度各贡献 1、自转各贡献 5/2）。超过这个值就会**反向**滑动，非物理。
 * 实际取的是它与库仑上限 μ·j_n 中的较小者。
 */
function resolvePair(
  a: Ball,
  b: Ball,
): { a: Ball; b: Ball; speed: Fixed | null } {
  const gap = vSub(b.pos, a.pos);
  const dist = vLen(gap);
  if (dist >= BALL_DIAMETER) {
    // 没接触。**这是整个函数唯一的「什么都不做」出口。**
    return { a, b, speed: null };
  }

  if (dist === ZERO) {
    // 完全重合：法线无从定义，沿 +x 推开。摆球出错才会到这个分支，但必须有确定的
    // 行为 —— 否则两端会各自随便挑一个方向，此后整局分叉。
    //
    // 每颗推开一个**半径**（合计一个直径），不是半个半径：推完要恰好不重叠，
    // 而不重叠的门槛是球心距达到直径。曾经写的是半个半径，合计只推开一个半径，
    // 于是这个「恢复」分支根本没恢复 —— 两球下一拍仍然重合，永远卡在这里。
    // 再多推一个最低位，理由与 rackBalls 留余量相同：正好等于直径时，任何一处
    // 截断都会让自检重新判为重叠。
    const push = add(BALL_RADIUS, 1);
    return {
      a: { ...a, pos: { x: sub(a.pos.x, push), y: a.pos.y } },
      b: { ...b, pos: { x: add(b.pos.x, push), y: b.pos.y } },
      speed: null,
    };
  }

  const n = vNormalize(gap);

  // —— 先分离 ——
  // 各推开一半的侵入深度。各一半而不是只推一个，是为了保持左右对称：只推其中
  // 一个的话「a 撞 b」与「b 撞 a」会给出不同结果，而下标顺序是任意的。
  const half = mul(sub(BALL_DIAMETER, dist), HALF);
  const posA = vSub(a.pos, vScale(n, half));
  const posB = vAdd(b.pos, vScale(n, half));

  const relVel = vSub(b.vel, a.vel);
  const vn = vDot(relVel, n);
  if (vn >= ZERO) {
    // 正在分离：只归位，不再给冲量。
    return { a: { ...a, pos: posA }, b: { ...b, pos: posB }, speed: null };
  }

  const jn = neg(mul(mul(add(ONE, RESTITUTION_BALL), vn), HALF));
  let velA = vSub(a.vel, vScale(n, jn));
  let velB = vAdd(b.vel, vScale(n, jn));

  // —— 切向：塞的传递 ——
  const t = vPerp(n);
  // 接触点在两球连线上。竖直轴自转在该点产生的表面速度是 ω_z·R，方向沿切线；
  // a 的接触点在 +R·n 处、b 的在 -R·n 处，于是两者符号相反。
  const surfaceA = add(vDot(a.vel, t), mul(a.spinZ, BALL_RADIUS));
  const surfaceB = sub(vDot(b.vel, t), mul(b.spinZ, BALL_RADIUS));
  const ut = sub(surfaceB, surfaceA);

  const speed = absFixed(vn);
  if (ut !== ZERO) {
    const utMag = absFixed(ut);
    const coulomb = mul(MU_BALL, jn);
    const arrest = div(utMag, fromInt(7));
    const jt = coulomb < arrest ? coulomb : arrest;
    const signed = ut > ZERO ? jt : neg(jt);
    velA = vAdd(velA, vScale(t, signed));
    velB = vSub(velB, vScale(t, signed));
  }

  return {
    a: { ...a, pos: posA, vel: velA },
    b: { ...b, pos: posB, vel: velB },
    speed,
  };
}

/**
 * 球撞库边。
 *
 * 库边是**线段**（见 table.ts），袋口处是断开的 —— 所以这里先求球心到线段的
 * 最近点，只有落在线段范围内才算碰到。写成「四面墙」的话贴库滚向角袋的球会在
 * 袋口那段不存在的墙上弹回来，永远进不了袋。
 *
 * 切向摩擦耦合 spinZ，这是**侧塞吃库拐弯**的来源：右塞的球撞库时接触点相对
 * 库边有切向滑移，摩擦给球一个切向冲量，反弹方向因此偏离镜面反射。没有这一段的
 * 话库边就是理想镜子，塞在碰库时完全失效。
 */
function collideCushion(
  ball: Ball,
  cushionIndex: number,
): { ball: Ball; speed: Fixed } | null {
  const c = CUSHIONS[cushionIndex];
  const closest = closestPointOnSegment(ball.pos, c.a, c.b);
  const away = vSub(ball.pos, closest);
  const dist = vLen(away);
  if (dist >= BALL_RADIUS) {
    return null;
  }

  const n = c.normal;
  const vn = vDot(ball.vel, n);
  if (vn >= ZERO) {
    return null;
  }

  // 先把球推出库边，免得下一拍还判定为碰撞而反复施加冲量。
  //
  // 推出深度按**法向有符号距离**算，不是上面那个无符号的 `dist`。两者在球心还在
  // 库内侧时几乎相同，但球心一旦越过库边线，`away` 会翻向库外，无符号距离重新
  // 变大，`R − dist` 于是**推得不够** —— 实测嵌入 40 毫米的球推完仍在台外，速度
  // 被法向冲量清零，从此永远卡在那里。有符号距离在这种情形下是负的，
  // `R − signed` 自动变成 R + |signed|，一次推到位。
  //
  // 正常演算到不了那么深（单个子步最多走半个半径，每步都查库），所以这段和
  // `resolvePair` 里两球完全重合的分支一样，是**坏状态的恢复路径**：它未必会被
  // 触发，但一旦触发就必须真的恢复，且两端恢复到同一个位置。
  const signedDist = vDot(away, n);
  const penetration = sub(BALL_RADIUS, signedDist);
  const pos = vAdd(ball.pos, vScale(n, penetration));

  const jn = neg(mul(add(ONE, RESTITUTION_CUSHION), vn));
  let vel = vAdd(ball.vel, vScale(n, jn));

  // —— 切向：侧塞让反弹角偏离镜面反射 ——
  const t = vPerp(n);
  // 接触点在 -R·n 处（库在球的外侧），ω_z ẑ × (-R n) = -R·ω_z·t。
  const ut = sub(vDot(ball.vel, t), mul(ball.spinZ, BALL_RADIUS));
  let spinZ = ball.spinZ;
  if (ut !== ZERO) {
    const utMag = absFixed(ut);
    const coulomb = mul(MU_CUSHION, jn);
    // 库固定不动，接触点相对速度以 (7/2)j_t 消解 —— 只有球一侧的线速度与自转
    // 参与，所以是撞球那个 7 的一半。
    const arrest = mul(utMag, fromRatio(2, 7));
    const jt = coulomb < arrest ? coulomb : arrest;
    const signed = ut > ZERO ? jt : neg(jt);
    vel = vSub(vel, vScale(t, signed));
    // 切向冲量同时改变竖直轴自转：Δω_z = 5·j_t/(2R)。
    spinZ = add(spinZ, div(mul(fromRatio(5, 2), signed), BALL_RADIUS));
  }

  return { ball: { ...ball, pos, vel, spinZ }, speed: absFixed(vn) };
}

/** 点到线段的最近点。定点运算，两端逐位一致。 */
function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = vSub(b, a);
  const lenSq = vDot(ab, ab);
  if (lenSq === ZERO) {
    return a;
  }
  let t = div(vDot(vSub(p, a), ab), lenSq);
  if (t < ZERO) {
    t = ZERO;
  } else if (t > ONE) {
    t = ONE;
  }
  return vAdd(a, vScale(ab, t));
}

function absFixed(x: Fixed): Fixed {
  return x < ZERO ? neg(x) : x;
}

// ───────────────────────── 推进 ─────────────────────────

/**
 * 子步数：让单个子步的位移不超过半个球半径。
 *
 * 取 2 的幂，因为 `TICK / n` 必须在定点域里精确 —— TICK 的 raw 是 256，除以
 * 2 的幂仍是整数。取 3 或 5 的话除不尽，两端的截断可能不同，而这是**时间步长**
 * 出现分歧，后果比位置差一位严重得多。
 *
 * 判据写成 `travel > MAX·n` 而不是 `travel/n > MAX`：除法每次都要截断，而这里
 * 换成乘法之后整个判断是精确整数比较。少一次截断，也少一处两端可能分歧的地方。
 */
function substepCount(state: TableState): number {
  let maxSpeed = ZERO;
  for (const ball of state.balls) {
    if (ball.pocketed) {
      continue;
    }
    const speed = vLen(ball.vel);
    if (speed > maxSpeed) {
      maxSpeed = speed;
    }
  }
  const travel = mul(maxSpeed, TICK);
  let n = 1;
  while (n < MAX_SUBSTEPS && travel > mul(MAX_SUBSTEP_TRAVEL, fromInt(n))) {
    n *= 2;
  }
  return n;
}

/**
 * 推进一拍。
 *
 * 顺序是确定性的一部分，不能改：
 *   1. 整拍摩擦（每球一次，按下标序）
 *   2. 子步循环：移动 → 球对（下标升序）→ 库边（数组序）→ 查袋
 *
 * 球对用 i<j 的双重循环，碰撞立即生效并影响后续判定。这是「顺序求解」而非
 * 「同时求解」—— 同时求解在三球同时接触时要解方程组，而顺序求解的结果只取决于
 * 遍历顺序，只要两端顺序相同就一致。台球里三球同时接触极罕见，不值得为它引入
 * 一个更难保证一致的解法。
 */
export function step(state: TableState): StepResult {
  const events: BilliardsEvent[] = [];
  let balls = state.balls.map((b) => applyFriction(b, TICK));

  const n = substepCount({ balls });
  // TICK 的 raw 是 256，n 是 2 的幂，所以这个除法在定点域里是精确的。
  const dt = div(TICK, fromInt(n));

  for (let s = 0; s < n; s += 1) {
    balls = balls.map((b) =>
      b.pocketed ? b : { ...b, pos: vAdd(b.pos, vScale(b.vel, dt)) },
    );

    // —— 球对：下标升序。接触判定、分离、冲量都在 resolvePair 里 ——
    for (let i = 0; i < balls.length; i += 1) {
      if (balls[i].pocketed) {
        continue;
      }
      for (let j = i + 1; j < balls.length; j += 1) {
        if (balls[j].pocketed) {
          continue;
        }
        const resolved = resolvePair(balls[i], balls[j]);
        balls[i] = resolved.a;
        balls[j] = resolved.b;
        if (resolved.speed !== null) {
          events.push({
            kind: "ball-hit",
            a: balls[i].id,
            b: balls[j].id,
            speed: resolved.speed,
          });
        }
      }
    }

    // —— 库边 ——
    for (let i = 0; i < balls.length; i += 1) {
      if (balls[i].pocketed) {
        continue;
      }
      for (let c = 0; c < CUSHIONS.length; c += 1) {
        const hit = collideCushion(balls[i], c);
        if (hit !== null) {
          balls[i] = hit.ball;
          events.push({
            kind: "cushion-hit",
            ball: balls[i].id,
            cushion: c,
            speed: hit.speed,
          });
        }
      }
    }

    // —— 入袋 ——
    for (let i = 0; i < balls.length; i += 1) {
      if (balls[i].pocketed) {
        continue;
      }
      const pocket = pocketAt(balls[i].pos);
      if (pocket !== null) {
        events.push({ kind: "pocketed", ball: balls[i].id, pocket });
        balls[i] = pocketBall(balls[i]);
      }
    }
  }

  return { state: { balls }, events };
}

/** 一杆最多演算多少拍。256 拍 = 1 秒，60 秒足够任何一杆滚完。 */
export const MAX_TICKS = 256 * 60;

/**
 * 一直演算到全部静止。
 *
 * 上限存在是为了兜住「某个系数被改坏导致球永远停不下来」的情况 —— 没有上限
 * 的话表现是整个客户端卡死，有上限至少还能把当前状态交出去。
 */
export function simulate(
  state: TableState,
  maxTicks: number = MAX_TICKS,
): StepResult {
  let current = state;
  const events: BilliardsEvent[] = [];
  for (let i = 0; i < maxTicks; i += 1) {
    if (allStopped(current)) {
      break;
    }
    const result = step(current);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

export interface SimulationTimeline extends StepResult {
  /** Fixed-rate samples used only for client playback. */
  readonly frames: readonly TableState[];
}

/**
 * Run the same authoritative simulation while retaining a compact visual
 * timeline. At four physics ticks per frame the 256 Hz solver produces a
 * smooth 64 fps replay without changing any collision or rules result.
 */
export function simulateWithTimeline(
  state: TableState,
  maxTicks: number = MAX_TICKS,
  sampleEvery = 4,
): SimulationTimeline {
  let current = state;
  const events: BilliardsEvent[] = [];
  const frames: TableState[] = [state];
  for (let i = 0; i < maxTicks; i += 1) {
    if (allStopped(current)) break;
    const result = step(current);
    current = result.state;
    events.push(...result.events);
    if ((i + 1) % sampleEvery === 0) frames.push(current);
  }
  if (frames[frames.length - 1] !== current) frames.push(current);
  return { state: current, events, frames };
}

// ───────────────────────── 摆球 ─────────────────────────

/** 开球点：从底库算起 1/4 台长处。 */
const HEAD_SPOT_X: Fixed = neg(mul(fromRatio(127, 100), HALF));

/** 顶点球位置：从顶库算起 1/4 台长处。 */
const FOOT_SPOT_X: Fixed = mul(fromRatio(127, 100), HALF);

/**
 * 标准三角形摆球（15 颗目标球 + 母球）。
 *
 * 球心间距取直径加一个最低位的余量。余量不是为了「摆得松一点」，而是因为行内
 * 间距与行间距是**两条不同的截断链路**：行内是 `k×gap`，行间是
 * `row×trunc(gap×0.866)`，斜向邻居的球心距由两者的平方和开方得到，必然比 gap
 * 少几个最低位。gap 正好等于直径的话，斜向邻居就是**真实重叠**（实测 3743，
 * 直径 3744），摆球自检当场报错。
 *
 * 这个余量原先的注释说的是「`overlapping` 用严格小于，边界上截断会误判」——
 * 那个说法是错的，而且掩盖了真正的问题：当时 `overlapping` 比较的是直径的
 * **平方**，有 7 个最低位的盲区，斜向那 3743 的真重叠它根本看不见，于是余量
 * 看起来「可有可无」。阈值改回线性域之后，去掉余量会立刻被自检抓住（这正是
 * 变异体 M50 该死的方式）。
 */
export function rackBalls(): TableState {
  const gap = add(BALL_DIAMETER, 1);
  // 行间距 = √3/2 × 球心距。用 fromRatio 而不是 sqrt(3)/2 的浮点近似。
  const rowGap = mul(gap, fromRatio(866, 1000));

  const balls: Ball[] = [
    {
      id: 0,
      pos: { x: HEAD_SPOT_X, y: ZERO },
      vel: VEC2_ZERO,
      spin: VEC2_ZERO,
      spinZ: ZERO,
      pocketed: false,
    },
  ];

  let id = 1;
  for (let row = 0; row < 5; row += 1) {
    const x = add(FOOT_SPOT_X, mul(fromInt(row), rowGap));
    // 每行居中：行内第 k 颗相对行中心的偏移是 (k - row/2)×gap。
    const offset = mul(mul(fromInt(row), gap), HALF);
    for (let k = 0; k <= row; k += 1) {
      const y = sub(mul(fromInt(k), gap), offset);
      balls.push({
        id,
        pos: { x, y },
        vel: VEC2_ZERO,
        spin: VEC2_ZERO,
        spinZ: ZERO,
        pocketed: false,
      });
      id += 1;
    }
  }

  return { balls };
}

/** 母球的下标约定：0 号。规则层与渲染层都依赖它。 */
export const CUE_BALL_ID = 0;

/** 袋数，供规则层校验事件里的袋号。 */
export const POCKET_COUNT = POCKETS.length;
