/**
 * 台球：球桌几何。
 *
 * 尺寸取 WPA 九英尺球台：打击区 100 × 50 英寸（2.54 × 1.27 米），球直径 2.25
 * 英寸（57.15 毫米）。单位一律用**米**，因为 Q16.16 的精度是 1/65536 —— 用米
 * 表示时约 15 微米，量程 ±32 公里；换成毫米的话球速平方（碰撞里到处都是）会
 * 直接溢出。
 *
 * ## 坐标原点在台面中心
 *
 * 不是放在角上。原点居中意味着左库与右库的坐标互为相反数，「左右两侧物理完全
 * 一样」这件事可以**直接写成断言**（reflect(-x) === -reflect(x)），而不必绕一层
 * 平移。定点层选择向零截断、向量层钉死转向，都是为了同一件事，这里保持一致。
 *
 * ## 库边是**线段**，不是四面墙
 *
 * 最容易写错的地方。把库边写成 `x < -HALF_LENGTH → 反弹` 这样的边界判定，球就
 * 永远进不了袋 —— 贴着库边滚向角袋的球会在袋口那段不存在的墙上弹回来。真实球台
 * 的库边在袋口是**断开**的，所以这里存成 6 条线段：两条长库各被中袋切成两段，
 * 两条短库各一段。袋口的缺口宽度由袋口半径推出，不是另拍一个常数。
 */

import {
  ONE,
  ZERO,
  add,
  fromInt,
  fromRatio,
  mul,
  neg,
  sqrt,
  square,
  sub,
} from "./fixed";
import type { Fixed } from "./fixed";
import { vDistSq, vec2 } from "./vec";
import type { Vec2 } from "./vec";

// ───────────────────────── 尺寸 ─────────────────────────

/**
 * 台面半长、半宽（米）。
 *
 * 半尺寸是**基准量**，全长由它乘 2 得到而不是反过来。原点居中时半尺寸才是真正
 * 出现在坐标里的那个数；反过来定义会让 `TABLE_LENGTH / 2` 多截断一次，长宽与
 * 库边坐标差一个最低位。
 */
export const HALF_LENGTH: Fixed = fromRatio(127, 100);
export const HALF_WIDTH: Fixed = fromRatio(127, 200);

export const TABLE_LENGTH: Fixed = mul(fromInt(2), HALF_LENGTH);
export const TABLE_WIDTH: Fixed = mul(fromInt(2), HALF_WIDTH);

/** 球半径（米）。57.15 毫米直径的一半。 */
export const BALL_RADIUS: Fixed = fromRatio(28575, 1000000);

/**
 * 球直径。两球接触的判定阈值 —— 球心距小于它即重叠。
 *
 * ## 为什么不存直径的平方
 *
 * 这里原本是 `BALL_DIAMETER_SQ = square(2R)`，判定写成 `vLenSq(d) < BALL_DIAMETER_SQ`，
 * 省一次开方。看着是免费的优化，实际上把阈值的分辨率**压掉了 7 个最低位**：
 *
 *   - `square(3744)` = 3744²/65536 = 213.899 → 截断成 **213**；
 *   - 判定要 `trunc(d²/65536) < 213`，即 d² < 213×65536，解出 d ≤ **3736**。
 *
 * 于是球心距 3737~3743 —— 全都是**真实重叠** —— 一律被判为不重叠。而 solver.ts
 * 的 `resolvePair` 判的是 `dist >= 直径`（线性域，3744），同一个谓词两处给出不同
 * 答案：解算器认为两球在碰撞、自检认为它们没挨着。
 *
 * 这是 `motionOf` 犯过、并且已在 ball.ts 的注释里写明的同一类错误（小量平方后
 * 落回 Q16.16 就被压扁，开方恢复不了）。变异测试第二次抓到它：摆球去掉余量后
 * 斜向球心距 3743 是真重叠，而自检看不见，于是「摆球不留余量」这个变异体存活。
 *
 * 结论：阈值存**线性**量，判定走 `vLen`（内部是 `hypot`，在原始整数域求斜边）。
 * 少一次开方省不下什么，丢 7 个最低位却会让两个模块对同一件事各执一词。
 */
export const BALL_DIAMETER: Fixed = mul(fromInt(2), BALL_RADIUS);

// ───────────────────────── 袋口 ─────────────────────────

/** 角袋捕获半径（米）。袋口宽 4.5 英寸，取一半。 */
const CORNER_POCKET_RADIUS: Fixed = fromRatio(5715, 100000);

/** 中袋捕获半径（米）。袋口宽 5 英寸，取一半。 */
const SIDE_POCKET_RADIUS: Fixed = fromRatio(635, 10000);

export interface Pocket {
  readonly center: Vec2;
  /** 球心落进这个半径内即入袋。 */
  readonly radius: Fixed;
}

/**
 * 六个袋口。四角 + 两个中袋。
 *
 * 顺序是布局的一部分：解算器按下标广播入袋事件，重排会让两端对不上号。
 */
export const POCKETS: readonly Pocket[] = [
  {
    center: vec2(neg(HALF_LENGTH), neg(HALF_WIDTH)),
    radius: CORNER_POCKET_RADIUS,
  },
  { center: vec2(neg(HALF_LENGTH), HALF_WIDTH), radius: CORNER_POCKET_RADIUS },
  { center: vec2(HALF_LENGTH, neg(HALF_WIDTH)), radius: CORNER_POCKET_RADIUS },
  { center: vec2(HALF_LENGTH, HALF_WIDTH), radius: CORNER_POCKET_RADIUS },
  { center: vec2(ZERO, neg(HALF_WIDTH)), radius: SIDE_POCKET_RADIUS },
  { center: vec2(ZERO, HALF_WIDTH), radius: SIDE_POCKET_RADIUS },
];

/**
 * 球心落进袋口返回袋号，否则返回 `null`。
 *
 * 比较用距离的**平方**，不开方 —— 省一次截断，而且 vDistSq 与 square 都是精确
 * 到最低位的整数运算，比较结果在任何机器上都一样。
 */
export function pocketAt(pos: Vec2): number | null {
  for (let i = 0; i < POCKETS.length; i += 1) {
    const p = POCKETS[i];
    if (vDistSq(pos, p.center) <= square(p.radius)) {
      return i;
    }
  }
  return null;
}

// ───────────────────────── 库边 ─────────────────────────

export interface Cushion {
  readonly a: Vec2;
  readonly b: Vec2;
  /** 指向台面内侧的单位法线。轴对齐，所以是精确值，不经过单位化。 */
  readonly normal: Vec2;
}

/**
 * 袋口在库边上撕开的缺口半宽。
 *
 * 由袋口半径推出，不另拍常数 —— 两者本来就是同一个袋口的两种度量，各写各的
 * 早晚会对不上：
 *
 *   - 中袋正对着长库，缺口半宽就是袋口半径；
 *   - 角袋的袋口朝 45° 方向，投影到库边上要乘 √2。
 *
 * √2 走定点 `sqrt`，不写 1.41421356 之类的字面量：手抄的常数没人验证，而这里
 * 的 sqrt 本身有用例钉着。
 */
const SIDE_RAIL_GAP: Fixed = SIDE_POCKET_RADIUS;
const CORNER_RAIL_GAP: Fixed = mul(CORNER_POCKET_RADIUS, sqrt(fromInt(2)));

const RAIL_X_MIN: Fixed = add(neg(HALF_LENGTH), CORNER_RAIL_GAP);
const RAIL_X_MAX: Fixed = sub(HALF_LENGTH, CORNER_RAIL_GAP);
const RAIL_Y_MIN: Fixed = add(neg(HALF_WIDTH), CORNER_RAIL_GAP);
const RAIL_Y_MAX: Fixed = sub(HALF_WIDTH, CORNER_RAIL_GAP);

/**
 * 六段库边。
 *
 * 长库（上下）各被中袋切成两段，短库（左右）各一段。段与段之间的缺口就是袋口 ——
 * 球从缺口穿过去就是进袋，不会撞到墙。这是「贴库滚向角袋能进」的全部保证。
 */
export const CUSHIONS: readonly Cushion[] = [
  // 上长库 y = +HALF_WIDTH，法线朝下
  {
    a: vec2(RAIL_X_MIN, HALF_WIDTH),
    b: vec2(neg(SIDE_RAIL_GAP), HALF_WIDTH),
    normal: vec2(ZERO, neg(ONE)),
  },
  {
    a: vec2(SIDE_RAIL_GAP, HALF_WIDTH),
    b: vec2(RAIL_X_MAX, HALF_WIDTH),
    normal: vec2(ZERO, neg(ONE)),
  },
  // 下长库 y = -HALF_WIDTH，法线朝上
  {
    a: vec2(RAIL_X_MIN, neg(HALF_WIDTH)),
    b: vec2(neg(SIDE_RAIL_GAP), neg(HALF_WIDTH)),
    normal: vec2(ZERO, ONE),
  },
  {
    a: vec2(SIDE_RAIL_GAP, neg(HALF_WIDTH)),
    b: vec2(RAIL_X_MAX, neg(HALF_WIDTH)),
    normal: vec2(ZERO, ONE),
  },
  // 左短库 x = -HALF_LENGTH，法线朝右
  {
    a: vec2(neg(HALF_LENGTH), RAIL_Y_MIN),
    b: vec2(neg(HALF_LENGTH), RAIL_Y_MAX),
    normal: vec2(ONE, ZERO),
  },
  // 右短库 x = +HALF_LENGTH，法线朝左
  {
    a: vec2(HALF_LENGTH, RAIL_Y_MIN),
    b: vec2(HALF_LENGTH, RAIL_Y_MAX),
    normal: vec2(neg(ONE), ZERO),
  },
];
