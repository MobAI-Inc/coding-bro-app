/**
 * 台球：Q16.16 定点数。
 *
 * 这一层是整个台球解算器的地基，而它存在的**唯一**理由是确定性：两端客户端与
 * 服务端各自演算同一杆球，必须逐位相同（TECH-DESIGN.md §6.3）。所以下面的用例
 * 大半不在测「算得对不对」，而在测「算得**一致不一致**」—— 一个把 mul 写成
 * `(a * b) >> 16` 的实现，绝大多数算式都是对的，只在数值大到某个门槛后突然错，
 * 而那时候错的表现是「联机对局不同步」。
 *
 * 三类性质各自守一件事：
 *   - 镜像对称：左右两侧的物理必须完全一样，否则误差是系统性偏向的，不会抵消；
 *   - 中间量精度：大数值下不能被 int32 悄悄截断；
 *   - 越界抛错：宁可炸，也不能让球闪现到桌子另一头还继续算。
 */

import { describe, expect, it } from "vitest";
import {
  FixedOverflowError,
  HALF,
  MAX_FIXED,
  MIN_FIXED,
  ONE,
  ZERO,
  abs,
  add,
  clamp,
  div,
  fromFloat,
  fromInt,
  fromRatio,
  hypot,
  max,
  min,
  mul,
  neg,
  sqrt,
  square,
  sub,
  toFloat,
  toInt,
} from "@/bro/games/billiards/logic/fixed";

describe("billiards/fixed 换算", () => {
  it("整数往返不丢", () => {
    for (const n of [0, 1, -1, 100, -100, 32767, -32768]) {
      expect(toInt(fromInt(n))).toBe(n);
    }
  });

  it("ONE 就是 1.0，HALF 就是 0.5", () => {
    expect(toFloat(ONE)).toBe(1);
    expect(toFloat(HALF)).toBe(0.5);
    expect(fromInt(1)).toBe(ONE);
  });

  it("fromRatio 表示分数，1/3 落在一个最低位以内", () => {
    const third = fromRatio(1, 3);
    expect(Math.abs(toFloat(third) - 1 / 3)).toBeLessThan(1 / ONE);
  });

  it("fromRatio 分母为 0 抛错 —— 悄悄返回 0 会让常量变成 0 而无人察觉", () => {
    expect(() => fromRatio(1, 0)).toThrow("分母为 0");
  });

  it("toInt 向零截断，负数不向下取整", () => {
    expect(toInt(fromFloat(1.7))).toBe(1);
    expect(toInt(fromFloat(-1.7))).toBe(-1);
  });
});

describe("billiards/fixed 镜像对称", () => {
  /**
   * `mul(-a, b) === -mul(a, b)`。
   *
   * 这条性质就是「取整向零截断而不是 floor」的全部理由。floor 向 -∞ 取整，
   * 会让负数那一侧多截掉一个最低位：raw 1 × raw 1 得 0，raw -1 × raw 1 得 -1。
   * 单次误差 1/65536 微不足道，但它**偏向固定方向**，几十次碰撞累积下来不会
   * 互相抵消 —— 表现为向左滚的球比向右滚的球减速快、左库比右库吃球。
   *
   * 用最低位的原始值来测：大数值下截断误差被相对量级淹没，看不出方向性。
   */
  it("乘法对负号可交换 —— 否则左右两侧减速快慢不同", () => {
    const cases: Array<[number, number]> = [
      [1, 1],
      [1, 3],
      [7, 5],
      [12345, 6789],
      [ONE + 1, HALF - 1],
    ];
    for (const [a, b] of cases) {
      expect(mul(-a, b)).toBe(-mul(a, b));
      expect(mul(a, -b)).toBe(-mul(a, b));
      expect(mul(-a, -b)).toBe(mul(a, b));
    }
  });

  it("除法对负号可交换 —— 否则左右库反弹角度不同", () => {
    const cases: Array<[number, number]> = [
      [1, 3],
      [7, 5],
      [ONE, 3],
      [12345, 6789],
    ];
    for (const [a, b] of cases) {
      expect(div(-a, b)).toBe(-div(a, b));
      expect(div(a, -b)).toBe(-div(a, b));
      expect(div(-a, -b)).toBe(div(a, b));
    }
  });

  it("fromFloat 对负号可交换", () => {
    for (const x of [0.1, 1 / 3, 2.5, 1e-4]) {
      expect(fromFloat(-x)).toBe(-fromFloat(x));
    }
  });
});

describe("billiards/fixed 中间量精度", () => {
  /**
   * 这条用例专门盯住 `(a * b) >> FRACTION_BITS` 这个写法。
   *
   * JS 的位运算先把操作数转 int32，所以那个写法会在移位**之前**把中间量截掉。
   * 关键是**中间量**越界，而不是结果越界：`300 × 100` 的结果 30000 稳稳落在
   * Q16.16 的 ±32768 之内，但中间量是 300×65536 × 100×65536 ≈ 2^47，早就超出
   * int32 了。移位版本会给出完全错误的结果（符号都可能反）。
   *
   * 小数值下两种写法结果一致 —— 所以这类 bug 在「1.5 × 2.0」的测试里查不出来，
   * 只在球速较大时突然出现，表现为联机不同步。
   */
  it("中间量超出 int32 时乘法仍精确 —— 位移写法会在这里崩掉", () => {
    expect(toFloat(mul(fromInt(300), fromInt(100)))).toBe(30_000);
    expect(toFloat(mul(fromInt(-300), fromInt(100)))).toBe(-30_000);
    expect(toFloat(mul(fromInt(20000), ONE))).toBe(20000);
    // 32767 × 1.0：中间量 ≈ 2^46，结果贴着上界。
    expect(toFloat(mul(fromInt(32767), ONE))).toBe(32767);
  });

  it("中间量超出 int32 时除法仍精确", () => {
    expect(toFloat(div(fromInt(30000), fromInt(1000)))).toBe(30);
    expect(toFloat(div(fromInt(-30000), fromInt(1000)))).toBe(-30);
    // 被除数乘 ONE 后 ≈ 2^47，同样超 int32。
    expect(toFloat(div(fromInt(32767), fromInt(7)))).toBeCloseTo(32767 / 7, 3);
  });

  it("除法结果可逆：(a/b)*b 回到 a 附近", () => {
    const a = fromInt(12345);
    const b = fromInt(7);
    expect(Math.abs(toFloat(mul(div(a, b), b)) - 12345)).toBeLessThan(0.01);
  });

  it("乘 1 是恒等 —— 缩放系数为 1 时不该有任何漂移", () => {
    for (const raw of [1, 12345, ONE, ONE + 7, MAX_FIXED - 1]) {
      expect(mul(raw, ONE)).toBe(raw);
      expect(div(raw, ONE)).toBe(raw);
    }
  });
});

describe("billiards/fixed 开平方", () => {
  it("完全平方数精确", () => {
    for (const n of [0, 1, 4, 9, 16, 100, 10000]) {
      expect(toFloat(sqrt(fromInt(n)))).toBe(Math.sqrt(n));
    }
  });

  it("非完全平方数落在一个最低位以内", () => {
    for (const n of [2, 3, 5, 7, 50, 1234]) {
      expect(Math.abs(toFloat(sqrt(fromInt(n))) - Math.sqrt(n))).toBeLessThan(1 / 256);
    }
  });

  it("sqrt(square(x)) 回到 x —— 求速度大小走的就是这条路", () => {
    for (const x of [fromInt(3), fromInt(17), fromFloat(2.5), HALF]) {
      expect(Math.abs(toFloat(sqrt(square(x))) - toFloat(x))).toBeLessThan(1 / 256);
    }
  });

  it("负数抛错 —— 返回 0 会让上游的错误漂到球停在奇怪位置才暴露", () => {
    expect(() => sqrt(fromInt(-1))).toThrow("负数");
  });

  it("不依赖 Math.sqrt —— 用「平方回去」自证，不拿浮点实现当基准", () => {
    // 刻意不与 Math.sqrt 比对：真要是某个引擎的 Math.sqrt 有偏差，拿它当基准
    // 就等于把偏差写进期望值。改为验证 r 是「平方不超过 n 的最大定点数」。
    //
    // 上界断言用 >= 而不是 >：square 本身也向零截断，所以一个略大于 √n 的值
    // 平方回来可能**正好**等于 n（n=2 时就是如此）。要求严格大于会把一个正确的
    // 实现判红。
    for (const n of [2, 3, 5, 7, 11, 13, 1234, 10000]) {
      const r = sqrt(fromInt(n));
      expect(toFloat(square(r))).toBeLessThanOrEqual(n);
      expect(toFloat(square(r + 1))).toBeGreaterThanOrEqual(n);
    }
  });
});

describe("billiards/fixed 斜边（hypot）", () => {
  it("勾股数精确", () => {
    expect(toFloat(hypot(fromInt(3), fromInt(4)))).toBe(5);
    expect(toFloat(hypot(fromInt(5), fromInt(12)))).toBe(13);
    expect(toFloat(hypot(fromInt(-3), fromInt(-4)))).toBe(5);
  });

  it("退化成一维时等于绝对值", () => {
    expect(hypot(fromInt(7), ZERO)).toBe(fromInt(7));
    expect(hypot(ZERO, fromInt(-7))).toBe(fromInt(7));
    expect(hypot(ZERO, ZERO)).toBe(ZERO);
  });

  /**
   * **这条是 hypot 存在的全部理由。**
   *
   * 写成 `sqrt(square(x) + square(y))` 时，`square` 的结果要落回 Q16.16，小量在
   * 那一步就被压扁：raw 256 的平方是 raw 1（能表示的最小正数），raw 255 的平方
   * 直接归零。于是 raw 256 到 raw 362 的输入全部映射到同一个 raw 1，开方之后
   * 都返回 256 —— 开方**恢复不了平方时已经丢掉的位**。
   *
   * 这里逐个钉死：一维退化时 hypot 必须原样返回，一个 raw 都不许差。
   */
  it("小量逐位精确 —— 平方再开方的写法在这里会把 257~362 全压成 256", () => {
    for (const raw of [1, 2, 100, 255, 256, 257, 300, 362, 363, 1000]) {
      expect(hypot(raw, ZERO)).toBe(raw);
    }
  });

  it("小量二维也不塌陷 —— 相邻输入必须给出不同的长度", () => {
    // 3:4 方向，长度恰好是 raw 的 5/4 倍，逐个都能分开。
    const lens = [200, 204, 208, 212].map((r) => hypot(Math.round(r * 0.6), Math.round(r * 0.8)));
    expect(new Set(lens).size).toBe(lens.length);
  });

  it("量程远大于 sqrt(vLenSq) —— 后者受限于平方和要落在 Q16.16 内", () => {
    // 181 米/秒是老写法的上限（√32768）。台球用不到，但解算中间量会。
    expect(toFloat(hypot(fromInt(300), fromInt(400)))).toBe(500);
  });

  /**
   * 越过 2^53 之后双精度的加法本身开始丢位，`x*x + y*y` 会**静默地**在不同引擎
   * 上给出不同结果 —— 正是定点层要杜绝的事。所以宁可抛错。
   *
   * 取 2^27+1 是有讲究的：这个量级下平方和确实越过了 2^53（实测精确值与双精度
   * 结果差 2），但开方回来只有 1.9e8，**仍然落在 Q16.16 范围内**。也就是说没有
   * 这道 guard 的话，`checked` 一点意见都不会有，函数会返回一个看着完全正常、
   * 实际上可能跨引擎不一致的数。
   *
   * 拿 MAX_FIXED 测是测不出来的：那个量级开方回来也超出 Q16.16，`checked` 自己
   * 就抛了，两条路径给出同一个错误类型，用例分辨不了 —— 变异测试正是这样发现
   * 这条用例原本是空转的。
   */
  it("平方和超出双精度精确整数范围时抛错，不静默丢位", () => {
    const justOverflowing = 2 ** 27 + 1;
    expect(justOverflowing * justOverflowing * 2).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    // 开方回来仍在 Q16.16 内 —— 所以只有 guard 拦得住它。
    expect(Math.sqrt(justOverflowing * justOverflowing * 2)).toBeLessThan(MAX_FIXED);
    expect(() => hypot(justOverflowing, justOverflowing)).toThrow(FixedOverflowError);
  });
});

describe("billiards/fixed 溢出", () => {
  /**
   * 回绕是**静默**的：`| 0` 之后球会瞬间闪现到桌子另一头，演算照常继续，两端
   * 各自得到不同的错误结果。最后的表现是「对局莫名不同步」，而现场早就没了。
   */
  it("加法越界抛错而不是回绕", () => {
    expect(() => add(MAX_FIXED, ONE)).toThrow(FixedOverflowError);
    expect(() => sub(MIN_FIXED, ONE)).toThrow(FixedOverflowError);
  });

  it("乘法越界抛错", () => {
    expect(() => mul(fromInt(30000), fromInt(30000))).toThrow(FixedOverflowError);
  });

  it("fromInt 越界抛错", () => {
    expect(() => fromInt(40000)).toThrow(FixedOverflowError);
    expect(() => fromInt(-40000)).toThrow(FixedOverflowError);
  });

  it("非有限值抛错 —— NaN 混进物理状态会让整局静默失效", () => {
    expect(() => fromFloat(NaN)).toThrow(FixedOverflowError);
    expect(() => fromFloat(Infinity)).toThrow(FixedOverflowError);
  });

  /**
   * 上一条走的是 fromFloat 自己的入口检查，**到不了** checked() 里那句
   * `!Number.isFinite(value)`。这条专门从算术运算进去。
   *
   * NaN 的所有比较都返回 false —— `NaN > MAX_FIXED` 和 `NaN < MIN_FIXED` 都是
   * false。所以少了 isFinite 这一项，NaN 会被当成合法定点数一路放行，此后它
   * 污染的每一次运算都继续是 NaN，而且不抛任何错。球的坐标变成 NaN 之后画面
   * 上球直接消失，两端各自算各自的，最后表现为「对局不同步」——现场早没了。
   */
  it("NaN 经算术运算传入也抛错 —— 光靠大小比较拦不住它", () => {
    expect(() => add(NaN, ONE)).toThrow(FixedOverflowError);
    expect(() => mul(NaN, ONE)).toThrow(FixedOverflowError);
    expect(() => sub(ONE, NaN)).toThrow(FixedOverflowError);
    expect(() => div(NaN, ONE)).toThrow(FixedOverflowError);
  });

  it("除以 0 抛错", () => {
    expect(() => div(ONE, 0)).toThrow("除以 0");
  });

  it("neg(MIN_FIXED) 抛错 —— int32 下它没有对应的正数", () => {
    expect(() => neg(MIN_FIXED)).toThrow(FixedOverflowError);
    expect(() => abs(MIN_FIXED)).toThrow(FixedOverflowError);
  });
});

describe("billiards/fixed 比较与钳制", () => {
  it("min/max/abs", () => {
    expect(min(fromInt(3), fromInt(5))).toBe(fromInt(3));
    expect(max(fromInt(3), fromInt(5))).toBe(fromInt(5));
    expect(abs(fromInt(-7))).toBe(fromInt(7));
  });

  it("clamp 收进区间", () => {
    const lo = fromInt(-5);
    const hi = fromInt(5);
    expect(clamp(fromInt(10), lo, hi)).toBe(hi);
    expect(clamp(fromInt(-10), lo, hi)).toBe(lo);
    expect(clamp(fromInt(2), lo, hi)).toBe(fromInt(2));
  });

  it("clamp 上下界颠倒抛错 —— 静默返回会得到一个既不在上界也不在下界的值", () => {
    expect(() => clamp(ZERO, fromInt(5), fromInt(-5))).toThrow("颠倒");
  });
});
