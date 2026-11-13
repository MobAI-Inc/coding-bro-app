/**
 * 台球：确定性物理解算器。
 *
 * 这一层的用例分两类，混在一起看会误判它们的价值：
 *
 * 1. **物理恒等式**——止滑时刻 = u₀/(3.5μg)、自然滚动点 b = 2R/5、等质量正碰速度
 *    互换。这些有教科书闭式解，是能拿外部权威对答案的部分，写死的期望值不是从
 *    实现里抄来的。
 * 2. **确定性性质**——镜像对称、同输入逐位可复现。这些没有闭式解，但它们是台球
 *    「只传输入不传状态」这个设计成立的前提（TECH-DESIGN.md §6.3）。
 *
 * 只有第一类能证明「物理是对的」，只有第二类能证明「两端不会分叉」。缺任何一类，
 * 剩下那类都会给出虚假的安全感：一个物理全错但完全确定的解算器，两端会一致地
 * 算错；一个物理全对但依赖遍历顺序的解算器，会在联机时随机地对不上。
 */

import { describe, expect, it } from "vitest";
import {
  CUE_BALL_ID,
  MAX_POWER,
  MAX_TICKS,
  MAX_TIP_OFFSET,
  TICK,
  rackBalls,
  simulate,
  step,
  strike,
  strikeVelocity,
} from "@/bro/games/billiards/logic/solver";
import type { BilliardsEvent } from "@/bro/games/billiards/logic/solver";
import {
  allStopped,
  ballsEqual,
  contactVelocity,
  makeBall,
  motionOf,
  overlapping,
  statesEqual,
} from "@/bro/games/billiards/logic/ball";
import type { Ball, TableState } from "@/bro/games/billiards/logic/ball";
import { BRAD_FULL, vLen, vSub, vec2 } from "@/bro/games/billiards/logic/vec";
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
  toFloat as f,
} from "@/bro/games/billiards/logic/fixed";
import type { Fixed } from "@/bro/games/billiards/logic/fixed";
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  HALF_LENGTH,
  HALF_WIDTH,
} from "@/bro/games/billiards/logic/table";

/** 只放指定几颗球的台面。多数用例只关心一两颗球，摆满 16 颗只会掩盖问题。 */
function table(...balls: Ball[]): TableState {
  return { balls };
}

/** 沿 +x 击打，无塞。`offsetY` 为高低杆，单位为球半径。 */
function shoot(state: TableState, power: number, offsetY = 0, offsetX = 0, angle = 0): TableState {
  return strike(state, 0, {
    angle,
    power: fromRatio(Math.round(power * 100), 100),
    offsetX: fromRatio(Math.round(offsetX * 100), 100),
    offsetY: fromRatio(Math.round(offsetY * 100), 100),
  });
}

function degToBrad(deg: number): number {
  return Math.round((deg / 360) * BRAD_FULL);
}

describe("billiards/solver 击球折算", () => {
  /**
   * **这条是折算公式的自检。**
   *
   * 教科书结论：击打球心上方 2R/5 处，球立刻进入自然滚动、完全不打滑。代进
   * ω = 5bv/(2R) 得 b = 2/5 时接触点速度恰为零。所以这个特定的击球点是一个
   * **外部可验证的固定点**——不需要相信实现，只需要相信教科书。
   *
   * 折算若把系数写反（比如 2/5 写成 5/2）或漏掉负号，这里立刻红：那样打出来的
   * 球会在原地疯狂打滑，而不是干净地滚出去。
   */
  it("击打球心上方 2R/5 处立即进入自然滚动 —— 教科书的定点", () => {
    const ball = shoot(table(makeBall(0, vec2(ZERO, ZERO))), 3, 0.4).balls[0];
    expect(motionOf(ball)).toBe("rolling");
    // 接触点速度为零正是「纯滚动」的定义。
    expect(f(vLen(contactVelocity(ball)))).toBeLessThan(0.01);
  });

  it("中杆打滑、低杆倒转 —— 三种杆法给出三种接触点状态", () => {
    const center = shoot(table(makeBall(0, vec2(ZERO, ZERO))), 3, 0).balls[0];
    expect(motionOf(center)).toBe("sliding");
    // 中杆：接触点速度 = 球心速度（自转为零）。
    expect(f(vLen(contactVelocity(center)))).toBeCloseTo(3, 1);

    const draw = shoot(table(makeBall(0, vec2(ZERO, ZERO))), 3, -0.4).balls[0];
    // 低杆：球在倒转，接触点速度比球心速度**还大**，且同向于球心（因为自转是反的）。
    expect(f(vLen(contactVelocity(draw)))).toBeGreaterThan(f(vLen(draw.vel)));
  });

  /**
   * 滑杆（miscue）上限按**整体长度**封，不是逐轴。
   *
   * 逐轴各夹一次的话 (0.5, 0.5) 会原样通过，而它离球心 0.707 个半径——真实球杆
   * 在那里根本抓不住球面。这个用例把「逐轴封顶」这个看起来同样合理的写法钉死。
   */
  it("击球点按整体长度封顶 —— 逐轴封顶会放过 (0.5, 0.5) 这种滑杆球", () => {
    const { spin, spinZ } = strikeVelocity({
      angle: 0,
      power: fromInt(3),
      offsetX: MAX_TIP_OFFSET,
      offsetY: MAX_TIP_OFFSET,
    });
    const clamped = strikeVelocity({
      angle: 0,
      power: fromInt(3),
      offsetX: fromRatio(3536, 10000),
      offsetY: fromRatio(3536, 10000),
    });
    // (0.5,0.5) 会被压回长度 0.5，也就是每轴约 0.3536。
    expect(f(spin.x)).toBeCloseTo(f(clamped.spin.x), 2);
    expect(f(spinZ)).toBeCloseTo(f(clamped.spinZ), 1);
  });

  it("力度封顶且取绝对值 —— 负力度是上游算错，但不该让整局炸掉", () => {
    const over = strikeVelocity({ angle: 0, power: fromInt(50), offsetX: ZERO, offsetY: ZERO });
    expect(f(vLen(over.vel))).toBeCloseTo(f(MAX_POWER), 2);
    const negative = strikeVelocity({ angle: 0, power: fromInt(-3), offsetX: ZERO, offsetY: ZERO });
    // 取绝对值：方向由 angle 决定，不由力度的符号决定。
    expect(f(negative.vel.x)).toBeCloseTo(3, 2);
  });

  it("只有母球被击打，其余球纹丝不动", () => {
    const before = table(makeBall(0, vec2(ZERO, ZERO)), makeBall(1, vec2(fromInt(1), ZERO)));
    const after = shoot(before, 3);
    expect(after.balls[1]).toEqual(before.balls[1]);
  });

  it("已入袋的球打不动 —— 否则规则层的「母球落袋后重新摆放」会打到袋里的球", () => {
    const pocketed: Ball = { ...makeBall(0, vec2(ZERO, ZERO)), pocketed: true };
    const after = strike(table(pocketed), 0, {
      angle: 0,
      power: fromInt(3),
      offsetX: ZERO,
      offsetY: ZERO,
    });
    expect(after.balls[0].vel).toEqual(pocketed.vel);
  });
});

describe("billiards/solver 摩擦与两段运动", () => {
  /**
   * **止滑时刻有闭式解，这是整个摩擦模型唯一能对外部答案的地方。**
   *
   * 接触点速度以 (7/2)μg 衰减（球心 μg + 自转 (5/2)μg），所以从 u₀ 减到零需要
   * t = u₀/(3.5μg)。中杆 3 米/秒、μ=0.2、g=9.8 代入得 0.4373 秒。
   *
   * 同时球心速度只掉 μg·t，剩 3 − 0.2×9.8×0.4373 = 2.143 米/秒——正好是 5/7 的
   * 初速度，这也是台球里那个著名的「中杆撞击后剩 5/7」的来源。
   *
   * 两个数一起钉：只钉时刻的话，把球心衰减也写成 3.5μg 照样能过。
   */
  it("止滑时刻与残余速度同时符合闭式解 —— 7/2 这个系数的唯一硬证据", () => {
    let state = shoot(table(makeBall(0, vec2(ZERO, ZERO))), 3, 0);
    let ticks = 0;
    while (motionOf(state.balls[0]) === "sliding" && ticks < 1000) {
      state = step(state).state;
      ticks += 1;
    }
    const seconds = ticks * f(TICK);
    expect(seconds).toBeCloseTo(3 / (3.5 * 0.2 * 9.8), 2);
    // 球心速度剩 5/7：3 × 5/7 = 2.143。
    expect(f(vLen(state.balls[0].vel))).toBeCloseTo(3 * (5 / 7), 1);
  });

  /**
   * 摩擦每拍只算一次，不随子步细分。
   *
   * 子步是为了「不穿模」而拆的，让摩擦也跟着拆会引入**单向**误差：滚动阻力每拍的
   * 速度增量是 raw 25，拆 16 子步后每步 raw 1.57，定点截断成 1 —— 每步少扣 36%，
   * 而且永远朝同一个方向，几百拍累积下来球会明显多滚一截。
   *
   * 用例的做法：同一个初速度，一次给高速（会拆很多子步）、一次给低速（不拆），
   * 比较「单位时间内的减速量」。若摩擦被子步稀释，高速那次的减速会明显偏小。
   */
  it("摩擦每拍算一次，不被子步稀释 —— 否则快球会少减速且误差单向累积", () => {
    const decelOf = (speed: number) => {
      const before = shoot(table(makeBall(0, vec2(ZERO, ZERO))), speed, 0.4); // 高杆=纯滚动
      const after = step(before).state;
      return f(vLen(before.balls[0].vel)) - f(vLen(after.balls[0].vel));
    };
    // 纯滚动段的减速率与速度无关（μ_r·g·dt），快慢两球每拍掉的速度应当相同。
    const slow = decelOf(0.5); // 一拍走 2mm，不拆子步
    const fast = decelOf(9); // 一拍走 35mm，要拆成多个子步
    expect(fast).toBeCloseTo(slow, 3);
  });

  it("滚动段每拍重新钉 spin = -v —— 截断误差会让球悄悄漂回滑动态", () => {
    let state = shoot(table(makeBall(0, vec2(fromRatio(-100, 100), ZERO))), 2, 0.4);
    for (let i = 0; i < 200; i += 1) {
      state = step(state).state;
      if (motionOf(state.balls[0]) === "stopped") break;
      // 一旦某一拍漂回 sliding，说明 spin 与 vel 不再互为反向。
      expect(motionOf(state.balls[0])).toBe("rolling");
    }
  });

  it("球最终停下 —— 没有阈值的话球会以 1e-9 米/秒永远滚，一杆结束不了", () => {
    const result = simulate(shoot(table(makeBall(0, vec2(fromRatio(-100, 100), ZERO))), 4));
    expect(allStopped(result.state)).toBe(true);
  });

  /**
   * 滑行距离随力度单调增，且贴近理论值。
   *
   * 中杆球先滑后滚，止滑时剩 5/7 初速度，此后按滚动阻力匀减速：
   * d ≈ (5v/7)² / (2μ_r g)。取低速档，让球在撞库前就停住，排除反弹干扰。
   */
  it("滑行距离随力度单调增，且落在理论值附近", () => {
    let previous = -1;
    for (const speed of [0.2, 0.3, 0.4, 0.5, 0.7]) {
      const start = fromRatio(-127, 100);
      const result = simulate(shoot(table(makeBall(0, vec2(start, ZERO))), speed));
      const distance = f(result.state.balls[0].pos.x) - f(start);
      expect(distance).toBeGreaterThan(previous);
      const theory = (speed * (5 / 7)) ** 2 / (2 * 0.01 * 9.8);
      expect(distance).toBeGreaterThan(theory * 0.8);
      expect(distance).toBeLessThan(theory * 1.2);
      previous = distance;
    }
  });

  /**
   * 高低杆决定碰后母球的去向：低杆缩、中杆停、高杆跟。
   *
   * **这是台球之所以要自研解算器的全部理由。** 通用刚体引擎只有一个摩擦系数，
   * 五种杆法会给出同一个结果。这里要求五档严格单调。
   */
  it("五档杆法碰后去向严格单调 —— 通用引擎在这里会给出五个相同的数", () => {
    const finalX = (offsetY: number) => {
      const start = table(makeBall(0, vec2(fromRatio(-40, 100), ZERO)), makeBall(1, vec2(ZERO, ZERO)));
      let state = shoot(start, 3, offsetY);
      for (let i = 0; i < 3000; i += 1) {
        if (allStopped(state) || Math.abs(f(state.balls[1].pos.x)) > 1.2) break;
        state = step(state).state;
      }
      return f(state.balls[0].pos.x);
    };
    const draw = finalX(-0.45);
    const softDraw = finalX(-0.2);
    const center = finalX(0);
    const follow = finalX(0.2);
    expect(draw).toBeLessThan(softDraw);
    expect(softDraw).toBeLessThan(center);
    expect(center).toBeLessThan(follow);
    // 低杆必须真的退到碰撞点后方（碰撞点约 -0.057）。
    expect(draw).toBeLessThan(-0.1);
    // 高杆必须真的跟过碰撞点。
    expect(follow).toBeGreaterThan(0);
  });

  /**
   * 入袋的球整个跳过摩擦，**逐位**不变。
   *
   * 与 ball.ts 里那条「豁免看的是 pocketed 标记而非速度」是同一个论证的两半：
   * 走 `pocketBall` 造出来的球速度本来就是零，摩擦对它做什么都看不出来，于是
   * 「不跳过入袋的球」这个变异体安然存活。这里同样手工构造中间态 —— pocketed
   * 为真、速度自转全都非零。
   *
   * 那个中间态在 `step` 里是真实存在的：入袋检查排在移动与碰撞之后，一颗球
   * 完全可以在同一拍里先被撞出速度、再被判定入袋。下一拍它进 `applyFriction`
   * 时就是这个样子。摩擦若不跳过它，袋里的球会继续「减速」，位置虽然不动，
   * `vel`/`spin` 却一直在变 —— 而位置是渲染落袋动画要用的，速度是规则层判
   * 「这一杆停了没有」要用的，两端演算也会因此分叉。
   *
   * 断言用 `ballsEqual` 逐位比，不挑单个字段：漏掉哪个字段，那个字段的分叉就
   * 查不出来。
   */
  it("入袋的球完全跳过摩擦 —— 逐位不变，不只是位置不变", () => {
    const midStep: Ball = {
      ...makeBall(0, vec2(ZERO, ZERO)),
      pocketed: true,
      vel: vec2(fromInt(3), fromInt(-1)),
      spin: vec2(fromInt(1), fromInt(2)),
      spinZ: fromInt(9),
    };
    const after = step({ balls: [midStep] }).state.balls[0];
    expect(ballsEqual(midStep, after)).toBe(true);
  });

  /**
   * spinZ 衰减到零就停，**不许穿过零变成反向自转**。
   *
   * 衰减量是每拍固定的 raw 2470（探针实测，≈0.0377 弧度/秒），与当前 spinZ 无关。
   * 所以任何一颗带塞的球在磨光的路上**必然**要落进 |spinZ| < 2470 这个窗口 ——
   * 探针实测 spinZ = 50 的球在第 1326 拍剩 raw 1580，第 1327 拍归零。不夹的话它
   * 会变成 −890：球在原地开始朝反方向自转，此后每拍反向增长，下次碰库时塞的
   * 方向整个是反的。
   *
   * 这条**不能**靠打一杆来测。`allStopped` 只看球心速度，球停下时 spinZ 往往还
   * 剩一大截，`simulate` 早就返回了（探针实测返回时 spinZ 仍是 raw 3276800）。
   * 所以直接把球摆在窗口里推一拍。
   *
   * 正负两侧都要测：`decaySpinZ` 是两个独立的分支，只测一侧的话另一侧写错了
   * 照样绿 —— 而「右塞夹得住、左塞穿零」这种半边失效，表现是台面左右不对称，
   * 正是最难从画面上看出来的那类缺陷。
   */
  it("spinZ 衰减到零即停，不穿过零 —— 正负两侧各是一个分支", () => {
    const decayed = (raw: number): number =>
      step({ balls: [{ ...makeBall(0, vec2(ZERO, ZERO)), spinZ: raw }] }).state.balls[0].spinZ;

    // 一拍的衰减量：从一个远大于它的值反推，免得把常数抄进用例。
    const drop = fromInt(1) - decayed(fromInt(1));
    expect(drop).toBeGreaterThan(0);

    // 窗口之内（含边界）：必须**恰好**归零，不能变号。
    for (const raw of [drop, drop - 1, Math.round(drop / 2), 1]) {
      expect(decayed(raw), `spinZ=${raw} 应归零而非变负`).toBe(ZERO);
      expect(decayed(-raw), `spinZ=${-raw} 应归零而非变正`).toBe(ZERO);
    }
    // 窗口之外：正常线性衰减，符号保持不变。
    expect(decayed(drop * 2)).toBe(drop);
    expect(decayed(-drop * 2)).toBe(-drop);
  });
});

describe("billiards/solver 球与球碰撞", () => {
  /**
   * **碰撞只在真正接触时发生。**
   *
   * 这条用例是补一个真实事故的：`collideBalls` 原先只判「是否正在靠近」，
   * 没判「是否碰上了」。于是隔着半张台子相向而行的两球每个子步都互相施加冲量——
   * 母球在离目标球 0.34 米处就把速度隔空交了出去，一杆开球打出 2777 次撞击，
   * 其中 2551 次速度低于 0.05 米/秒。
   *
   * 当时之所以漏掉，是因为旁边的 `separate()` 里有 `dist >= diameter` 这一句，
   * 看起来距离检查已经有人做了；但那是提前返回，对冲量计算没有任何约束力。
   * 现在两者合并成 `resolvePair`，「不接触」是唯一的空操作出口。
   */
  it("碰撞发生在球心距等于直径处，一个 raw 都不许早", () => {
    let state = table(makeBall(0, vec2(fromRatio(-40, 100), ZERO)), makeBall(1, vec2(ZERO, ZERO)));
    state = shoot(state, 3);
    let hitDistance: number | null = null;
    for (let i = 0; i < 3000; i += 1) {
      const result = step(state);
      state = result.state;
      if (result.events.some((e) => e.kind === "ball-hit")) {
        hitDistance = f(vLen(vSub(state.balls[1].pos, state.balls[0].pos)));
        break;
      }
    }
    expect(hitDistance).not.toBeNull();
    // 分离后两球恰好相切，允许一个最低位的余量。
    expect(hitDistance!).toBeCloseTo(2 * f(BALL_RADIUS), 4);
  });

  it("远处相向而行的两球不产生任何事件 —— 隔空传球是真实发生过的故障", () => {
    const state = shoot(
      table(makeBall(0, vec2(fromRatio(-100, 100), ZERO)), makeBall(1, vec2(fromInt(1), ZERO))),
      2,
    );
    // 只推进 10 拍：此时两球还隔着 0.9 米以上。
    let events: readonly BilliardsEvent[] = [];
    let current = state;
    for (let i = 0; i < 10; i += 1) {
      const result = step(current);
      current = result.state;
      events = [...events, ...result.events];
    }
    expect(events).toHaveLength(0);
  });

  /**
   * 等质量正碰：速度基本完全转移，**且母球残余速度有闭式解**。
   *
   * 等质量、恢复系数 e 的正碰，入射球的残余速度占比是 (1−e)/2。e = 0.95 代入
   * 得 0.025，即 2 米/秒打出去母球剩 0.05 米/秒。
   *
   * 这里原先写的是 `target > cue * 10` —— 它在 e = 1.0（完全弹性）时照样成立，
   * 因为那时母球残余是 0，比值无穷大。也就是说恢复系数这个常量根本没人看着：
   * 改成 1.0 一样全绿。换成闭式解之后，e 的任何改动都会被这条抓住。
   */
  it("正碰残余速度符合 (1−e)/2 —— 恢复系数的唯一硬证据", () => {
    let state = table(makeBall(0, vec2(fromRatio(-20, 100), ZERO)), makeBall(1, vec2(ZERO, ZERO)));
    state = shoot(state, 2);
    let impactSpeed = 0;
    for (let i = 0; i < 3000; i += 1) {
      const before = f(vLen(state.balls[0].vel));
      const result = step(state);
      state = result.state;
      if (result.events.some((e) => e.kind === "ball-hit")) {
        impactSpeed = before;
        break;
      }
    }
    const cue = f(vLen(state.balls[0].vel));
    const target = f(vLen(state.balls[1].vel));

    // 母球残余占入射速度的 (1−0.95)/2 = 2.5%。
    expect(cue / impactSpeed).toBeCloseTo((1 - 0.95) / 2, 3);
    // 目标球拿到 (1+e)/2 = 97.5%。
    expect(target / impactSpeed).toBeCloseTo((1 + 0.95) / 2, 2);
  });


  /**
   * **塞的传递（throw）。整个切向冲量块原本一条用例都没有。**
   *
   * 老球手说的「吃塞」：母球带侧塞撞目标球时，两球接触点存在切向相对滑动，
   * 摩擦把一部分塞传过去，目标球于是**不沿两球连线走**。这是台球区别于弹珠
   * 的核心手感之一 —— 没有它，加不加塞打出来的球路一模一样。
   *
   * 用薄球（切球）测：母球从目标球下方 1.5R 处切上去，量目标球的出射角。
   *
   * **不能拿「无塞」当作「沿连线走」的基准** —— 我第一版就是这么写的，然后
   * 断言出射角落在 [5°, 40°]，实测 53.5° 当场红。探针打出来的真相是：碰撞瞬间
   * 两球连线是 47.590°，而无塞的出射角是 53.518°，**差了 5.928°**。这 5.9° 不是
   * 误差，是切球本身的接触点切向滑移带来的塞（自然塞 / collision-induced throw），
   * 真实球台上同样存在。所以基准必须现场量连线角，不能凭直觉给区间。
   *
   * 断言写成「偏离连线的量」而不是绝对角度：连线角依赖摆位与碰撞时刻，改一处
   * 摆位期望值就得重抄；偏离量才是切向冲量真正决定的东西。
   */
  it("侧塞会改变目标球出射角 —— 没有切向冲量的话加不加塞球路一样", () => {
    /** 薄球：返回 [碰撞瞬间的两球连线角, 目标球出射角]，单位度。 */
    const throwAngle = (offsetX: number): { line: number; exit: number } => {
      const cueY = -1.5 * f(BALL_RADIUS); // 偏离球心，构成切球
      let state = table(
        makeBall(0, vec2(fromRatio(-20, 100), fromRatio(Math.round(cueY * 100000), 100000))),
        makeBall(1, vec2(ZERO, ZERO)),
      );
      state = shoot(state, 3, 0, offsetX);
      let before = state;
      for (let i = 0; i < 3000; i += 1) {
        before = state;
        const result = step(state);
        state = result.state;
        if (result.events.some((e) => e.kind === "ball-hit")) break;
      }
      const d = vSub(before.balls[1].pos, before.balls[0].pos);
      const v = state.balls[1].vel;
      return {
        line: (Math.atan2(f(d.y), f(d.x)) * 180) / Math.PI,
        exit: (Math.atan2(f(v.y), f(v.x)) * 180) / Math.PI,
      };
    };

    const none = throwAngle(0);
    const right = throwAngle(0.4);

    // 连线角与塞无关 —— 碰撞在同一位置发生，塞只改变碰后的速度方向。
    expect(right.line).toBeCloseTo(none.line, 6);
    // 无塞也有塞：切球的接触点本来就在滑，摩擦给出约 6° 的自然塞。
    expect(none.exit - none.line).toBeGreaterThan(3);
    // 右塞在自然塞之上再加一截。切向摩擦归零的话两者会完全相同。
    expect(right.exit - none.exit).toBeGreaterThan(3);
  });

  /**
   * 切向冲量取 `min(库仑上限 μ·j_n, 止滑上限 |u_t|/7)`，两个上限都必须真的生效。
   *
   * 止滑上限的物理含义：等质量两球的接触点切向相对速度以 7·j_t 的速率被消解
   * （两球线速度各贡献 1、自转各贡献 5/2）。冲量超过它，接触点会**反向**滑动 ——
   * 摩擦把相对滑动推过零点又往回推，非物理。
   *
   * 用**正碰**测，不用切球。这是这条用例能写成的全部原因：两球都在 x 轴上时法线
   * 精确是 (1,0)、切线精确是 (0,1)，目标球碰后的 v_y **就是** j_t 本身，不含任何
   * 需要投影分离的分量。我第一版拿切球测，把目标球的整个切向速度当成 j_t —— 那里
   * 面还混着法向冲量的投影，量出来 0.783 对上限 0.701，红得毫无意义。
   *
   * 扫一串 spinZ 跨过两个上限的交点（探针实测在 |ω_z| ≈ 28 处）：小塞侧止滑上限
   * 生效、大塞侧库仑上限生效。少了任何一边，`min` 都可以被改成单取一项而不被发现。
   */
  it("切向冲量取 min(库仑, |u_t|/7) —— 两个上限各管一段，都得生效", () => {
    /** 正碰：母球沿 +x 撞静止的目标球，返回 j_t（= 目标球碰后的 v_y）与两个上限。 */
    const headOn = (spinZ: number) => {
      let state = table(
        makeBall(0, vec2(ZERO, ZERO)),
        makeBall(1, vec2(BALL_DIAMETER + 200, ZERO)),
      );
      state = shoot(state, 2);
      state = {
        balls: state.balls.map((b) => (b.id === 0 ? { ...b, spinZ: fromInt(spinZ) } : b)),
      };
      let before = state;
      for (let i = 0; i < 3000; i += 1) {
        before = state;
        const result = step(state);
        state = result.state;
        if (result.events.some((e) => e.kind === "ball-hit")) break;
      }
      // 法线精确是 (1,0)：两球始终在 x 轴上，碰撞不改变这一点。
      expect(f(before.balls[0].pos.y)).toBe(0);
      expect(f(before.balls[1].pos.y)).toBe(0);

      const vn = f(before.balls[0].vel.x) - f(before.balls[1].vel.x);
      const jn = (1 + 0.95) / 2 * Math.abs(vn);
      // 目标球静止，接触点切向相对速度全部来自母球的 spinZ。
      const ut = Math.abs(f(before.balls[0].spinZ) * f(BALL_RADIUS));
      return {
        jt: Math.abs(f(state.balls[1].vel.y)),
        coulomb: 0.06 * jn,
        arrest: ut / 7,
      };
    };

    // 小塞：|u_t|/7 比库仑上限小，止滑上限生效。
    for (const spin of [5, 10, 20]) {
      const r = headOn(spin);
      expect(r.arrest, `spinZ=${spin} 应落在止滑上限一侧`).toBeLessThan(r.coulomb);
      expect(r.jt).toBeCloseTo(r.arrest, 2);
    }

    // 大塞：库仑上限封顶，j_t 不再随塞增长。去掉 min 的话它会一路涨上去。
    const big = headOn(40);
    const huge = headOn(80);
    expect(big.arrest).toBeGreaterThan(big.coulomb);
    expect(big.jt).toBeCloseTo(big.coulomb, 2);
    expect(huge.jt).toBeCloseTo(big.jt, 4);
  });

  /**
   * 两球接触点的 spinZ 表面速度**符号相反**。
   *
   * 接触点在两球连线上：a 的接触点在 +R·n 处、b 的在 −R·n 处。同一个方向的竖直轴
   * 自转在这两处产生的切向表面速度是反向的，于是切向相对速度
   * `u_t = −(ω_a + ω_b)·R` —— 同向自转的两球**相加**。写成同号则变成 `(ω_b − ω_a)·R`，
   * 同向相消、反向相加，整个反过来。
   *
   * 用**正碰**测。原先这条写的是切球加预置自转、断言「出射角差超过 1°」——
   * 那是个方向不明的量级断言：变异体把叠加改成相消之后角度照样会变，只是变成
   * 另一个值，1° 的门槛拦不住。正碰时法线精确是 (1,0)、切线精确是 (0,1)，目标球
   * 碰后的 v_y 就是 j_t 本身，可以直接钉**倍数关系**：
   *
   *   - 同向等量（5, 5）应当恰好是单边（0, 5）的两倍；
   *   - 反向等量（5, −5）应当**精确为零** —— u_t 完全抵消，切向冲量整块不执行。
   *
   * 变异体把这两条对调：它会让 (5,5) 归零、(5,−5) 翻倍。两条都写上，任何一条
   * 单独存在都可能被另一种改法绕过。
   *
   * 自转取 5：探针实测库仑上限在 |ω_z| ≈ 28 处才封顶，这里远在止滑上限一侧，
   * j_t 与 u_t 严格成正比，倍数关系才成立。取 40 的话两边都顶到库仑上限，
   * 叠加与相消给出同一个数（实测 0.11655），用例反而失效。
   */
  it("两球接触点的自转表面速度符号相反 —— 同向相加、反向抵消，正碰下可钉倍数", () => {
    /** 正碰：母球沿 +x 撞静止的目标球，两球各带 spinZ。返回目标球碰后的 v_y。 */
    const headOnSpins = (spinA: number, spinB: number): number => {
      let state = table(
        { ...makeBall(0, vec2(ZERO, ZERO)), vel: vec2(fromInt(2), ZERO), spinZ: fromInt(spinA) },
        { ...makeBall(1, vec2(BALL_DIAMETER + 200, ZERO)), spinZ: fromInt(spinB) },
      );
      for (let i = 0; i < 200; i += 1) {
        const result = step(state);
        state = result.state;
        if (result.events.some((e) => e.kind === "ball-hit")) break;
      }
      return f(state.balls[1].vel.y);
    };

    const single = headOnSpins(0, 5);
    // 先确认单边确实有塞传过去 —— 否则下面的倍数关系在「切向冲量整块失效」时
    // 会退化成 0 = 2×0，恒真。
    expect(Math.abs(single)).toBeGreaterThan(0.01);

    // 哪一颗球带塞不影响大小：两个接触点对称。
    expect(headOnSpins(5, 0)).toBeCloseTo(single, 6);
    // 同向：相加，恰好翻倍。变异体在这里给出 0。
    expect(headOnSpins(5, 5)).toBeCloseTo(2 * single, 3);
    // 反向：完全抵消，u_t === 0，切向冲量整块跳过。变异体在这里给出翻倍。
    expect(headOnSpins(5, -5)).toBe(0);
  });

  it("撞击事件带着法向相对速度 —— 渲染层靠它决定音量，规则层靠它判力度", () => {
    let state = shoot(
      table(makeBall(0, vec2(fromRatio(-20, 100), ZERO)), makeBall(1, vec2(ZERO, ZERO))),
      3,
    );
    let hit: BilliardsEvent | undefined;
    for (let i = 0; i < 3000 && !hit; i += 1) {
      const result = step(state);
      state = result.state;
      hit = result.events.find((e) => e.kind === "ball-hit");
    }
    expect(hit).toBeDefined();
    expect(hit).toMatchObject({ kind: "ball-hit", a: 0, b: 1 });
    // 撞击时速度已被摩擦削掉一些，但仍在 2~3 之间。
    expect(f((hit as { speed: number }).speed)).toBeGreaterThan(2);
  });

  it("静止的两球贴在一起不会自发弹开 —— 粘连与自发分离是同一个判断的两面", () => {
    const diameter = 2 * f(BALL_RADIUS);
    const state = table(
      makeBall(0, vec2(ZERO, ZERO)),
      makeBall(1, vec2(fromRatio(Math.round(diameter * 100000), 100000), ZERO)),
    );
    const result = simulate(state);
    expect(result.events).toHaveLength(0);
    expect(statesEqual(result.state, state)).toBe(true);
  });

  it("重合的两球被推开而不是卡死 —— 摆球出错时也必须有确定的行为", () => {
    const state = table(makeBall(0, vec2(ZERO, ZERO)), makeBall(1, vec2(ZERO, ZERO)));
    const after = step(state).state;
    expect(overlapping(after.balls[0], after.balls[1])).toBe(false);
    // 沿 +x 对称推开：a 往左、b 往右。
    expect(f(after.balls[0].pos.x)).toBeLessThan(0);
    expect(f(after.balls[1].pos.x)).toBeGreaterThan(0);
  });

  /**
   * 分离时**各推开一半**，两球连线的中点逐位不变。
   *
   * 下标顺序是任意的：谁是 a、谁是 b 取决于摆球时的编号，与物理无关。只推其中
   * 一颗的话「0 号撞 1 号」与「1 号撞 0 号」会给出不同结果，而两端如果对同一次
   * 接触取了不同的遍历顺序（三球连环接触时完全可能），位置就此分叉。
   *
   * **不能拿镜像对称来测这件事** —— 我第一版就是这么写的。探针实测「只推 b」这个
   * 变异体给出的结果照样是完美镜像的（a.x=−50 b.x=3694 对 a.x=50 b.x=−3694），
   * 因为把整个场景镜像过去时，那个偏心的推法也跟着镜像了。镜像对称守的是定点
   * 取整方向，守不住左右均分。
   *
   * 真正被破坏的是**中点守恒**：各推一半时 posA + posB 恒等于原来的和，推一颗则
   * 整体平移半个侵入深度。所以断言直接钉 raw 和，不走 `toFloat`。
   *
   * 用静止的两球，把冲量摘出去：分离与冲量是同一个函数里的两件事，带速度的话
   * 位置变化里混着这一拍的位移，中点不再守恒。
   */
  it("分离各推一半 —— 中点逐位守恒，镜像对称测不出这条", () => {
    for (const shrink of [100, 500, 1000]) {
      const before = table(
        makeBall(0, vec2(ZERO, ZERO)),
        makeBall(1, vec2(BALL_DIAMETER - shrink, ZERO)),
      );
      const after = step(before).state;
      // 确实分开了 —— 否则「什么都不做」也能让中点守恒。
      expect(overlapping(after.balls[0], after.balls[1]), `重叠 ${shrink} raw 应被分开`).toBe(false);
      // 中点守恒：两球位置之和逐位不变。只推一颗的话这里会差半个侵入深度。
      expect(
        (after.balls[0].pos.x as number) + (after.balls[1].pos.x as number),
        `重叠 ${shrink} raw 时中点不该平移`,
      ).toBe((before.balls[0].pos.x as number) + (before.balls[1].pos.x as number));
      // 各推一半：两球移动的距离相等、方向相反。
      const moveA = (after.balls[0].pos.x as number) - (before.balls[0].pos.x as number);
      const moveB = (after.balls[1].pos.x as number) - (before.balls[1].pos.x as number);
      expect(moveA).toBe(-moveB);
      expect(moveA).toBeLessThan(0);
    }
  });

  /**
   * 已经重叠、但**正在分开**的一对只归位，不再给冲量。
   *
   * 碰撞在某个子步里处理过之后，两球下一拍往往仍然重叠（分离只推到恰好相切，
   * 而它们正带着速度往外走）。这时若再施加一次冲量，法向相对速度 vn 是正的，
   * 冲量 j_n = −(1+e)·vn/2 于是变成**负数**，两球被反向拽回去 —— 手算：vn = 2 的
   * 一对会变成 −1.9，撞开又吸回、吸回又撞开。这就是物理引擎最经典的「两球粘在
   * 一起抖」，而它在台球里表现为一堆速度极低的假撞击事件。
   *
   * 这个状态**不是**理论上的边角情况：探针在一杆正常开球里数到 46 对次「重叠且
   * 正在分离」（对照「重叠且正在靠近」只有 3 对次）。绝大多数重叠帧都是这一种。
   *
   * 两段一起断言：
   *   - 手工构造的一对：vn 必须保持为正且几乎不变（只被摩擦削），且**不产生事件**；
   *   - 真实碰撞之后连续几拍：不能冒出第二次撞击事件。后者证明前者不是空想的
   *     构造，前者给出精确的数值判据 —— 只有真实碰撞那半边的话，「吸回去」发生在
   *     几拍之后，事件数照样可能是 1。
   */
  it("重叠但正在分开的一对只归位不再给冲量 —— 反复施加冲量会让两球粘在一起", () => {
    for (const shrink of [100, 500, 1000]) {
      const before = table(
        { ...makeBall(0, vec2(ZERO, ZERO)), vel: vec2(neg(fromInt(1)), ZERO) },
        { ...makeBall(1, vec2(BALL_DIAMETER - shrink, ZERO)), vel: vec2(fromInt(1), ZERO) },
      );
      const result = step(before);
      const [a, b] = result.state.balls;

      // 分离速度保持为正 —— 再给一次冲量的话它会翻成 −1.9。
      const vn = f(b.vel.x) - f(a.vel.x);
      expect(vn, `重叠 ${shrink} raw 且正在分离时不该被拽回`).toBeGreaterThan(1.9);
      // 只被摩擦削掉一点点（探针实测 2.0000 → 1.9847）。
      expect(vn).toBeCloseTo(2, 1);
      // 不是碰撞，不该有事件 —— 规则层靠事件判「母球先碰到谁」，多一次就判错。
      expect(result.events, `重叠 ${shrink} raw 且正在分离不是一次撞击`).toHaveLength(0);
    }

    // 真实碰撞之后连续跟几拍：只能有那一次撞击。
    let state = shoot(
      table(makeBall(0, vec2(fromRatio(-20, 100), ZERO)), makeBall(1, vec2(ZERO, ZERO))),
      2,
    );
    let hits = 0;
    for (let i = 0; i < 400; i += 1) {
      const result = step(state);
      state = result.state;
      hits += result.events.filter((e) => e.kind === "ball-hit").length;
    }
    expect(hits, "一次正碰只该产生一次撞击事件").toBe(1);
  });

  it("入袋的球不参与碰撞 —— 否则袋里的球会挡住台面上的球", () => {
    const sunk: Ball = { ...makeBall(1, vec2(ZERO, ZERO)), pocketed: true };
    let state = shoot(table(makeBall(0, vec2(fromRatio(-20, 100), ZERO)), sunk), 2);
    for (let i = 0; i < 200; i += 1) {
      const result = step(state);
      state = result.state;
      expect(result.events.filter((e) => e.kind === "ball-hit")).toHaveLength(0);
    }
    // 母球径直穿过去了。
    expect(f(state.balls[0].pos.x)).toBeGreaterThan(0);
  });
});

describe("billiards/solver 库边", () => {
  /**
   * 碰库反弹角**不是**镜面反射，而且不该是。
   *
   * 这条用例最初写的是「入射角 = 反射角」，红了：30° 打进去，出来是 28.5°。
   * 手算一遍冲量链才确认是**用例错了**，实现是对的：
   *
   *   法向：vn = -0.5v，j_n = (1+0.75)×0.5v = 0.875v，于是 v_y = 0.5v - 0.875v = -0.375v
   *   切向：u_t = 0.866v，库仑上限 μ·j_n = 0.175v，制动上限 (2/7)|u_t| = 0.247v，
   *         取小者 0.175v，于是 v_x = 0.866v - 0.175v = 0.691v
   *   出射角 = atan2(-0.375, 0.691) = -28.5°
   *
   * 镜面反射只在「恢复系数 = 1 且库边无摩擦」时成立，而真实库边两者都不满足：
   * 恢复系数 0.75 压扁法向分量、切向摩擦拖慢切向分量，两者叠加使出射角比入射角
   * **平**一些。台球手所谓「库吃角度」就是这个。
   *
   * 所以断言写成两条不变量：y 分量必须反向（这是「弹回来了」的定义），且出射角
   * 落在手算值附近。写死 -28.5 而不是 -30，是因为前者有推导、后者只有直觉。
   */
  it("碰库反弹角符合冲量链手算值 —— 镜面反射是错的期望", () => {
    // deg: 入射角；expected: 上述冲量链手算出的出射角。
    for (const [deg, expected] of [[30, -28.5], [45, -46.4], [60, -61.2]]) {
      let state = strike(table(makeBall(0, vec2(ZERO, ZERO))), 0, {
        angle: degToBrad(deg),
        power: fromInt(2),
        offsetX: ZERO,
        offsetY: ZERO,
      });
      let bounced = false;
      for (let i = 0; i < 5000 && !bounced; i += 1) {
        const result = step(state);
        state = result.state;
        bounced = result.events.some((e) => e.kind === "cushion-hit");
      }
      expect(bounced).toBe(true);
      // 撞的是长库（法线沿 y）：y 分量必须反向，x 分量必须保号。
      expect(f(state.balls[0].vel.y)).toBeLessThan(0);
      expect(f(state.balls[0].vel.x)).toBeGreaterThan(0);
      const out = (Math.atan2(f(state.balls[0].vel.y), f(state.balls[0].vel.x)) * 180) / Math.PI;
      expect(out).toBeCloseTo(expected, 0);
    }
  });

  /**
   * **侧塞让反弹角偏离镜面反射。**
   *
   * 没有这一段的话库边就是理想镜子，塞在碰库时完全失效——而「吃库拐弯」是台球
   * 走位的核心手段之一。
   *
   * 顺塞与反塞的偏离量**不对称**，这是对的、不是 bug：一侧的切向冲量顶到了库仑
   * 摩擦上限 μ·j_n，另一侧没顶到。真实台球里「顺塞蹭库跑得远、反塞杀不住那么多」
   * 正是同一个原因。
   */
  it("侧塞改变反弹角，且顺塞与反塞不对称", () => {
    const reflect = (offsetX: number) => {
      let state = strike(table(makeBall(0, vec2(ZERO, ZERO))), 0, {
        angle: degToBrad(45),
        power: fromInt(2),
        offsetX: fromRatio(Math.round(offsetX * 100), 100),
        offsetY: ZERO,
      });
      for (let i = 0; i < 5000; i += 1) {
        const result = step(state);
        state = result.state;
        if (result.events.some((e) => e.kind === "cushion-hit")) {
          return (Math.atan2(f(state.balls[0].vel.y), f(state.balls[0].vel.x)) * 180) / Math.PI;
        }
      }
      throw new Error("没撞到库");
    };
    const running = reflect(0.4);
    const none = reflect(0);
    const reverse = reflect(-0.4);
    // 三者必须互不相同——相同就意味着切向耦合整段失效。
    expect(running).toBeGreaterThan(none + 5);
    expect(reverse).toBeLessThan(none - 1);
  });

  /**
   * 碰库的切向冲量**同时**改变球心速度与 spinZ，两者由 Δω_z = −(5/2)·Δv_x/R 锁死。
   *
   * 这是「塞能连续吃几次库」的物理基础。不更新 spinZ 的话，塞在第一次碰库时把
   * 拐弯效果交出去，自己却分毫不减 —— 球每碰一次库都拐同样多，走位算不准；
   * 反过来若只改 spinZ 不改速度，库边就成了理想镜子。上面那条「侧塞改变反弹角」
   * 只看了速度这一半，spinZ 那一半整个没人看着。
   *
   * ## 对照球
   *
   * 难点在于同一拍里 spinZ 还在被摩擦磨（每拍 raw 2470），直接比碰库前后的差值
   * 会把摩擦项混进来。所以同一次 `step` 里放两颗**完全相同**的球，一颗贴库、一颗
   * 摆在台面正中碰不到任何东西，两者相减即精确剥离摩擦 —— 探针实测比值
   * 1.000000，是逐位级别的吻合，不是量级估计。
   *
   * 三个自转值都要测：0（塞从无到有）、+60（顺塞，切向冲量把塞磨掉一截）、
   * −60（反塞，反向增长）。只测一个的话符号写反照样能过。
   */
  it("碰库同时改 spinZ 与球心速度 —— 对照球剥离摩擦，两者由 5/(2R) 锁死", () => {
    // 贴库但未接触：距库边 1 毫米，这一拍朝库边走必然撞上。
    const yRail = fromRatio(
      Math.round((f(HALF_WIDTH) - f(BALL_RADIUS) - 0.001) * 1000000), 1000000,
    );

    for (const spinZ of [0, 60, -60]) {
      // x = 0.5 是长库中段，离袋口都远 —— 摆在 x = 0 会掉进中袋（试过了）。
      const nearRail: Ball = {
        ...makeBall(0, vec2(fromRatio(50, 100), yRail)),
        vel: vec2(fromInt(1), fromInt(2)),
        spinZ: fromInt(spinZ),
      };
      // 对照球：同样的速度与自转，摆在台面正中，这一拍谁也碰不到。
      const control: Ball = { ...nearRail, id: 1, pos: vec2(fromRatio(50, 100), ZERO) };

      const result = step({ balls: [nearRail, control] });
      const [hit, free] = result.state.balls;

      expect(
        result.events.filter((e) => e.kind === "cushion-hit"),
        `spinZ=${spinZ} 这一拍应当撞库一次`,
      ).toHaveLength(1);
      // 对照球真的没被碰：速度只被摩擦削，法向分量保号。
      expect(f(free.vel.y)).toBeGreaterThan(0);

      // 两球相减 = 纯粹的碰库贡献，摩擦项完全抵消。
      const dSpinZ = f(hit.spinZ) - f(free.spinZ);
      const dVx = f(hit.vel.x) - f(free.vel.x);
      // 切向冲量本身非零 —— 先钉这条，否则下面的比值会是 0/0。
      expect(Math.abs(dVx), `spinZ=${spinZ} 应当有切向冲量`).toBeGreaterThan(0.01);
      // 切向冲量 j_t 让球心速度变 −j_t、让自转变 +(5/2)j_t/R。
      //
      // 断言写成**比值**而不是差值：Δω_z 在 60 这个量级上，而
      // `div(mul(5/2, j_t), R)` 的定点截断约 18 个最低位，折算成绝对误差 2.8e-4 ——
      // 按绝对值钉到小数点后 4 位会红，而那是截断，不是耦合错了。比值与量级无关，
      // 探针实测 1.000000 / 0.999995。
      expect(dSpinZ / ((-2.5 * dVx) / f(BALL_RADIUS)), `spinZ=${spinZ} 的 Δω_z 应与 Δv_x 严格耦合`)
        .toBeCloseTo(1, 4);
    }
  });
  it("球不会穿出台面 —— 大力加满塞连续弹库也不行", () => {
    for (const angle of [0, 1000, 4096, 7000, 12000]) {
      const result = simulate(
        strike(table(makeBall(0, vec2(ZERO, ZERO))), 0, {
          angle,
          power: MAX_POWER,
          offsetX: MAX_TIP_OFFSET,
          offsetY: ZERO,
        }),
      );
      const ball = result.state.balls[0];
      if (ball.pocketed) continue;
      expect(Math.abs(f(ball.pos.x))).toBeLessThanOrEqual(f(HALF_LENGTH));
      expect(Math.abs(f(ball.pos.y))).toBeLessThanOrEqual(f(HALF_WIDTH));
    }
  });

  it("贴库静止的球不会反复触发碰库 —— 一次事件就是一次", () => {
    const result = simulate(shoot(table(makeBall(0, vec2(fromRatio(120, 100), ZERO))), 0.3));
    expect(result.events.filter((e) => e.kind === "cushion-hit")).toHaveLength(1);
  });

  /**
   * 库边是**线段**，袋口处断开。
   *
   * 写成「四面墙」的话，贴库滚向角袋的球会在袋口那段不存在的墙上弹回来，永远
   * 进不了袋——而贴库进袋是台球里最常见的球路之一。
   */
  it("贴着长库滚向角袋的球能进袋，不会被袋口的「墙」弹回", () => {
    const nearRail = fromRatio(Math.round((f(HALF_WIDTH) - f(BALL_RADIUS) - 0.002) * 100000), 100000);
    const result = simulate(
      shoot(table(makeBall(0, vec2(fromRatio(60, 100), nearRail))), 2),
    );
    expect(result.state.balls[0].pocketed).toBe(true);
    expect(result.events.some((e) => e.kind === "pocketed")).toBe(true);
  });

  /**
   * 上一条只证明「贴库的球能进袋」，而那条路径上球压根没走到线段端点之外 ——
   * 它在缺口里一路滑进袋，把库边当成无限长直线也照样绿（变异体 M40/M41 就是
   * 这样活下来的）。
   *
   * 这条正面测**线段端点之外没有墙**：把球直接摆在缺口深处，探针实测
   * x ≥ 1.2092 时球心到 CUSHIONS[1] 右端点 (1.18918, 0.63499) 的距离已超过一个
   * 球半径，于是线段判定放行、直线判定拦截 —— 两者在这里给出相反的答案。
   *
   * 分两段断言，缺一不可：
   *   - 缺口里朝库边方向推：一次撞库都不该有（直线判定会当场给出 1 次）；
   *   - 端点圆帽之内（x ≤ 1.2052）：必须**照常**撞库。少了这半边，
   *     「库边整个不存在」这种改法同样能让上半边通过。
   */
  it("库边线段端点之外没有墙 —— 缺口里的球不该撞库，端点之内照撞", () => {
    const y = fromRatio(Math.round((f(HALF_WIDTH) - f(BALL_RADIUS) + 0.003) * 1000000), 1000000);
    /** 让球朝上长库方向走一拍，数撞库事件。 */
    const hitsAt = (x: number): number => {
      const ball = { ...makeBall(0, vec2(fromRatio(Math.round(x * 1000000), 1000000), y)),
        vel: vec2(ZERO, fromRatio(6, 10)) };
      return step({ balls: [ball] }).events.filter((e) => e.kind === "cushion-hit").length;
    };

    // 端点圆帽之内：库边确实在，必须撞。
    for (const x of [1.18, 1.1892, 1.2, 1.2052]) {
      expect(hitsAt(x), `x=${x} 在端点一个半径之内，应当撞库`).toBe(1);
    }
    // 缺口深处：线段已经到头，这里是袋口，不该有墙。
    for (const x of [1.2092, 1.213, 1.217]) {
      expect(hitsAt(x), `x=${x} 已越过线段端点，不该撞库`).toBe(0);
    }
  });

  /**
   * 缺口里的球最终要**掉进袋**，不是停在台外。
   *
   * 上一条只看单拍事件数，而「库边不存在」与「球飞出台面再也回不来」在单拍上
   * 长得一样。这条走完整旅程。
   */
  it("袋口缺口里的球一路进袋 —— 全程零次撞库", () => {
    const y = fromRatio(Math.round((f(HALF_WIDTH) - f(BALL_RADIUS) + 0.003) * 1000000), 1000000);
    for (const x of [1.2092, 1.213, 1.217]) {
      let state = table({
        ...makeBall(0, vec2(fromRatio(Math.round(x * 1000000), 1000000), y)),
        vel: vec2(fromRatio(3, 10), fromRatio(6, 10)),
      });
      let cushionHits = 0;
      let pocketed = false;
      for (let i = 0; i < 600 && !pocketed; i += 1) {
        const result = step(state);
        state = result.state;
        cushionHits += result.events.filter((e) => e.kind === "cushion-hit").length;
        pocketed = result.events.some((e) => e.kind === "pocketed");
      }
      expect(pocketed, `x=${x} 应当进袋`).toBe(true);
      expect(cushionHits, `x=${x} 全程不该撞库`).toBe(0);
    }
  });

  /**
   * 深嵌入库边的球必须**一次推到位**。这条是回归用例，对应一个真实缺陷。
   *
   * 推出深度原本按无符号距离算 `R − |away|`。球心还在库内侧时它是对的，可球心
   * 一旦**越过库边线**，`away` 翻向库外，无符号距离重新变大，推出量于是不够 ——
   * 探针实测嵌入 40 毫米的球推完仍在台外（间隙 0.0019，需要 0.0286），而法向
   * 冲量已经把速度清零，球从此永远卡在台面之外。改成有符号距离后自动变成
   * `R + |越过的量|`，一次到位。
   *
   * 正常演算走不到这么深（单个子步最多走半个半径，每步都查库；探针也确认了
   * 两球分离不会把球推过库边线），所以这是**坏状态的恢复路径**，与 `resolvePair`
   * 里两球完全重合的分支同一性质：未必触发，但一旦触发就必须真的恢复，
   * 且两端恢复到同一个位置。
   *
   * 28.5 毫米这个点专门挑在球半径附近 —— 它正是有符号距离穿过零的地方。
   */
  it("深嵌入库边的球一次推到位 —— 球心越过库边线时无符号距离会推得不够", () => {
    for (const depth of [0.005, 0.02, 0.028, 0.04]) {
      const y = fromRatio(
        Math.round((f(HALF_WIDTH) - f(BALL_RADIUS) + depth) * 1000000), 1000000,
      );
      // x = 0.5 是长库中段，离任何袋口都远 —— 摆在 x = 0 会掉进中袋。
      const ball = { ...makeBall(0, vec2(fromRatio(50, 100), y)), vel: vec2(ZERO, fromRatio(5, 10)) };
      const after = step({ balls: [ball] }).state.balls[0];
      const clearance = f(HALF_WIDTH) - f(after.pos.y);
      expect(clearance, `嵌入 ${depth * 1000} 毫米后应被推回台内`)
        .toBeGreaterThanOrEqual(f(BALL_RADIUS) - 1e-5);
    }
  });
});

describe("billiards/solver 摆球与开球", () => {
  it("标准摆球：16 颗、互不重叠、都在台面内、都不在袋里", () => {
    const state = rackBalls();
    expect(state.balls).toHaveLength(16);
    for (let i = 0; i < state.balls.length; i += 1) {
      const ball = state.balls[i];
      expect(ball.pocketed).toBe(false);
      expect(Math.abs(f(ball.pos.x))).toBeLessThan(f(HALF_LENGTH));
      expect(Math.abs(f(ball.pos.y))).toBeLessThan(f(HALF_WIDTH));
      for (let j = i + 1; j < state.balls.length; j += 1) {
        expect(overlapping(ball, state.balls[j])).toBe(false);
      }
    }
  });

  /**
   * 摆球必须**紧密**，不只是不重叠。
   *
   * 上一条只断言「没有重叠」，而 `gap` 取任意大的值都能满足它 —— 摆成一盘散沙
   * 照样全绿，开球却不炸开。这条把间距钉在直径的一个最低位内。
   *
   * 同时它是「行间距用 √3/2」的用例：改成 1（正三角形退化成正方形网格）之后，
   * 斜向邻居的球心距会变成 gap×√1.25 ≈ 4186，远超容差。
   */
  it("摆球紧密：每颗球都有邻居贴着它，间距不超过直径一个最低位", () => {
    const objects = rackBalls().balls.slice(1);
    const diameter = BALL_DIAMETER;

    for (const ball of objects) {
      let nearest = Infinity;
      for (const other of objects) {
        if (other.id === ball.id) {
          continue;
        }
        const d = vLen(vSub(ball.pos, other.pos));
        if (d < nearest) {
          nearest = d;
        }
      }
      // 贴着 = 球心距落在 [直径, 直径+1]。低于直径是重叠，高于是有缝。
      expect(nearest, `${ball.id} 号球与最近邻的球心距`).toBeGreaterThanOrEqual(diameter);
      expect(nearest, `${ball.id} 号球与最近邻的球心距`).toBeLessThanOrEqual(diameter + 1);
    }
  });

  /**
   * 余量的**理由**，写成用例。
   *
   * 行内间距与行间距是两条不同的截断链路：行内是 `k×gap`，行间是
   * `row×trunc(gap×0.866)`。斜向邻居的球心距由两者的平方和开方得到，必然比
   * gap 少一两个最低位。gap 正好等于直径的话，斜向那一对就是**真实重叠**。
   *
   * 这条直接复刻两种 gap 的摆法做对比 —— 断言的不是「摆球没重叠」（那太弱，
   * 上面已有），而是「去掉余量**会**重叠」。没有它，`gap = diameter` 这个改动
   * 无人看管。
   *
   * 注：这个用例曾经写不出来。当时 `overlapping` 比较的是直径的**平方**，
   * 有 7 个最低位的盲区，斜向那 3743 的真重叠它根本看不见，去掉余量照样全绿。
   * 先修实现，再补用例 —— 顺序反了的话只会补出一条假绿的用例。
   */
  it("余量不能去掉：gap 正好等于直径时，斜向邻居真的会重叠", () => {
    /** 复刻 rackBalls 的定点链路，只把 gap 抽成参数。 */
    const rackWith = (gap: Fixed): Ball[] => {
      const rowGap = mul(gap, fromRatio(866, 1000));
      const balls: Ball[] = [];
      let id = 1;
      for (let row = 0; row < 5; row += 1) {
        const x = mul(fromInt(row), rowGap);
        const offset = mul(mul(fromInt(row), gap), HALF);
        for (let k = 0; k <= row; k += 1) {
          balls.push(makeBall(id, vec2(x, sub(mul(fromInt(k), gap), offset))));
          id += 1;
        }
      }
      return balls;
    };

    const countOverlaps = (balls: readonly Ball[]): number => {
      let n = 0;
      for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) {
          if (overlapping(balls[i], balls[j])) {
            n += 1;
          }
        }
      }
      return n;
    };

    // 实现用的 gap：一个重叠都没有。
    expect(countOverlaps(rackWith(add(BALL_DIAMETER, 1)))).toBe(0);
    // 去掉余量：斜向邻居全线重叠。实测 20 对。
    expect(countOverlaps(rackWith(BALL_DIAMETER))).toBeGreaterThan(0);
  });


  it("母球在开球点、顶点球在置球点，两者分处台面两侧", () => {
    const state = rackBalls();
    expect(f(state.balls[CUE_BALL_ID].pos.x)).toBeCloseTo(-f(HALF_LENGTH) / 2, 3);
    expect(f(state.balls[CUE_BALL_ID].pos.y)).toBeCloseTo(0, 3);
    expect(f(state.balls[1].pos.x)).toBeCloseTo(f(HALF_LENGTH) / 2, 3);
  });

  /**
   * 开球的事件量级本身就是一条断言。
   *
   * 隔空碰撞那个 bug 的表现是 2777 次撞击、2551 次低于 0.05 米/秒；修好之后是
   * 34 次。所以「撞击次数是不是几十量级」直接反映碰撞判定是否健全，比逐个断言
   * 每颗球的落点稳定得多（后者会被任何一处最低位改动打红，是脆的）。
   */
  it("开球：事件量级正常、全部停稳、无重叠、无逃逸", () => {
    const result = simulate(strike(rackBalls(), CUE_BALL_ID, {
      angle: 0,
      power: fromInt(8),
      offsetX: ZERO,
      offsetY: ZERO,
    }));

    const hits = result.events.filter((e) => e.kind === "ball-hit");
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.length).toBeLessThan(200);
    // 低速抖动占比过高就是碰撞判定漏了接触检查。
    const chatter = hits.filter((e) => f((e as { speed: number }).speed) < 0.05);
    expect(chatter.length).toBeLessThan(hits.length / 2);

    expect(allStopped(result.state)).toBe(true);
    for (let i = 0; i < result.state.balls.length; i += 1) {
      for (let j = i + 1; j < result.state.balls.length; j += 1) {
        expect(overlapping(result.state.balls[i], result.state.balls[j])).toBe(false);
      }
    }
  });

  /**
   * `simulate` 的停机点**恰好**是第一个 `allStopped` 为真的拍，与 `maxTicks` 无关。
   *
   * 上面那条只钉了上限，把提前退出整个删掉照样绿 —— 球早就停了，多跑几千拍
   * 位置也不动。但状态**是**会变的：探针实测球停在第 1588 拍时速度还剩
   * raw (−142, −189)（低于停止阈值 256，所以判为停下），再走一拍
   * `applyFriction` 的 stopped 分支会把它清成 (0, 0)。位置一模一样，速度不一样。
   *
   * 于是「这一杆的终局」取决于**跑了多少拍**。服务端复算时若传了不同的
   * `maxTicks`，逐位比对就会失败 —— 而台球「只传输入不传状态」的整个设计就
   * 建立在这个比对上。失效方式极其隐蔽：物理完全一致，只是停机点不同。
   *
   * **基准必须用 `step` 手工推出来，不能拿 `simulate` 自己的输出当基准。**
   * 我第一版写的是「`simulate(simulate(x))` 幂等」，它杀不掉变异体：去掉提前
   * 退出之后两次调用都磨到同一个不动点，幂等性照样成立。基准取自被测函数
   * 本身，就只能验证它自洽，验证不了它对。
   *
   * 顺带记下：返回态带着低于阈值的残余速度是这个契约的**有意**后果，不是遗漏。
   * 它在下一杆的第一拍就会被 stopped 分支清零，也小到不影响子步数（raw 236
   * 折算成一拍位移不足一个最低位），而且两端算出来完全相同。
   */
  it("停机点恰好是第一个全停的拍 —— 基准用 step 手工推，拿 simulate 自己当基准杀不掉变异体", () => {
    const initial = strike(table(makeBall(0, vec2(ZERO, ZERO))), 0, {
      angle: degToBrad(37),
      power: fromInt(2),
      offsetX: fromRatio(3, 10),
      offsetY: ZERO,
    });

    // 手工推到第一个全停的拍，逐拍收集事件。这就是 simulate 该给出的答案。
    let hand = initial;
    const handEvents: BilliardsEvent[] = [];
    let ticks = 0;
    while (!allStopped(hand) && ticks < MAX_TICKS) {
      const result = step(hand);
      hand = result.state;
      handEvents.push(...result.events);
      ticks += 1;
    }
    expect(allStopped(hand)).toBe(true);
    // 确实跑了一段，不是一开始就停着 —— 否则下面的比对是空的。
    expect(ticks).toBeGreaterThan(100);

    const auto = simulate(initial);
    expect(statesEqual(auto.state, hand)).toBe(true);
    expect(auto.events).toEqual(handEvents);

    // 上限给多大都是同一个终局。不提前退出的话，残余速度会被继续磨掉。
    expect(statesEqual(simulate(initial, MAX_TICKS).state, hand)).toBe(true);
  });

  it("演算有上限 —— 系数被改坏时宁可交出当前状态，也不能让客户端卡死", () => {
    const result = simulate(strike(rackBalls(), CUE_BALL_ID, {
      angle: 0,
      power: fromInt(8),
      offsetX: ZERO,
      offsetY: ZERO,
    }), 5);
    // 只跑 5 拍，当然停不下来——重点是它**返回了**。
    expect(allStopped(result.state)).toBe(false);
  });
});

describe("billiards/solver 确定性", () => {
  /**
   * **这是台球「只传输入不传状态」的前提。**
   *
   * 同一杆演算两次必须逐位相同。任何依赖遍历顺序、浮点、或 Map 迭代序的写法都会
   * 在这里暴露——不是概率性地暴露，是必然。
   */
  it("同一杆演算两次逐位相同", () => {
    const shot = () =>
      simulate(strike(rackBalls(), CUE_BALL_ID, {
        angle: 137,
        power: fromInt(7),
        offsetX: fromRatio(2, 10),
        offsetY: fromRatio(-3, 10),
      }));
    const a = shot();
    const b = shot();
    expect(statesEqual(a.state, b.state)).toBe(true);
    expect(a.events).toEqual(b.events);
  });

  /**
   * 镜像对称：+θ 与 −θ 的落点必须**逐位**镜像。
   *
   * 这条守的是定点层「向零截断而非 floor」那个决定。floor 会让负数一侧多截掉一个
   * 最低位，误差方向固定、几十次碰撞后不会互相抵消——表现是向上打和向下打的球
   * 跑的距离不一样，而这在联机对局里是实打实的不公平。
   */
  it("上下对称的两杆逐位镜像 —— 定点取整方向的最终检验", () => {
    const shotAt = (angle: number) =>
      simulate(strike(table(makeBall(0, vec2(ZERO, ZERO))), 0, {
        angle,
        power: fromInt(3),
        offsetX: ZERO,
        offsetY: ZERO,
      })).state.balls[0].pos;
    const up = shotAt(degToBrad(30));
    const down = shotAt(-degToBrad(30));
    expect(up.x).toBe(down.x);
    expect(up.y).toBe(-down.y);
  });

  it("演算不改动传入的状态 —— 服务端要拿同一个初态复算校验", () => {
    const before = rackBalls();
    const snapshot = JSON.parse(JSON.stringify(before));
    simulate(strike(before, CUE_BALL_ID, {
      angle: 0,
      power: fromInt(8),
      offsetX: ZERO,
      offsetY: ZERO,
    }));
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it("事件按时间顺序排列 —— 八球判「母球先碰到谁」全靠这个顺序", () => {
    const result = simulate(strike(rackBalls(), CUE_BALL_ID, {
      angle: 0,
      power: fromInt(8),
      offsetX: ZERO,
      offsetY: ZERO,
    }));
    const first = result.events.find((e) => e.kind === "ball-hit");
    // 开球时母球第一个碰到的必然是顶点球。
    expect(first).toMatchObject({ a: CUE_BALL_ID, b: 1 });
  });

  it("TICK 是 2 的幂分之一 —— 子步再拆才不会引入时间步长的分歧", () => {
    expect(f(TICK)).toBe(1 / 256);
    expect(ONE % (TICK as number)).toBe(0);
  });

  /**
   * **子步数必须是 2 的幂**，因为 `TICK / n` 要在定点域里精确。
   *
   * TICK 的 raw 是 256。除以 2 的幂仍是整数，n 个子步加起来精确等于一拍；除以 3
   * 就是 `trunc(256/3) = 85`，85 × 3 = **255 ≠ 256** —— 每拍凭空少掉 1/65536 秒。
   * 这不是精度问题而是**时间步长本身**出现分歧：两端只要在某一拍取了不同的 n
   * （速度差一个最低位就够了），此后所有位置全部对不上，而台球「只传输入不传
   * 状态」的整个设计就建立在两端逐位一致上。
   *
   * 上面那条只钉了 TICK 这个常量，n 怎么递增它管不着 —— 把 `n *= 2` 改成
   * `n *= 3` 照样绿。这条直接检查除法的**可逆性**：`div(TICK, n) × n === TICK`。
   */
  it("子步数一律是 2 的幂 —— 除以 3 的话 n 个子步加起来不等于一拍", () => {
    for (let n = 1; n <= 64; n *= 2) {
      const dt = div(TICK, fromInt(n));
      expect(mul(dt, fromInt(n)), `${n} 个子步应精确拼回一拍`).toBe(TICK);
    }
    // 反证：3 的幂做不到。85 × 3 = 255，差了整整一个最低位。
    expect(mul(div(TICK, fromInt(3)), fromInt(3))).not.toBe(TICK);
  });

  /**
   * 一拍的位移与「速度 × 一拍」只差子步截断，不该差数量级。
   *
   * 每个子步的位移各截断一次，n 个子步累计最多丢 n 个最低位 —— 探针实测正好是
   * n−1（v=32 拆 16 步丢 15 raw）。断言按 raw 写，容差取「子步数」这个上界：
   * 换成 3 递增的话 n 会取到 3、9、27，dt 本身就已经不准，误差跳出这个上界。
   */
  it("一拍位移只丢子步截断那几个最低位 —— 按 raw 断言，浮点看不出来", () => {
    for (const v of [1, 2, 4, 8, 16, 32]) {
      // 纯滚动（spin = -v）：摩擦只按滚动阻力削一点，不进滑动分支。
      const ball = {
        ...makeBall(0, vec2(ZERO, ZERO)),
        vel: vec2(fromInt(v), ZERO),
        spin: vec2(neg(fromInt(v)), ZERO),
      };
      const after = step({ balls: [ball] }).state.balls[0];
      // 位移用的是摩擦之后的速度，所以拿碰后速度算理想值。
      const ideal = mul(after.vel.x, TICK);
      const loss = (ideal as number) - (after.pos.x as number);
      expect(loss, `v=${v} 位移不该反超理想值`).toBeGreaterThanOrEqual(0);
      expect(loss, `v=${v} 丢失的最低位数不该超过子步数`).toBeLessThan(MAX_SUBSTEPS_FOR_TEST);
    }
  });
});

/** 子步数上限，与实现里的 MAX_SUBSTEPS 对齐。位移截断的上界就是它。 */
const MAX_SUBSTEPS_FOR_TEST = 64;
