/**
 * 台球：二维向量与确定性三角函数。
 *
 * 和定点层一样，这里大半用例测的是**一致性**而非正确性。三角函数尤其如此 ——
 * 一个直接调 Math.sin 的实现，所有精度断言都会通过（还更准），但它恰恰是整条
 * 链路上最先破坏跨端一致的地方：ECMAScript 规范允许各引擎自取近似。
 *
 * 所以下面刻意包含几条「精度松、性质严」的用例：不要求 sin 有多准，要求它
 * 对称、有界、单调、且不依赖任何浮点库函数。
 */

import { describe, expect, it } from "vitest";
import {
  BRAD_FULL,
  BRAD_HALF,
  BRAD_QUARTER,
  VEC2_ZERO,
  bradCos,
  bradSin,
  bradToDir,
  normalizeBrad,
  vAdd,
  vCross,
  vDistSq,
  vDot,
  vEquals,
  vLen,
  vLenSq,
  vNeg,
  vNormalize,
  vPerp,
  vScale,
  vSub,
  vec2,
} from "@/bro/games/billiards/logic/vec";
import { ONE, ZERO, fromInt, fromRatio, toFloat } from "@/bro/games/billiards/logic/fixed";

/** 定点值转浮点做近似比较。仅测试内使用。 */
const f = toFloat;

/**
 * 把 -0 归一成 +0。
 *
 * `toBe`/`toEqual` 用 Object.is 比较，它把 -0 和 +0 判为不同。而定点域里
 * `mul(-3, 0)` 自然得到 -0 —— 这在物理上与 +0 完全等价（`-0 === 0` 为真，
 * 参与后续运算的结果也逐位相同），只是断言写法上的噪声。
 *
 * 只在**比较零**时用它，非零值的符号仍然严格比较 —— 那才是镜像对称要守的东西。
 */
function nz(x: number): number {
  return x === 0 ? 0 : x;
}

describe("billiards/vec 基本运算", () => {
  it("加减与取负", () => {
    const a = vec2(fromInt(3), fromInt(4));
    const b = vec2(fromInt(1), fromInt(2));
    expect(vAdd(a, b)).toEqual(vec2(fromInt(4), fromInt(6)));
    expect(vSub(a, b)).toEqual(vec2(fromInt(2), fromInt(2)));
    expect(vNeg(a)).toEqual(vec2(fromInt(-3), fromInt(-4)));
  });

  it("数乘", () => {
    const a = vec2(fromInt(3), fromInt(-4));
    expect(vScale(a, fromInt(2))).toEqual(vec2(fromInt(6), fromInt(-8)));
    const zeroed = vScale(a, ZERO);
    expect(nz(zeroed.x)).toBe(0);
    expect(nz(zeroed.y)).toBe(0);
  });

  it("点积与叉积", () => {
    const a = vec2(fromInt(3), fromInt(4));
    const b = vec2(fromInt(2), fromInt(-1));
    expect(f(vDot(a, b))).toBe(2);
    expect(f(vCross(a, b))).toBe(-11);
  });

  it("3-4-5 直角三角形的长度是精确的", () => {
    const a = vec2(fromInt(3), fromInt(4));
    expect(f(vLenSq(a))).toBe(25);
    expect(f(vLen(a))).toBe(5);
  });

  /**
   * 垂直向量与原向量点积为 0 —— 但这**只说明垂直，不说明朝哪一边**。
   *
   * 顺时针和逆时针两个方向的点积都是 0，所以单靠这一条，把 vPerp 的转向写反了
   * 也测不出来（变异测试确认过）。转向不是无所谓的：碰撞里切向的正负决定了旋转
   * 把球往哪一侧带，写反了就是「加右塞的球往左跑」。
   */
  it("垂直向量与原向量点积为 0", () => {
    for (const a of [vec2(fromInt(3), fromInt(4)), vec2(fromInt(-7), fromInt(2))]) {
      expect(vDot(a, vPerp(a))).toBe(ZERO);
    }
  });

  it("vPerp 是**逆时针** 90° —— 顺时针同样满足点积为 0，必须单独钉住转向", () => {
    // +x 轴逆时针转 90° 得到 +y 轴。写成顺时针的话这里会得到 -y。
    // 逐分量比较并归一 -0：neg(0) 天然得到 -0，与 +0 物理等价（见 nz 的说明）。
    const fromX = vPerp(vec2(ONE, ZERO));
    expect(nz(fromX.x)).toBe(0);
    expect(fromX.y).toBe(ONE);

    const fromY = vPerp(vec2(ZERO, ONE));
    expect(fromY.x).toBe(-ONE);
    expect(nz(fromY.y)).toBe(0);

    // 叉积为正也等价于「b 在 a 的逆时针一侧」，两种表述互为佐证。
    const a = vec2(fromInt(3), fromInt(4));
    expect(vCross(a, vPerp(a))).toBeGreaterThan(ZERO);
  });

  it("两点距离平方", () => {
    expect(f(vDistSq(vec2(fromInt(1), fromInt(1)), vec2(fromInt(4), fromInt(5))))).toBe(25);
  });

  it("vEquals 逐分量比较", () => {
    expect(vEquals(vec2(ONE, ZERO), vec2(ONE, ZERO))).toBe(true);
    expect(vEquals(vec2(ONE, ZERO), vec2(ONE, 1))).toBe(false);
  });
});

describe("billiards/vec 单位化", () => {
  it("单位化后长度为 1（一个最低位内）", () => {
    for (const a of [vec2(fromInt(3), fromInt(4)), vec2(fromInt(-5), fromInt(12))]) {
      expect(Math.abs(f(vLen(vNormalize(a))) - 1)).toBeLessThan(1 / 256);
    }
  });

  /**
   * **慢速向量的单位化 —— 这条是花代价换来的。**
   *
   * 上面那条用的是长度 5 和 13 的向量，那个量级什么实现都能过。真正会出事的是
   * 球快停下来的时候：`vLen` 曾经写成 `sqrt(vLenSq(a))`，平方和先落回 Q16.16，
   * 0.0039 米/秒（raw 256）平方之后就是 raw 1 —— 能表示的最小正数。于是长度只能
   * 取 {0, 256, 362, 443, …} 这一串离散值，raw 257 到 raw 362 全都返回 256。
   *
   * 后果落在**摩擦力方向**上，因为它就是 `-u/|u|`：探针实测 0.005 米/秒时单位
   * 向量的模长是 **1.280**，0.004 米/秒时是 **0**。也就是说球快停时摩擦力会凭空
   * 强 28%，再慢一点直接消失。不报错、不发散，只是两端算出来的最后一点走位对不上。
   *
   * 所以这里从 0.004 米/秒（静止阈值附近）一路扫到 0.5，逐个验模长。
   */
  it("慢速向量单位化后模长仍为 1 —— 平方再开方的写法在这里会偏到 1.28 甚至 0", () => {
    let worst = 0;
    for (let raw = 256; raw <= Math.round(0.5 * ONE); raw += 7) {
      // 取 3:4 方向，两个分量都非零，避免退化成一维。
      const a = vec2(Math.round(raw * 0.6), Math.round(raw * 0.8));
      worst = Math.max(worst, Math.abs(f(vLen(vNormalize(a))) - 1));
    }
    // 1/256 ≈ 0.39%。实测最坏 0.31%，平方再开方的写法则是 100%。
    expect(worst).toBeLessThan(1 / 256);
  });

  /**
   * 长度在阈值量级上必须逐 raw 可分。
   *
   * 上一条测的是后果，这条正面钉住原因：慢速下相差一个最低位的两个向量，长度也
   * 必须相差一个最低位。做不到的话任何「速度小于某个小阈值」的判定都是假的 ——
   * 阈值的分辨率被平方吃光了，比较的其实是被量化之后的台阶。
   */
  it("慢速下长度逐位可分 —— 静止判定的阈值靠它才有意义", () => {
    for (const raw of [255, 256, 257, 300, 362, 363]) {
      expect(vLen(vec2(raw, ZERO))).toBe(raw);
    }
  });

  /**
   * 零向量返回零向量，不抛错。
   *
   * 静止的球求方向是每一帧都会遇到的**正常**情况。这里若抛错，第一颗停下来的球
   * 就会把整局炸掉；若返回 NaN，定点层的 isFinite 检查会在下一次运算时抛错，
   * 现场同样已经不在了。
   */
  it("零向量单位化返回零向量 —— 球停下来是正常情况，不是错误", () => {
    expect(vNormalize(VEC2_ZERO)).toEqual(VEC2_ZERO);
  });

  it("单位化保持方向符号 —— 镜像的两个向量单位化后仍镜像", () => {
    const a = vec2(fromInt(3), fromInt(4));
    const mirrored = vec2(fromInt(-3), fromInt(4));
    expect(vNormalize(mirrored).x).toBe(-vNormalize(a).x);
    expect(vNormalize(mirrored).y).toBe(vNormalize(a).y);
  });
});

describe("billiards/vec 角度归一化", () => {
  /**
   * 整圈取 2 的幂的全部理由：位运算取模是精确的，转多少圈都不漂。
   * 弧度制要对 2π 取模，而 2π 在定点域除不尽，几圈之后角度就偏了。
   */
  it("超出整圈与负角度都归到 [0, BRAD_FULL)", () => {
    expect(normalizeBrad(0)).toBe(0);
    expect(normalizeBrad(BRAD_FULL)).toBe(0);
    expect(normalizeBrad(BRAD_FULL + 100)).toBe(100);
    expect(normalizeBrad(-1)).toBe(BRAD_FULL - 1);
    expect(normalizeBrad(-BRAD_FULL)).toBe(0);
  });

  it("转很多圈也不漂 —— 这是选 2 的幂等分整圈的全部理由", () => {
    for (const turns of [1, 7, 100, 1000]) {
      expect(normalizeBrad(BRAD_FULL * turns + 123)).toBe(123);
      expect(normalizeBrad(-BRAD_FULL * turns + 123)).toBe(123);
    }
  });
});

describe("billiards/vec 三角函数", () => {
  it("四个特殊角精确", () => {
    expect(bradSin(0)).toBe(ZERO);
    expect(bradSin(BRAD_QUARTER)).toBe(ONE);
    expect(bradSin(BRAD_HALF)).toBe(ZERO);
    expect(bradSin(BRAD_HALF + BRAD_QUARTER)).toBe(-ONE);

    expect(bradCos(0)).toBe(ONE);
    expect(bradCos(BRAD_QUARTER)).toBe(ZERO);
    expect(bradCos(BRAD_HALF)).toBe(-ONE);
  });

  /**
   * 精度要求刻意放松到 1/256。
   *
   * 这一层要的不是「和 Math.sin 一样准」，而是「每台机器算出来一模一样」。把
   * 阈值收紧到接近 Math.sin 反而是有害的：它会诱使后来的人直接调 Math.sin 来
   * 「优化精度」，那正好破坏了这个模块存在的理由。
   */
  it("与真实 sin 的偏差在 1/256 内 —— 精度够用即可，一致性才是目的", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 97) {
      const expected = Math.sin((brad / BRAD_FULL) * 2 * Math.PI);
      expect(Math.abs(f(bradSin(brad)) - expected)).toBeLessThan(1 / 256);
    }
  });

  it("cos 与真实值一致", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 97) {
      const expected = Math.cos((brad / BRAD_FULL) * 2 * Math.PI);
      expect(Math.abs(f(bradCos(brad)) - expected)).toBeLessThan(1 / 256);
    }
  });

  /**
   * 对称性比精度更要紧。
   *
   * sin(-x) === -sin(x) 若不成立，向左瞄和向右瞄同样的角度会打出不同的球 ——
   * 和定点层取整方向要保证镜像对称是同一件事，而且这个误差是系统性的。
   */
  it("sin 是奇函数 —— 否则左右对称瞄准打出的球不一样", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 61) {
      expect(nz(bradSin(-brad))).toBe(nz(-bradSin(brad)));
    }
  });

  it("cos 是偶函数", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 61) {
      expect(nz(bradCos(-brad))).toBe(nz(bradCos(brad)));
    }
  });

  it("平方和恒为 1（一个最低位内）", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 53) {
      const s = f(bradSin(brad));
      const c = f(bradCos(brad));
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(1 / 128);
    }
  });

  it("值域不越界 —— 越界会让速度分量凭空变大", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 7) {
      expect(bradSin(brad)).toBeGreaterThanOrEqual(-ONE);
      expect(bradSin(brad)).toBeLessThanOrEqual(ONE);
      expect(bradCos(brad)).toBeGreaterThanOrEqual(-ONE);
      expect(bradCos(brad)).toBeLessThanOrEqual(ONE);
    }
  });

  /**
   * 相邻角度必须给出不同的方向。
   *
   * 查表若不做插值，16384 级的角度会被压成 1024 级台阶，相邻 16 个瞄准角打出
   * 完全一样的球 —— 玩家的直接体感是「瞄不准，微调没反应」。
   */
  it("相邻角度方向不同 —— 不插值的话瞄准会有 16 格死区", () => {
    let identical = 0;
    for (let brad = 0; brad < BRAD_QUARTER; brad += 1) {
      if (bradSin(brad) === bradSin(brad + 1)) {
        identical += 1;
      }
    }
    // 定点精度下少量相邻值相同是不可避免的（sin 在 π/2 附近导数趋 0），
    // 但绝不该出现 1024 级台阶那种大面积重复。
    expect(identical).toBeLessThan(BRAD_QUARTER / 4);
  });

  it("第一象限单调不减", () => {
    for (let brad = 0; brad < BRAD_QUARTER; brad += 1) {
      expect(bradSin(brad + 1)).toBeGreaterThanOrEqual(bradSin(brad));
    }
  });

  it("bradToDir 是单位向量", () => {
    for (let brad = 0; brad < BRAD_FULL; brad += 89) {
      expect(Math.abs(f(vLen(bradToDir(brad))) - 1)).toBeLessThan(1 / 128);
    }
  });

  it("bradToDir 的方向与象限相符", () => {
    expect(bradToDir(0)).toEqual(vec2(ONE, ZERO));
    expect(bradToDir(BRAD_QUARTER)).toEqual(vec2(ZERO, ONE));
    expect(f(bradToDir(BRAD_HALF).x)).toBe(-1);
  });

  /**
   * 表在模块加载时用定点运算现场生成，所以「同一角度重复求值必然相同」是
   * 平凡的。真正要防的是有人把表换成写死的字面量后抄错一项 —— 那种错误只在
   * 个别角度上出现，上面的精度用例采样步长较大，可能整个跳过去。
   * 这里对第一象限**逐格**验证单调与有界，抄错一项就会被逮住。
   */
  it("逐格检查第一象限有界 —— 写死字面量抄错一项会在这里暴露", () => {
    for (let brad = 0; brad <= BRAD_QUARTER; brad += 1) {
      const v = bradSin(brad);
      expect(v).toBeGreaterThanOrEqual(ZERO);
      expect(v).toBeLessThanOrEqual(ONE);
    }
  });
});

describe("billiards/vec 反射（库边碰撞的基础）", () => {
  /**
   * 入射角等于反射角，用向量表达是 v' = v - 2(v·n)n。
   *
   * 这里不额外实现 reflect 函数，而是验证组合出来的结果 —— 库边反射在解算器里
   * 就是这么算的，先把它依赖的向量运算钉死。
   */
  it("垂直入射原路返回", () => {
    const v = vec2(ZERO, fromInt(-3));
    const n = vec2(ZERO, ONE);
    const reflected = vSub(v, vScale(n, fromInt(2 * f(vDot(v, n)))));
    expect(f(reflected.y)).toBe(3);
  });

  it("45 度入射反射后水平分量不变、竖直分量反号", () => {
    const v = vec2(fromInt(2), fromInt(-2));
    const n = vec2(ZERO, ONE);
    const dot = vDot(v, n);
    const reflected = vSub(v, vScale(n, fromInt(2 * f(dot))));
    expect(f(reflected.x)).toBe(2);
    expect(f(reflected.y)).toBe(2);
  });

  it("左右镜像的入射给出左右镜像的反射 —— 左库右库必须一样", () => {
    const n = vec2(ZERO, ONE);
    const right = vec2(fromRatio(3, 2), fromInt(-2));
    const left = vec2(fromRatio(-3, 2), fromInt(-2));
    const reflect = (v: typeof right) =>
      vSub(v, vScale(n, fromInt(2 * f(vDot(v, n)))));
    expect(reflect(left).x).toBe(-reflect(right).x);
    expect(reflect(left).y).toBe(reflect(right).y);
  });
});
