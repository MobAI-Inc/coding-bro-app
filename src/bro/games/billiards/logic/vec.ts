/**
 * 台球：二维向量与确定性三角函数。
 *
 * 全部运算在 Q16.16 定点域内完成（见 fixed.ts）。这一层存在的理由和定点层一样，
 * 是**跨端逐位一致**。
 *
 * ## 为什么自带三角函数表
 *
 * `Math.sin` / `Math.cos` 在 ECMAScript 规范里是 implementation-approximated ——
 * 规范明确允许各引擎自行取近似。Windows 的 V8、macOS 的 JavaScriptCore、服务端
 * 的 Node 完全可以在最低位上给出不同结果。玩家瞄准的角度经 sin/cos 变成初速度
 * 向量，这是**每一杆的第一步**：这里差一位，后面的碰撞会把它放大成完全不同的
 * 走位。
 *
 * 所以角度不走浮点三角函数，改成查表 + 线性插值。表在模块加载时用定点运算
 * 现场生成（泰勒级数），不写死字面量 —— 写死几百个常量，抄错一个不会有任何
 * 报错，只会让某个角度的球轻微跑偏，而那是最难查的一类 bug。
 *
 * ## 角度单位：BRAD 而不是弧度
 *
 * 角度用 16384 等分整圈（binary radian），不用弧度。理由是取模：弧度制下
 * 「转一圈回到原点」需要对 2π 取模，而 2π 在定点域里除不尽，转几圈就会漂。
 * 16384 是 2 的幂，`angle & (BRAD_FULL - 1)` 是精确的位运算，转多少圈都不漂。
 */

import {
  ONE,
  ZERO,
  add,
  div,
  fromInt,
  fromRatio,
  hypot,
  mul,
  neg,
  square,
  sub,
} from "./fixed";
import type { Fixed } from "./fixed";

/** 二维向量。定点域内，不可与浮点混用。 */
export interface Vec2 {
  readonly x: Fixed;
  readonly y: Fixed;
}

export const VEC2_ZERO: Vec2 = { x: ZERO, y: ZERO };

export function vec2(x: Fixed, y: Fixed): Vec2 {
  return { x, y };
}

export function vAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: add(a.x, b.x), y: add(a.y, b.y) };
}

export function vSub(a: Vec2, b: Vec2): Vec2 {
  return { x: sub(a.x, b.x), y: sub(a.y, b.y) };
}

export function vNeg(a: Vec2): Vec2 {
  return { x: neg(a.x), y: neg(a.y) };
}

/** 向量数乘。`s` 是定点标量。 */
export function vScale(a: Vec2, s: Fixed): Vec2 {
  return { x: mul(a.x, s), y: mul(a.y, s) };
}

export function vDot(a: Vec2, b: Vec2): Fixed {
  return add(mul(a.x, b.x), mul(a.y, b.y));
}

/**
 * 二维叉积（标量）。
 *
 * 判断转向用，碰撞里用来定切向。
 */
export function vCross(a: Vec2, b: Vec2): Fixed {
  return sub(mul(a.x, b.y), mul(a.y, b.x));
}

/**
 * 长度的平方。
 *
 * 碰撞检测里比较距离时**优先用它**：省掉一次开方，更重要的是省掉开方带来的
 * 截断误差。只有真正需要「长度」这个量（求单位向量、算速率）时才用 vLen。
 *
 * 注意它对小量的表现：0.0039 米（raw 256）平方之后就是 raw 1 了。拿它跟一个
 * **小阈值**比较是没有意义的（阈值的分辨率被平方吃光了）—— 那种场合要用 vLen。
 * 它适合的是比较两个同量级的距离，比如「球心距 vs 直径」。
 */
export function vLenSq(a: Vec2): Fixed {
  return add(square(a.x), square(a.y));
}

/**
 * 长度。
 *
 * 走 `hypot` 而不是 `sqrt(vLenSq(a))` —— 后者会先把平方和压回 Q16.16，小量在
 * 那一步就被截断了，开方恢复不回来。详见 fixed.ts 里 `hypot` 的说明：慢速下
 * 单位向量的模长会偏到 1.28 甚至 0，而这正是摩擦力方向的算法。
 */
export function vLen(a: Vec2): Fixed {
  return hypot(a.x, a.y);
}

/**
 * 单位化。
 *
 * 零向量返回零向量而不是抛错 —— 静止的球求方向是**正常**情况（每一帧都会遇到），
 * 不是错误。这里与 fixed.ts 里「异常一律抛错」的取向不同，是刻意的：那边拦的是
 * 「算错了」，这边处理的是「本来就没有方向」。
 */
export function vNormalize(a: Vec2): Vec2 {
  const len = vLen(a);
  if (len === ZERO) {
    return VEC2_ZERO;
  }
  return { x: div(a.x, len), y: div(a.y, len) };
}

/** 垂直向量（逆时针 90°）。碰撞里求切向用，无需三角函数。 */
export function vPerp(a: Vec2): Vec2 {
  return { x: neg(a.y), y: a.x };
}

/** 两点距离的平方。 */
export function vDistSq(a: Vec2, b: Vec2): Fixed {
  return vLenSq(vSub(a, b));
}

export function vEquals(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

// ───────────────────────── 角度与三角函数 ─────────────────────────

/**
 * 整圈的 BRAD 数。必须是 2 的幂 —— 取模靠位运算，这是「转多少圈都不漂」的前提。
 */
export const BRAD_FULL = 16384;
export const BRAD_HALF = BRAD_FULL / 2;
export const BRAD_QUARTER = BRAD_FULL / 4;

/** 查表精度：每 1/4 圈取多少个采样点。2 的幂，便于定位。 */
const TABLE_QUARTER = 1024;
const BRAD_PER_ENTRY = BRAD_QUARTER / TABLE_QUARTER;

/**
 * 把任意角度归一化到 [0, BRAD_FULL)。
 *
 * `& (BRAD_FULL - 1)` 对负数同样正确（JS 位运算按补码处理），且是精确的整数
 * 运算 —— 这正是选 2 的幂等分整圈的原因。
 */
export function normalizeBrad(angle: number): number {
  return angle & (BRAD_FULL - 1);
}

/**
 * π 的定点近似。355/113 误差约 2.7e-7，远小于 Q16.16 的一个最低位。
 *
 * 必须声明在 SIN_TABLE **之前**：建表在模块加载时就跑，而 const 有暂时性死区，
 * 放在后面会直接抛 ReferenceError。
 */
const PI: Fixed = fromRatio(355, 113);

/** BRAD -> 弧度（定点）。仅供建表时使用。 */
function bradToRadians(brad: number): Fixed {
  // brad / BRAD_FULL * 2π。先乘后除，避免中间量被截断到 0。
  return div(mul(fromInt(brad), mul(fromInt(2), PI)), fromInt(BRAD_FULL));
}

/**
 * 泰勒级数求 sin，仅用于建表。
 *
 * x - x³/6 + x⁵/120 - x⁷/5040。定义域限制在 [0, π/2]，此范围内七阶截断误差
 * 约 1e-7，小于 Q16.16 的一个最低位（1.5e-5），因此建出来的表已经是该精度下
 * 能表示的最好结果。
 */
function sinTaylor(x: Fixed): Fixed {
  const x2 = square(x);
  const x3 = mul(x2, x);
  const x5 = mul(x3, x2);
  const x7 = mul(x5, x2);
  let result = x;
  result = sub(result, div(x3, fromInt(6)));
  result = add(result, div(x5, fromInt(120)));
  result = sub(result, div(x7, fromInt(5040)));
  return result;
}

/**
 * 第一象限的 sin 表，含端点，共 TABLE_QUARTER + 1 项。
 *
 * 现场用定点泰勒级数算，不写死字面量：几百个常量抄错一个不会报错，只会让某个
 * 角度的球轻微跑偏。生成过程只用定点四则运算，因此各端得到的表逐位相同。
 */
const SIN_TABLE: readonly Fixed[] = buildSinTable();

function buildSinTable(): Fixed[] {
  const table: Fixed[] = new Array(TABLE_QUARTER + 1);
  for (let i = 0; i <= TABLE_QUARTER; i += 1) {
    table[i] = sinTaylor(bradToRadians(i * BRAD_PER_ENTRY));
  }
  // 只钉死 π/2 这一端：泰勒截断会让它略小于 1，而「垂直击球的速度分量恰好是
  // 满值」是上层断言依赖的性质。
  //
  // 0 那一端**不需要**钉 —— sinTaylor(0) 逐项都是 0，本来就精确返回 0。曾经也
  // 写了 `table[0] = ZERO`，变异测试证明删掉它没有任何用例会红。留着会让人以为
  // 两端都有截断问题，从而不敢碰建表逻辑。
  table[TABLE_QUARTER] = ONE;
  return table;
}

/**
 * 第一象限查表 + 线性插值。输入 [0, BRAD_QUARTER]。
 *
 * 插值让 16384 等分的角度不至于被压缩成 1024 级台阶 —— 台阶会让相邻两个瞄准
 * 角度打出**完全一样**的球，玩家会觉得瞄不准。
 */
function sinQuadrant(brad: number): Fixed {
  const index = Math.floor(brad / BRAD_PER_ENTRY);
  if (index >= TABLE_QUARTER) {
    return SIN_TABLE[TABLE_QUARTER];
  }
  const lo = SIN_TABLE[index];
  const hi = SIN_TABLE[index + 1];
  const remainder = brad - index * BRAD_PER_ENTRY;
  if (remainder === 0) {
    return lo;
  }
  // lo + (hi - lo) * remainder / BRAD_PER_ENTRY
  const t = fromRatio(remainder, BRAD_PER_ENTRY);
  return add(lo, mul(sub(hi, lo), t));
}

/**
 * 正弦。角度单位 BRAD，任意整数（含负数、超过整圈）皆可。
 *
 * 四象限用对称性归约，不额外建表：sin 在各象限之间只差符号与镜像，而镜像是
 * 精确的整数运算，不引入任何新误差。
 */
export function bradSin(angle: number): Fixed {
  const a = normalizeBrad(angle);
  if (a <= BRAD_QUARTER) {
    return sinQuadrant(a);
  }
  if (a <= BRAD_HALF) {
    return sinQuadrant(BRAD_HALF - a);
  }
  if (a <= BRAD_HALF + BRAD_QUARTER) {
    return neg(sinQuadrant(a - BRAD_HALF));
  }
  return neg(sinQuadrant(BRAD_FULL - a));
}

/** 余弦。cos(x) = sin(x + π/2)，不另建表。 */
export function bradCos(angle: number): Fixed {
  return bradSin(angle + BRAD_QUARTER);
}

/**
 * 单位方向向量。
 *
 * 这是瞄准角度进入物理世界的**唯一**入口：击球的初速度方向由它决定。
 */
export function bradToDir(angle: number): Vec2 {
  return { x: bradCos(angle), y: bradSin(angle) };
}
