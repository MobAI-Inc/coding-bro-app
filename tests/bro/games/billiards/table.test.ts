/**
 * 台球：球桌几何。
 *
 * 这一层没有「算法」，只有一组常量和两个查询函数 —— 但恰恰是这种地方最容易埋
 * 长期不发作的错误：所有用例都绿，球也在桌上滚，只是某个袋永远进不去，或者左
 * 半张桌子的反弹和右半张差一点点。
 *
 * 所以下面的用例大半在测**关系**而不是数值：库边与袋口是否对得上、左右是否
 * 严格镜像、球是不是真的能穿过袋口。数值本身（2.54 米、57.15 毫米）抄错了是
 * 一眼能看出来的，关系错了不会。
 */

import { describe, expect, it } from "vitest";
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUSHIONS,
  HALF_LENGTH,
  HALF_WIDTH,
  POCKETS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  pocketAt,
} from "@/bro/games/billiards/logic/table";
import { vec2 } from "@/bro/games/billiards/logic/vec";
import { ZERO, fromInt, fromRatio, mul, toFloat } from "@/bro/games/billiards/logic/fixed";

const f = toFloat;

describe("billiards/table 尺寸", () => {
  it("九英尺台：打击区 2.54 × 1.27 米", () => {
    expect(f(TABLE_LENGTH)).toBeCloseTo(2.54, 3);
    expect(f(TABLE_WIDTH)).toBeCloseTo(1.27, 3);
    // 长宽比恰好 2:1 是九英尺台的定义，不是巧合。
    expect(f(TABLE_LENGTH) / f(TABLE_WIDTH)).toBeCloseTo(2, 4);
  });

  it("球直径 57.15 毫米", () => {
    expect(f(BALL_RADIUS) * 2000).toBeCloseTo(57.15, 1);
  });

  /**
   * 半尺寸是基准量，全长由它推出。
   *
   * 反过来写（先定全长再除 2）会多截断一次：`TABLE_LENGTH / 2` 与真正出现在
   * 库边坐标里的 HALF_LENGTH 差一个最低位，于是「球心到左库的距离」和「球心到
   * 右库的距离」在台面正中时不相等。误差 15 微米，但它是**固定偏向**的。
   */
  it("半长半宽乘 2 精确等于全长全宽 —— 半尺寸是基准，不是推导量", () => {
    expect(mul(fromInt(2), HALF_LENGTH)).toBe(TABLE_LENGTH);
    expect(mul(fromInt(2), HALF_WIDTH)).toBe(TABLE_WIDTH);
  });

  /**
   * 直径存**线性**量而不是平方，于是它可以被精确断言 —— 平方那版只能容忍
   * 0.5% 的相对误差，而那 0.5% 正是 bug 藏身的地方（见实现注释）。
   */
  it("球直径精确等于半径的两倍 —— 不经过平方，没有截断", () => {
    expect(BALL_DIAMETER).toBe(mul(fromInt(2), BALL_RADIUS));
    expect(BALL_DIAMETER).toBe(BALL_RADIUS * 2);
  });

  /**
   * 回归用例。曾经存的是 `BALL_DIAMETER_SQ = square(2R)`，判定写成
   * `vLenSq(d) < 它`：平方把 raw 3744 压成 **213**，判定实际生效在 3736 上，
   * 球心距 3737~3743 这一整段真实重叠全部漏判。
   *
   * 断言直接钉 raw 值，不走 `toFloat` 近似：只要有人再把它改回平方域，
   * 常量就会掉到 213 量级，这里当场红。
   *
   * 顺带记下 raw 3744 与「理想的 57.15 毫米」差了约 1.1 个最低位 —— 半径
   * 28575/1000000 落进定点时截掉了半位，乘 2 放大成一位。这是定点域的固有
   * 代价，不是错误；重要的是它**确定**，两端算出来一模一样。
   */
  it("直径阈值保留全部低位 —— 平方会把它碾成 213", () => {
    expect(BALL_DIAMETER).toBe(3744);
    // 理想值 0.05715 对应 raw 3745.09，截断后差不超过 2 个最低位。
    expect(Math.abs(BALL_DIAMETER - 0.05715 * 65536)).toBeLessThan(2);
  });
});

describe("billiards/table 袋口", () => {
  it("六个袋：四角 + 两中袋", () => {
    expect(POCKETS).toHaveLength(6);
  });

  /**
   * 逐个写死期望坐标，不按「从 POCKETS 自身推出期望值」的方式测。
   *
   * 我最初写的是 `abs(p.center.x) 约等于 (abs(p.center.x) < 0.01 ? 0 : HALF_LENGTH)`
   * ——期望值由被测值分支出来，读起来像在验证，实际上大半情况自己等于自己。
   * 这类断言最阴险的地方在于它**不是**完全恒真，所以粗看能唬住人。
   */
  it("袋口中心：四角 (±半长, ±半宽) + 两中袋 (0, ±半宽)", () => {
    const expected: Array<[number, number]> = [
      [-f(HALF_LENGTH), -f(HALF_WIDTH)],
      [-f(HALF_LENGTH), f(HALF_WIDTH)],
      [f(HALF_LENGTH), -f(HALF_WIDTH)],
      [f(HALF_LENGTH), f(HALF_WIDTH)],
      [0, -f(HALF_WIDTH)],
      [0, f(HALF_WIDTH)],
    ];
    expect(POCKETS.map((p) => [f(p.center.x), f(p.center.y)])).toEqual(expected);
  });

  /**
   * 袋口半径必须大于球半径。
   *
   * 否则球心永远到不了「距袋心小于袋口半径」的位置 —— 球还没够到判定圈就先撞上
   * 库边了，表现是「打得再准也进不了球」。这条看着像废话，但袋口尺寸一旦被人
   * 按某种规则书改小，就会静默地把整局游戏变成不可能。
   */
  it("袋口半径大于球半径 —— 否则球物理上进不去", () => {
    for (const p of POCKETS) {
      expect(f(p.radius)).toBeGreaterThan(f(BALL_RADIUS));
    }
  });

  it("球心落在袋心即入袋，落在台面中央不入袋", () => {
    for (let i = 0; i < POCKETS.length; i += 1) {
      expect(pocketAt(POCKETS[i].center)).toBe(i);
    }
    expect(pocketAt(vec2(ZERO, ZERO))).toBeNull();
  });

  it("恰好在捕获半径上算入袋，略微超出则不算", () => {
    const p = POCKETS[0];
    // 沿 x 方向偏移一个袋口半径：距离恰好等于半径，判定用 <= 所以算进。
    expect(pocketAt(vec2(p.center.x + p.radius, p.center.y))).toBe(0);
    // 再多偏 1 毫米（远大于一个最低位）就出界了。
    expect(pocketAt(vec2(p.center.x + p.radius + fromRatio(1, 1000), p.center.y))).toBeNull();
  });
});

describe("billiards/table 库边", () => {
  it("六段库边：长库各被中袋切成两段，短库各一段", () => {
    expect(CUSHIONS).toHaveLength(6);
  });

  /**
   * **这是这个文件里最重要的一条用例。**
   *
   * 把库边写成「四面墙」是最自然、也最错的做法：`if (y > HALF_WIDTH) 反弹`。
   * 那样写出来的球台每一条边都完整，于是贴着库边滚向角袋的球会在袋口那段
   * **不存在的墙**上弹回来 —— 球永远进不了袋，而所有关于反弹角度的用例仍然全绿。
   *
   * 真实球台的库边在袋口是断开的。这条用例直接检查这件事：每个袋口周围
   * 不能有任何库边线段经过。
   */
  it("袋口处库边必须断开 —— 写成四面墙的话球会在袋口弹回来", () => {
    for (const pocket of POCKETS) {
      for (const c of CUSHIONS) {
        expect(distancePointToSegment(pocket.center, c.a, c.b))
          .toBeGreaterThanOrEqual(f(pocket.radius) - 1e-6);
      }
    }
  });

  /**
   * 法线朝内。
   *
   * 朝外的话反弹公式 `v - 2(v·n)n` 会把球**推出**台面而不是弹回来。因为公式里
   * n 出现两次（点积一次、数乘一次），符号相消，单看反弹方向是对的 —— 真正出错
   * 的是依赖法线判断「球在库的哪一侧」的那部分，而那部分要等到有球贴库时才发作。
   */
  it("库边法线一律指向台面内侧", () => {
    for (const c of CUSHIONS) {
      // 线段中点沿法线走一小段，必须仍在台面矩形内。
      const midX = (f(c.a.x) + f(c.b.x)) / 2;
      const midY = (f(c.a.y) + f(c.b.y)) / 2;
      const step = 0.01;
      const insideX = midX + f(c.normal.x) * step;
      const insideY = midY + f(c.normal.y) * step;
      expect(Math.abs(insideX)).toBeLessThanOrEqual(f(HALF_LENGTH));
      expect(Math.abs(insideY)).toBeLessThanOrEqual(f(HALF_WIDTH));
    }
  });

  it("法线是轴对齐单位向量 —— 未经单位化，因此逐位精确", () => {
    for (const c of CUSHIONS) {
      const nx = Math.abs(f(c.normal.x));
      const ny = Math.abs(f(c.normal.y));
      expect(nx + ny).toBe(1);
      expect(nx * ny).toBe(0);
    }
  });

  /**
   * 袋口两侧的库边端点间距 = 袋口宽度（2 × 半径）。
   *
   * 上一条只保证库边**没伸进**袋口判定圈，那是个单边约束：库边缩得太多同样满足，
   * 缩得太少也可能刚好压在边界上通过。这条从正面钉住袋口的**实际开口宽度**。
   *
   * 它是角袋缺口那个 √2 的唯一验证者。角袋的袋口朝 45°，缺口沿库边方向的投影
   * 要乘 √2，两端一折算，两个端点的间距恰好回到袋口直径。漏乘 √2 的话缺口只有
   * 0.081 米（袋口直径 0.114），库边的末端**探进了袋口开口里** —— 瞄准角袋的球
   * 会撞在库边尖端上弹开，而不是掉下去。玩家的体感是「明明对准了袋口却打不进」，
   * 而所有关于反弹角度、袋口半径的用例都还是绿的。
   *
   * 变异测试专门验证过：只有这条能杀掉「漏乘 √2」。
   */
  it("袋口两侧库边端点间距等于袋口宽度 —— 角袋那个 √2 折算全靠它钉住", () => {
    for (let i = 0; i < POCKETS.length; i += 1) {
      const p = POCKETS[i];
      const ends = CUSHIONS.flatMap((c) => [c.a, c.b])
        .map((e) => ({ x: f(e.x), y: f(e.y) }))
        .sort(
          (u, v) =>
            Math.hypot(u.x - f(p.center.x), u.y - f(p.center.y)) -
            Math.hypot(v.x - f(p.center.x), v.y - f(p.center.y)),
        );
      const gap = Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y);
      // 容差 1e-4：定点最低位是 1.5e-5，几次乘除累积在此量级内。
      // 漏乘 √2 会差 0.033，隔了两个数量级，不会误判。
      expect(Math.abs(gap - f(p.radius) * 2)).toBeLessThan(1e-4);
    }
  });
});

describe("billiards/table 镜像对称", () => {
  /**
   * 原点居中的全部理由。
   *
   * 左库与右库的坐标互为相反数，于是「左右两侧物理完全一样」可以直接写成断言。
   * 这与定点层选向零截断、向量层钉死转向是同一件事的三个层次 —— 任何一层破坏了
   * 镜像对称，误差都是**系统性偏向**的，几十次碰撞后不会互相抵消。
   */
  it("袋口关于两轴都镜像 —— 每个袋的镜像位置也必须是袋", () => {
    for (const p of POCKETS) {
      expect(pocketAt(vec2(-p.center.x, p.center.y))).not.toBeNull();
      expect(pocketAt(vec2(p.center.x, -p.center.y))).not.toBeNull();
      expect(pocketAt(vec2(-p.center.x, -p.center.y))).not.toBeNull();
    }
  });

  /**
   * 同类袋口半径必须一致：四个角袋一个值，两个中袋另一个值。
   *
   * 我最初写的是「取 x 镜像位置的袋，比较两者半径」。那条对角袋成立，对中袋
   * 却是**自己和自己比** —— 中袋在 x = 0 上，取负号还是它自己（探针打出来是
   * `-0`，pocketAt 找回同一个下标）。于是「上中袋误用角袋半径」这个变异体安然
   * 存活：它确实让两个中袋大小不一致了，而用例拿上中袋跟上中袋比，恒等成立。
   *
   * 换成按**类别**分组断言。中袋不在对称轴以外，镜像推不出约束，只能正面写。
   */
  it("四角袋半径一致、两中袋半径一致 —— 中袋在对称轴上，镜像推不出这条", () => {
    const corners = POCKETS.filter((p) => f(p.center.x) !== 0);
    const sides = POCKETS.filter((p) => f(p.center.x) === 0);
    expect(corners).toHaveLength(4);
    expect(sides).toHaveLength(2);
    expect(new Set(corners.map((p) => p.radius)).size).toBe(1);
    expect(new Set(sides.map((p) => p.radius)).size).toBe(1);
    // 中袋比角袋大：正对着球的来向，开口宽度按规则书就是更大的。
    expect(f(sides[0].radius)).toBeGreaterThan(f(corners[0].radius));
  });

  /**
   * 库边集合关于 x 轴镜像后必须与自身完全重合。
   *
   * 逐段比对而不是只数段数：段数相同但某一段的端点抄错，上面那些用例都发现不了
   * （它仍然贴在边界上、法线仍然朝内、离袋口仍然够远），只有镜像比对能揭出来。
   * 表现会是「上库和下库的有效长度差几毫米」，玩家感觉不到，但两端演算会分叉。
   */
  it("库边集合关于两轴镜像后与自身重合 —— 逐段比对，段数相同挡不住端点抄错", () => {
    const key = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      // 线段无向，端点排序后再做键，免得 a/b 写反被误判成不同段。
      const p = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort();
      return `${p[0]}|${p[1]}`;
    };
    const original = new Set(CUSHIONS.map((c) => key(c.a, c.b)));
    for (const [fx, fy] of [[-1, 1], [1, -1], [-1, -1]] as const) {
      const mirrored = CUSHIONS.map((c) =>
        key({ x: c.a.x * fx, y: c.a.y * fy }, { x: c.b.x * fx, y: c.b.y * fy }),
      );
      expect(new Set(mirrored)).toEqual(original);
    }
  });

  it("原点在台面中心 —— 半尺寸取相反数即得对侧，无需平移", () => {
    // 这就是「原点居中」的可操作定义：镜像 = 取负号。若原点在角上，
    // 左库是 x=0、右库是 x=TABLE_LENGTH，镜像要先减再加，多两次截断。
    expect(f(HALF_LENGTH)).toBeCloseTo(f(TABLE_LENGTH) / 2, 5);
    expect(f(HALF_WIDTH)).toBeCloseTo(f(TABLE_WIDTH) / 2, 5);
    // 台面中心不属于任何袋，也不在任何库边上 —— 开球点就在这附近。
    expect(pocketAt(vec2(ZERO, ZERO))).toBeNull();
  });
});

/** 点到线段的距离（浮点，仅测试内使用）。 */
function distancePointToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const px = f(p.x), py = f(p.y);
  const ax = f(a.x), ay = f(a.y);
  const bx = f(b.x), by = f(b.y);
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
