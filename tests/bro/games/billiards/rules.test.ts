/**
 * 台球：美式八球规则层。
 *
 * 判罚的输入是**事件序列**，而事件序列是纯数据 —— 所以这个文件的大半用例直接
 * 手工构造事件喂给 `judge`，不去摆球打真球。理由不是图快：
 *
 * 犯规组合有十几种（母球落袋 × 先碰错球 × 有没有吃库 × 开球没开），靠真实击球
 * 逐一复现，得为每一种找一个恰好能打出它的角度力度。那种用例**极脆**：物理
 * 系数动一个最低位，球的落点就变了，用例red 的原因与它想验证的规则毫无关系。
 * 而且失败信息是「期望 no_rail 得到 null」，看不出是判罚错了还是球打歪了。
 *
 * 真实击球只用来验证**接缝**：`shoot` 把 solver 的事件正确地交给了 judge，
 * 以及 judge 的结论正确地落到了状态上。那部分用例不多，但必须有 —— 全用手工
 * 事件的话，`shoot` 里把参数传反、把 before/after 状态搞混，一个都发现不了。
 */

import { describe, expect, it } from "vitest";
import {
  BREAK_RAIL_REQUIREMENT,
  EIGHT_BALL_ID,
  RACK_BACK_CORNERS,
  RACK_EIGHT_SLOT,
  RACK_ORDER,
  applyOutcome,
  cueBallOf,
  distinctRailBalls,
  firstContactOf,
  groupOfBall,
  groupOfSeat,
  judge,
  legalTargets,
  otherGroup,
  otherSeat,
  placeCueBall,
  pocketedIn,
  rackEightBall,
  railOrPocketAfterContact,
  remainingBalls,
  remainingOfGroup,
  shoot,
  withinPlacementBounds,
} from "@/bro/games/billiards/logic/rules";
import type { EightBallState } from "@/bro/games/billiards/logic/rules";
import type { BilliardsEvent } from "@/bro/games/billiards/logic/solver";
import { CUE_BALL_ID } from "@/bro/games/billiards/logic/solver";
import { makeBall, overlapping } from "@/bro/games/billiards/logic/ball";
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  HALF_LENGTH,
  HALF_WIDTH,
  POCKETS,
  pocketAt,
} from "@/bro/games/billiards/logic/table";
import { BRAD_HALF, vLen, vSub, vec2 } from "@/bro/games/billiards/logic/vec";
import { ONE, ZERO, add, fromInt, fromRatio, sub, toFloat } from "@/bro/games/billiards/logic/fixed";

const f = toFloat;

// ───────────────────────── 事件构造 ─────────────────────────

/** 母球碰到某颗球。速度取一个不为零的定值 —— 判罚不看它。 */
function hit(a: number, b: number): BilliardsEvent {
  return { kind: "ball-hit", a: Math.min(a, b), b: Math.max(a, b), speed: ONE };
}

function rail(ball: number, cushion = 0): BilliardsEvent {
  return { kind: "cushion-hit", ball, cushion, speed: ONE };
}

function pot(ball: number, pocket = 0): BilliardsEvent {
  return { kind: "pocketed", ball, pocket };
}

/**
 * 造一个开过球的中局状态。
 *
 * `pocketed` 里的球被标记为已入袋，其余留在台面上。位置全部照抄开局摆球 ——
 * 判罚不看位置（只看事件），所以位置怎么摆都行；照抄是为了让状态始终是**合法**的
 * （不重叠、都在台面内），免得哪天有人往用例里加一句真实击球，球堆在一起炸掉。
 */
function midGame(over: Partial<EightBallState> & { pocketed?: number[] } = {}): EightBallState {
  const { pocketed = [], ...rest } = over;
  const base = rackEightBall(0);
  return {
    ...base,
    table: {
      balls: base.table.balls.map((b) =>
        pocketed.includes(b.id) ? { ...b, pocketed: true } : b,
      ),
    },
    broken: true,
    ...rest,
  };
}

// ───────────────────────── 摆球 ─────────────────────────

describe("billiards/rules 摆球", () => {
  it("母球 + 15 颗目标球，编号 0~15 各一颗", () => {
    const state = rackEightBall();
    expect(state.table.balls.map((b) => b.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });

  /**
   * 八球摆法的两条硬性约束。
   *
   * 摆错了对手可以要求重摆，而摆法写死在代码里 —— 错了是**每一局**都错，且没有
   * 任何自动手段会发现：球照样能打，游戏照样能赢，只是所有开球的散布都不对。
   * 这两条直接钉在 RACK_ORDER 上，改错当场红。
   */
  it("8 号球在第三排正中", () => {
    expect(RACK_ORDER[RACK_EIGHT_SLOT]).toBe(EIGHT_BALL_ID);
    // 槽位 4 确实是第三排（前两排占 1+2=3 个槽）的正中：第三排是槽 3、4、5。
    expect(RACK_EIGHT_SLOT).toBe(3 + 1);
  });

  it("底排两角一全色一花色", () => {
    const [left, right] = RACK_BACK_CORNERS.map((slot) => RACK_ORDER[slot]);
    expect(groupOfBall(left)).not.toBeNull();
    expect(groupOfBall(right)).not.toBeNull();
    expect(groupOfBall(left)).not.toBe(groupOfBall(right));
    // 底排是最后 5 个槽（10~14），两角就是首尾。
    expect(RACK_BACK_CORNERS).toEqual([10, 14]);
  });

  /**
   * 重新编号**只改 id，不动位置**。
   *
   * `rackBalls()` 的球心间距留了一个最低位的余量，理由写在 solver.ts 里（斜向
   * 邻居的截断链路更长，正好等于直径就是真重叠）。八球层要是自己重算一遍位置，
   * 那个余量必然丢掉，摆球当场就是 15 颗互相重叠的球。
   */
  it("摆好的球互不重叠 —— 位置照抄 rackBalls，不重算", () => {
    const balls = rackEightBall().table.balls;
    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        expect(overlapping(balls[i], balls[j]), `球 ${balls[i].id} 与 ${balls[j].id} 重叠`).toBe(false);
      }
    }
  });

  it("球按 id 升序排列 —— 事件里的 id 与 solver 的遍历下标必须是同一件事", () => {
    const ids = rackEightBall().table.balls.map((b) => b.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("开球方可指定，其余字段是干净的开局", () => {
    const state = rackEightBall(1);
    expect(state.turn).toBe(1);
    expect(state.solidsSeat).toBeNull();
    expect(state.broken).toBe(false);
    expect(state.ballInHand).toBe(false);
    expect(state.winner).toBeNull();
  });
});

// ───────────────────────── 球组 ─────────────────────────

describe("billiards/rules 球组", () => {
  it("1~7 全色，9~15 花色，母球与 8 号都不属于任何一组", () => {
    for (let id = 1; id <= 7; id += 1) expect(groupOfBall(id)).toBe("solids");
    for (let id = 9; id <= 15; id += 1) expect(groupOfBall(id)).toBe("stripes");
    expect(groupOfBall(CUE_BALL_ID)).toBeNull();
    expect(groupOfBall(EIGHT_BALL_ID)).toBeNull();
  });

  it("otherGroup 是对合：套两次回到自己", () => {
    expect(otherGroup("solids")).toBe("stripes");
    expect(otherGroup(otherGroup("solids"))).toBe("solids");
  });

  it("otherSeat 是对合", () => {
    expect(otherSeat(0)).toBe(1);
    expect(otherSeat(otherSeat(1))).toBe(1);
  });

  /**
   * 只存「全色归谁」一份，另一方由它推出。
   *
   * 两个座位各存一份球组的话，交换击球权时更新漏一处，就会出现「双方都是全色」
   * 这种状态 —— 而它不会立刻崩，只是判罚从此全错。围棋的 view.ts 已经在
   * `toPlay` 与 `activeSeat` 上踩过一次同源的坑。
   */
  it("定组后两个座位必然互补 —— 只存一份，推不出矛盾", () => {
    const solidsIsZero = midGame({ solidsSeat: 0 });
    expect(groupOfSeat(solidsIsZero, 0)).toBe("solids");
    expect(groupOfSeat(solidsIsZero, 1)).toBe("stripes");

    const solidsIsOne = midGame({ solidsSeat: 1 });
    expect(groupOfSeat(solidsIsOne, 1)).toBe("solids");
    expect(groupOfSeat(solidsIsOne, 0)).toBe("stripes");
  });

  it("未定组时两个座位都没有球组", () => {
    const open = midGame({ solidsSeat: null });
    expect(groupOfSeat(open, 0)).toBeNull();
    expect(groupOfSeat(open, 1)).toBeNull();
  });

  it("remainingOfGroup 不数已入袋的球", () => {
    const state = midGame({ pocketed: [1, 2, 9] });
    expect(remainingOfGroup(state, "solids")).toEqual([3, 4, 5, 6, 7]);
    expect(remainingOfGroup(state, "stripes")).toEqual([10, 11, 12, 13, 14, 15]);
    expect(remainingBalls(state)).not.toContain(1);
    // 8 号不属于任何一组，不出现在任一组的剩余里。
    expect(remainingOfGroup(state, "solids")).not.toContain(EIGHT_BALL_ID);
    expect(remainingOfGroup(state, "stripes")).not.toContain(EIGHT_BALL_ID);
  });
});

// ───────────────────────── 合法目标 ─────────────────────────

describe("billiards/rules 合法目标球", () => {
  /**
   * 界面的瞄准提示、机器人的选球、判罚的犯规判定，三处都调这一个函数。
   *
   * 各写一遍必然分歧，而分歧的表现是**界面说这杆合法、服务端判你犯规** ——
   * 玩家会认为是外挂或者黑幕。
   */
  it("台面开放：除 8 号外任何目标球都能先碰", () => {
    const open = midGame({ solidsSeat: null });
    const targets = legalTargets(open, 0);
    expect(targets).not.toContain(EIGHT_BALL_ID);
    expect(targets).not.toContain(CUE_BALL_ID);
    expect(targets).toHaveLength(14);
  });

  it("已定组：只能先碰本组的球", () => {
    const state = midGame({ solidsSeat: 0 });
    expect(legalTargets(state, 0)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(legalTargets(state, 1)).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it("本组清完：只剩 8 号", () => {
    const cleared = midGame({ solidsSeat: 0, pocketed: [1, 2, 3, 4, 5, 6, 7] });
    expect(legalTargets(cleared, 0)).toEqual([EIGHT_BALL_ID]);
    // 对手还没清完，他的目标仍是自己那一组。
    expect(legalTargets(cleared, 1)).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it("已入袋的球不再是合法目标", () => {
    const state = midGame({ solidsSeat: 0, pocketed: [1, 3] });
    expect(legalTargets(state, 0)).toEqual([2, 4, 5, 6, 7]);
  });
});

// ───────────────────────── 事件读取 ─────────────────────────

describe("billiards/rules 事件读取", () => {
  it("firstContact 取母球参与的第一次撞击 —— 母球之间的球撞球不算", () => {
    const events = [
      hit(3, 9), // 母球还没到，两颗目标球先撞上（上一杆的残留不可能，但顺序无关性要钉住）
      hit(CUE_BALL_ID, 5),
      hit(CUE_BALL_ID, 2),
    ];
    expect(firstContactOf(events)).toBe(5);
  });

  /**
   * `a` / `b` 两侧都查。
   *
   * solver 的球对遍历是 i&lt;j，母球下标 0，所以现在母球恒在 `a` 位 —— 只查 `a`
   * 也能全绿。但那是 solver 的**内部**不变量，规则层不该依赖：哪天事件改成按
   * id 排序广播、或者母球不再是 0 号，只查一侧的写法会**静默**地永远返回 null，
   * 于是每一杆都判「没碰到球」。这条用例把 b 侧那个分支单独钉住。
   */
  it("母球出现在 b 位也能识别 —— 不依赖 solver 的 i<j 内部约定", () => {
    const reversed: BilliardsEvent = {
      kind: "ball-hit",
      a: 7,
      b: CUE_BALL_ID,
      speed: ONE,
    };
    expect(firstContactOf([reversed])).toBe(7);
  });

  it("一颗球都没碰到 → null", () => {
    expect(firstContactOf([rail(CUE_BALL_ID), rail(CUE_BALL_ID, 2)])).toBeNull();
    expect(firstContactOf([])).toBeNull();
  });

  it("pocketedIn 保留落袋先后 —— 定组要看第一颗", () => {
    expect(pocketedIn([pot(9), rail(1), pot(3), pot(CUE_BALL_ID)])).toEqual([9, 3, CUE_BALL_ID]);
  });

  /**
   * 「碰球之后有没有效果」必须从**接触之后**数起。
   *
   * 母球在碰到目标球之前先吃库是常规打法（长台回球）。拿它充数的话，
   * 「贴库轻推一下让母球回弹、目标球纹丝不动」就成了合法安全球，双方可以
   * 无限互推。这是软磨的口子，开了就堵不住。
   */
  it("接触之前的吃库不算数 —— 否则贴库轻推成了合法安全球", () => {
    const beforeOnly = [rail(CUE_BALL_ID), hit(CUE_BALL_ID, 3)];
    expect(railOrPocketAfterContact(beforeOnly)).toBe(false);

    const after = [rail(CUE_BALL_ID), hit(CUE_BALL_ID, 3), rail(3)];
    expect(railOrPocketAfterContact(after)).toBe(true);
  });

  it("接触后进球也算有效果", () => {
    expect(railOrPocketAfterContact([hit(CUE_BALL_ID, 3), pot(3)])).toBe(true);
  });

  it("一次都没碰到球 → 无从谈「接触之后」", () => {
    expect(railOrPocketAfterContact([rail(CUE_BALL_ID), rail(CUE_BALL_ID, 3)])).toBe(false);
  });

  /**
   * 数的是**不同的球**，不是吃库次数。
   *
   * 数次数的话，母球一颗球在两条长库之间来回弹四下就满足了开球要求 —— 而那
   * 恰恰是「没打散球堆」的典型表现，正是这条规则要禁止的东西。
   */
  it("distinctRailBalls 按球去重 —— 一颗球弹四次不等于四颗球吃库", () => {
    const oneBallFourTimes = [rail(CUE_BALL_ID, 0), rail(CUE_BALL_ID, 1), rail(CUE_BALL_ID, 2), rail(CUE_BALL_ID, 3)];
    expect(distinctRailBalls(oneBallFourTimes)).toBe(1);

    const fourBalls = [rail(1), rail(2), rail(3), rail(4), rail(1)];
    expect(distinctRailBalls(fourBalls)).toBe(4);
  });
});

// ───────────────────────── 开球判罚 ─────────────────────────

describe("billiards/rules 开球判罚", () => {
  const opening = rackEightBall(0);

  it("进了球即为合法开球，且续杆", () => {
    const outcome = judge(opening, [hit(CUE_BALL_ID, 1), pot(1)]);
    expect(outcome.foul).toBeNull();
    expect(outcome.continues).toBe(true);
  });

  it("没进球但四颗球吃库也合法 —— 但不续杆", () => {
    const events = [hit(CUE_BALL_ID, 1), rail(1), rail(2), rail(3), rail(4)];
    expect(distinctRailBalls(events)).toBe(BREAK_RAIL_REQUIREMENT);
    const outcome = judge(opening, events);
    expect(outcome.foul).toBeNull();
    expect(outcome.continues).toBe(false);
  });

  it("差一颗球吃库就是废开球", () => {
    const events = [hit(CUE_BALL_ID, 1), rail(1), rail(2), rail(3)];
    expect(distinctRailBalls(events)).toBe(BREAK_RAIL_REQUIREMENT - 1);
    expect(judge(opening, events).foul).toBe("illegal_break");
  });

  /**
   * 开球**不定组**。
   *
   * WPA 口径：开球进了球台面仍然开放，下一杆进的球才定组。写成「开球进什么就是
   * 什么组」的话，开球那种大力散球的运气成分会直接决定整局的球组分配 ——
   * 而开球方本来就有优势，再叠一层运气，先手胜率会明显失衡。
   */
  it("开球进球不定组 —— 台面仍然开放", () => {
    const outcome = judge(opening, [hit(CUE_BALL_ID, 1), pot(1), pot(9)]);
    expect(outcome.assigned).toBeNull();

    const after = shootEvents(opening, [hit(CUE_BALL_ID, 1), pot(1), pot(9)]);
    expect(after.solidsSeat).toBeNull();
  });

  it("开球母球落袋是犯规，且不因为进了别的球而抵消", () => {
    const outcome = judge(opening, [hit(CUE_BALL_ID, 1), pot(1), pot(CUE_BALL_ID)]);
    expect(outcome.foul).toBe("cue_pocketed");
    expect(outcome.continues).toBe(false);
  });

  
  it("开球进 8 号：重摆，开球权不变", () => {
    const outcome = judge(opening, [hit(CUE_BALL_ID, 1), pot(EIGHT_BALL_ID)]);
    expect(outcome.rerack).toBe(true);
    expect(outcome.winner).toBeNull();
    expect(outcome.foul).toBeNull();
  });

  it("开球同时进 8 号与母球也是重摆 —— 重摆抹掉一切", () => {
    const outcome = judge(opening, [hit(CUE_BALL_ID, 1), pot(EIGHT_BALL_ID), pot(CUE_BALL_ID)]);
    expect(outcome.rerack).toBe(true);
    expect(outcome.winner).toBeNull();
  });

  it("空杆（一颗球没碰到）是废开球", () => {
    expect(judge(opening, []).foul).toBe("illegal_break");
  });

  /**
   * 开球杆判「废开球」而不是「先碰错球」。
   *
   * 开球时台面开放，`legalTargets` 里除 8 号外全是合法目标，所以走常规判罚
   * 逻辑的话，碰到什么都不算错。真正的开球约束是「有没有把球打散」，两者是
   * 完全不同的判据 —— 所以开球必须**单独**一条分支，不能复用常规杆。
   */
  it("开球碰到 8 号不算犯规 —— 开球约束的是散球，不是先碰谁", () => {
    const events = [hit(CUE_BALL_ID, EIGHT_BALL_ID), rail(1), rail(2), rail(3), rail(4)];
    expect(judge(opening, events).foul).toBeNull();
  });
});

// ───────────────────────── 常规杆判罚 ─────────────────────────

describe("billiards/rules 常规杆犯规", () => {
  const solids = midGame({ solidsSeat: 0, turn: 0 });

  it("合法：先碰本组球，之后有球吃库", () => {
    const outcome = judge(solids, [hit(CUE_BALL_ID, 3), rail(3)]);
    expect(outcome.foul).toBeNull();
  });

  it("母球落袋", () => {
    expect(judge(solids, [hit(CUE_BALL_ID, 3), pot(3), pot(CUE_BALL_ID)]).foul).toBe("cue_pocketed");
  });

  it("一颗球都没碰到", () => {
    expect(judge(solids, [rail(CUE_BALL_ID)]).foul).toBe("no_contact");
  });

  it("先碰对方的球", () => {
    expect(judge(solids, [hit(CUE_BALL_ID, 9), rail(9)]).foul).toBe("wrong_first_contact");
  });

  it("本组没清完就先碰 8 号", () => {
    expect(judge(solids, [hit(CUE_BALL_ID, EIGHT_BALL_ID), rail(8)]).foul).toBe("wrong_first_contact");
  });

  it("碰到了但既没进球也没吃库", () => {
    expect(judge(solids, [hit(CUE_BALL_ID, 3)]).foul).toBe("no_rail");
  });

  /**
   * 判罚有优先级，不是把所有犯规都报一遍。
   *
   * 一杆可以同时满足好几条：先碰错球、之后又没吃库、母球还落了袋。玩家只需要
   * 一句话说明为什么这杆废了，报三条只会让人更糊涂。优先级取「最根本的那条」：
   * 母球落袋 > 没碰到 > 碰错 > 没效果。
   */
  it("多重犯规只报最根本的一条", () => {
    // 母球落袋 + 先碰错球 + 没吃库，三条齐了。
    const outcome = judge(solids, [hit(CUE_BALL_ID, 9), pot(CUE_BALL_ID)]);
    expect(outcome.foul).toBe("cue_pocketed");
  });

  it("台面开放时先碰 8 号是犯规 —— 8 号任何时候都不能当开路球", () => {
    const open = midGame({ solidsSeat: null, turn: 0 });
    expect(judge(open, [hit(CUE_BALL_ID, EIGHT_BALL_ID), rail(8)]).foul).toBe("wrong_first_contact");
  });

  it("本组清完后先碰 8 号是合法的", () => {
    const cleared = midGame({ solidsSeat: 0, turn: 0, pocketed: [1, 2, 3, 4, 5, 6, 7] });
    expect(judge(cleared, [hit(CUE_BALL_ID, EIGHT_BALL_ID), rail(8)]).foul).toBeNull();
  });
});

// ───────────────────────── 定组 ─────────────────────────

describe("billiards/rules 定组", () => {
  const open = midGame({ solidsSeat: null, turn: 0 });

  it("台面开放时进球即定组，按本杆第一颗落袋的球", () => {
    const outcome = judge(open, [hit(CUE_BALL_ID, 3), pot(3)]);
    expect(outcome.assigned).toBe("solids");
    expect(shootEvents(open, [hit(CUE_BALL_ID, 3), pot(3)]).solidsSeat).toBe(0);
  });

  /**
   * 一杆同时进两组的球时，定组看**第一颗**落袋的。
   *
   * 这是 `pocketedIn` 必须保序的唯一理由。改成「取编号最小的」之类的写法，
   * 大多数用例察觉不到（一杆进两组球本来就少见），但它会在少数关键杆上把整局
   * 的球组分配搞反 —— 而玩家会认为是外挂。
   */
  it("一杆进两组：第一颗落袋的决定归属", () => {
    expect(judge(open, [hit(CUE_BALL_ID, 9), pot(9), pot(3)]).assigned).toBe("stripes");
    expect(judge(open, [hit(CUE_BALL_ID, 3), pot(3), pot(9)]).assigned).toBe("solids");
  });

  it("犯规杆不定组 —— 台面保持开放", () => {
    const outcome = judge(open, [hit(CUE_BALL_ID, 3), pot(3), pot(CUE_BALL_ID)]);
    expect(outcome.foul).toBe("cue_pocketed");
    expect(outcome.assigned).toBeNull();
    expect(shootEvents(open, [hit(CUE_BALL_ID, 3), pot(3), pot(CUE_BALL_ID)]).solidsSeat).toBeNull();
  });

  it("定组后不再重定 —— 后续进对方的球不改归属", () => {
    const assigned = midGame({ solidsSeat: 0, turn: 0 });
    const outcome = judge(assigned, [hit(CUE_BALL_ID, 3), pot(9)]);
    expect(outcome.assigned).toBeNull();
    expect(shootEvents(assigned, [hit(CUE_BALL_ID, 3), pot(9)]).solidsSeat).toBe(0);
  });

  it("花色定组时，全色归对手", () => {
    const state = shootEvents(open, [hit(CUE_BALL_ID, 9), pot(9)]);
    expect(state.solidsSeat).toBe(1);
    expect(groupOfSeat(state, 0)).toBe("stripes");
  });
});

// ───────────────────────── 续杆 ─────────────────────────

describe("billiards/rules 续杆", () => {
  it("合法进本组球 → 续杆", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    const outcome = judge(state, [hit(CUE_BALL_ID, 3), pot(3)]);
    expect(outcome.continues).toBe(true);
    expect(shootEvents(state, [hit(CUE_BALL_ID, 3), pot(3)]).turn).toBe(0);
  });

  /**
   * 进的是对方的球不续杆 —— 哪怕这一杆本身合法。
   *
   * 「先碰自己的球、结果把对方的球撞进去了」是合法的（没有报袋制度），但它
   * 帮的是对手，没有理由奖励续杆。写成「进球就续杆」的话，专门去撞对方的球
   * 反而能一直续下去。
   */
  it("只进了对方的球 → 不续杆", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    const outcome = judge(state, [hit(CUE_BALL_ID, 3), pot(9)]);
    expect(outcome.foul).toBeNull();
    expect(outcome.continues).toBe(false);
    expect(shootEvents(state, [hit(CUE_BALL_ID, 3), pot(9)]).turn).toBe(1);
  });

  it("一杆同时进两组的球，只要有自己的就续杆", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    expect(judge(state, [hit(CUE_BALL_ID, 3), pot(9), pot(3)]).continues).toBe(true);
  });

  it("空杆不续杆", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    expect(judge(state, [hit(CUE_BALL_ID, 3), rail(3)]).continues).toBe(false);
  });

  /**
   * 犯规**永不**续杆，哪怕同时进了自己的球。
   *
   * 「进了自己的球 + 母球也落袋」在实战里很常见（打薄了跟着进袋）。写成
   * 「进球就续杆」的话，这一杆既得分又不换人，等于犯规没有任何代价。
   */
  it("犯规不续杆 —— 哪怕同时进了自己的球", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    const outcome = judge(state, [hit(CUE_BALL_ID, 3), pot(3), pot(CUE_BALL_ID)]);
    expect(outcome.foul).toBe("cue_pocketed");
    expect(outcome.continues).toBe(false);
  });

  it("台面开放时进球定组并续杆 —— 用的是这一杆刚定下的组", () => {
    const open = midGame({ solidsSeat: null, turn: 0 });
    // 定组前 groupOfSeat 是 null，若续杆判定读的是「击球前的组」，这里会误判不续杆。
    expect(groupOfSeat(open, 0)).toBeNull();
    expect(judge(open, [hit(CUE_BALL_ID, 3), pot(3)]).continues).toBe(true);
  });
});

// ───────────────────────── 终局 ─────────────────────────

describe("billiards/rules 8 号球终局", () => {
  const cleared = midGame({ solidsSeat: 0, turn: 0, pocketed: [1, 2, 3, 4, 5, 6, 7] });

  it("清台后合法打进 8 号 → 赢", () => {
    const outcome = judge(cleared, [hit(CUE_BALL_ID, EIGHT_BALL_ID), pot(EIGHT_BALL_ID)]);
    expect(outcome.winner).toBe(0);
    expect(shootEvents(cleared, [hit(CUE_BALL_ID, EIGHT_BALL_ID), pot(EIGHT_BALL_ID)]).winner).toBe(0);
  });

  /**
   * 本组没清完就进 8 号 → **判负**，不是犯规。
   *
   * 这是八球里唯一一条「后果不是持球在手」的规则。写成普通犯规的话，落后的
   * 一方可以故意把 8 号打进去，代价只是对方持球在手 —— 而这时候局面本来就
   * 已经输了，等于免费重开。
   */
  it("本组没清完就进 8 号 → 判负", () => {
    const notCleared = midGame({ solidsSeat: 0, turn: 0, pocketed: [1, 2] });
    const outcome = judge(notCleared, [hit(CUE_BALL_ID, 3), pot(EIGHT_BALL_ID)]);
    expect(outcome.winner).toBe(1);
  });

  it("清台了但这一杆犯规（母球跟着落袋）→ 判负", () => {
    const outcome = judge(cleared, [
      hit(CUE_BALL_ID, EIGHT_BALL_ID),
      pot(EIGHT_BALL_ID),
      pot(CUE_BALL_ID),
    ]);
    expect(outcome.foul).toBe("cue_pocketed");
    expect(outcome.winner).toBe(1);
  });

  it("清台了但先碰的是对方的球 → 判负", () => {
    const outcome = judge(cleared, [hit(CUE_BALL_ID, 9), hit(9, EIGHT_BALL_ID), pot(EIGHT_BALL_ID)]);
    expect(outcome.foul).toBe("wrong_first_contact");
    expect(outcome.winner).toBe(1);
  });

  /**
   * 「清完」的判据取**这一杆之前**的剩余球，不是之后。
   *
   * 取之后的话，「最后一颗本组球和 8 号同一杆进袋」会被判成赢 —— 而按规则那是
   * 输：8 号必须是**单独**的最后一杆。这个差别只在一种情形下显现，写错了几乎
   * 不可能靠随机对局发现。
   */
  it("最后一颗本组球与 8 号同杆落袋 → 判负，不是赢", () => {
    const oneLeft = midGame({ solidsSeat: 0, turn: 0, pocketed: [1, 2, 3, 4, 5, 6] });
    expect(remainingOfGroup(oneLeft, "solids")).toEqual([7]);
    const outcome = judge(oneLeft, [hit(CUE_BALL_ID, 7), pot(7), pot(EIGHT_BALL_ID)]);
    expect(outcome.winner).toBe(1);
  });

  it("台面开放时进 8 号 → 判负（连组都没定，谈不上清完）", () => {
    const open = midGame({ solidsSeat: null, turn: 0 });
    expect(judge(open, [hit(CUE_BALL_ID, 3), pot(EIGHT_BALL_ID)]).winner).toBe(1);
  });

  it("8 号落袋后不再续杆，也不定组", () => {
    const outcome = judge(cleared, [hit(CUE_BALL_ID, EIGHT_BALL_ID), pot(EIGHT_BALL_ID)]);
    expect(outcome.continues).toBe(false);
    expect(outcome.assigned).toBeNull();
  });

  it("座位 1 清台赢下时 winner 是 1 —— 不是硬编码的 0", () => {
    const seat1 = midGame({ solidsSeat: 1, turn: 1, pocketed: [1, 2, 3, 4, 5, 6, 7] });
    expect(judge(seat1, [hit(CUE_BALL_ID, EIGHT_BALL_ID), pot(EIGHT_BALL_ID)]).winner).toBe(1);
  });
});

// ───────────────────────── 状态推进 ─────────────────────────

describe("billiards/rules 判罚落到状态上", () => {
  it("犯规 → 换人且对方持球在手", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    const after = shootEvents(state, [rail(CUE_BALL_ID)]);
    expect(after.turn).toBe(1);
    expect(after.ballInHand).toBe(true);
  });

  it("合法杆不给持球在手", () => {
    const state = midGame({ solidsSeat: 0, turn: 0 });
    expect(shootEvents(state, [hit(CUE_BALL_ID, 3), rail(3)]).ballInHand).toBe(false);
  });

  /**
   * 持球在手是**一次性**的，不会顺延。
   *
   * 从一个 `ballInHand: true` 的状态打一杆合法球之后，它必须变回 false。
   * 写成 `ballInHand: before.ballInHand || foul !== null` 之类的话，一次犯规
   * 就是永久的持球在手 —— 而这在正常对局里要好几杆之后才会显现。
   */
  it("上一杆的持球在手不顺延到下一杆", () => {
    const inHand = midGame({ solidsSeat: 0, turn: 0, ballInHand: true });
    expect(shootEvents(inHand, [hit(CUE_BALL_ID, 3), rail(3)]).ballInHand).toBe(false);
  });

  it("开球后 broken 置真", () => {
    const after = shootEvents(rackEightBall(0), [hit(CUE_BALL_ID, 1), pot(1)]);
    expect(after.broken).toBe(true);
  });

  it("重摆回到干净开局，且开球权不变", () => {
    const after = shootEvents(rackEightBall(1), [hit(CUE_BALL_ID, 1), pot(EIGHT_BALL_ID)]);
    expect(after.turn).toBe(1);
    expect(after.broken).toBe(false);
    expect(after.solidsSeat).toBeNull();
    expect(after.table.balls.every((b) => !b.pocketed)).toBe(true);
  });
});

// ───────────────────────── 持球在手 ─────────────────────────

describe("billiards/rules 持球在手", () => {
  const inHand = midGame({ solidsSeat: 0, turn: 0, ballInHand: true, pocketed: [CUE_BALL_ID] });

  it("没有持球在手时不能摆球", () => {
    const normal = midGame({ solidsSeat: 0, turn: 0 });
    const result = placeCueBall(normal, vec2(ZERO, ZERO));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("not_in_hand");
  });

  it("摆到台面正中：合法，且母球从袋里回到台面", () => {
    const result = placeCueBall(inHand, vec2(ZERO, ZERO));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cue = cueBallOf(result.state);
    expect(cue?.pocketed).toBe(false);
    expect(f(vLen(cue!.vel))).toBe(0);
    expect(cue!.spinZ).toBe(ZERO);
  });

  it("摆完球权利即消耗 —— 否则可以摆一次、打一杆、不满意再摆", () => {
    const result = placeCueBall(inHand, vec2(ZERO, ZERO));
    expect(result.ok && result.state.ballInHand).toBe(false);
  });

  /**
   * 摆放范围是「球心距库边至少一个半径」，不是「球心在台面矩形内」。
   *
   * 后者允许把球心摆到库边线上 —— 球有一半嵌在库里。下一拍 solver 的库边碰撞
   * 会把它推出来，位置对不上，而两端各自推的结果**未必相同**（推出深度依赖
   * 有符号距离，见 solver.ts 的注释），这就是演算分叉。
   */
  it("球心必须距库边至少一个半径", () => {
    expect(withinPlacementBounds(vec2(ZERO, ZERO))).toBe(true);
    // 恰好一个半径：合法。
    expect(withinPlacementBounds(vec2(sub(HALF_LENGTH, BALL_RADIUS), ZERO))).toBe(true);
    // 再往外一个最低位：不合法。
    expect(withinPlacementBounds(vec2(add(sub(HALF_LENGTH, BALL_RADIUS), 1), ZERO))).toBe(false);
    // 球心贴在库边线上：球有一半在库里。
    expect(withinPlacementBounds(vec2(HALF_LENGTH, ZERO))).toBe(false);
    expect(withinPlacementBounds(vec2(ZERO, HALF_WIDTH))).toBe(false);
  });

  it("越界摆放被拒", () => {
    const result = placeCueBall(inHand, vec2(HALF_LENGTH, ZERO));
    expect(result.ok === false && result.reason).toBe("off_table");
  });

  /**
   * 袋口检查**不是**冗余的。
   *
   * 直觉上「在台面范围内」应该已经排除了袋口 —— 并不。袋口半径（0.0571 / 0.0635）
   * 比球半径（0.0286）大一倍，捕获圈从袋心往台内伸进来的距离远超一个球半径。
   * 探针实测：(0, 半宽−半径) 这个点既满足 `withinPlacementBounds`，又落在 5 号
   * 中袋的捕获圈里。少了这条检查，玩家可以直接把母球摆进袋 —— 下一拍立刻判入袋，
   * 又是一次犯规、又给对方持球在手，无限循环。
   */
  it("不能摆进袋口捕获圈 —— 它伸进台面的距离超过一个球半径", () => {
    const insideSidePocket = vec2(ZERO, sub(HALF_WIDTH, BALL_RADIUS));
    // 先证明这个点确实同时满足「在界内」和「在袋里」，否则这条用例测的是别的东西。
    expect(withinPlacementBounds(insideSidePocket)).toBe(true);
    expect(pocketAt(insideSidePocket)).not.toBeNull();

    const result = placeCueBall(inHand, insideSidePocket);
    expect(result.ok === false && result.reason).toBe("in_pocket");
  });

  it("每个袋口的捕获圈都挡得住 —— 六个袋逐个验", () => {
    for (let i = 0; i < POCKETS.length; i += 1) {
      const result = placeCueBall(inHand, POCKETS[i].center);
      // 角袋中心在界外，中袋中心也在界外（y = ±半宽）；两种拒绝都算挡住了。
      expect(result.ok, `袋 ${i} 的中心不该能摆球`).toBe(false);
    }
  });

  it("不能摆在其他球上", () => {
    const one = inHand.table.balls.find((b) => b.id === 1)!;
    const result = placeCueBall(inHand, one.pos);
    expect(result.ok === false && result.reason).toBe("overlapping");
  });

  /**
   * 重叠判据是**球心距小于一个直径**，与 `overlapping` 同口径。
   *
   * 用半径当阈值的话，两球球心距在半径与直径之间时判为合法 —— 那正是**真实
   * 重叠**的整个区间。摆完球 solver 的 `resolvePair` 会立刻把两球推开，位置
   * 与玩家看到的不一致，且两端推的结果依赖各自的截断。
   */
  it("重叠边界：恰好一个直径合法，差一个最低位就不合法", () => {
    const one = inHand.table.balls.find((b) => b.id === 1)!;
    const atDiameter = vec2(sub(one.pos.x, BALL_DIAMETER), one.pos.y);
    expect(f(vLen(vSub(one.pos, atDiameter)))).toBeCloseTo(f(BALL_DIAMETER), 6);
    expect(placeCueBall(inHand, atDiameter).ok).toBe(true);

    const oneRawInside = vec2(sub(one.pos.x, BALL_DIAMETER - 1), one.pos.y);
    const rejected = placeCueBall(inHand, oneRawInside);
    expect(rejected.ok === false && rejected.reason).toBe("overlapping");
  });

  it("已入袋的球不挡摆放 —— 它的位置只是动画残留", () => {
    const three = inHand.table.balls.find((b) => b.id === 3)!;
    const potted = midGame({
      solidsSeat: 0,
      turn: 0,
      ballInHand: true,
      pocketed: [CUE_BALL_ID, 3],
    });
    // 同一个位置：3 号在台面上时挡，入袋后不挡。
    expect(placeCueBall(inHand, three.pos).ok).toBe(false);
    expect(placeCueBall(potted, three.pos).ok).toBe(true);
  });
});

// ───────────────────────── 与解算器的接缝 ─────────────────────────

describe("billiards/rules 与解算器的接缝（真实击球）", () => {
  /**
   * 这一段是唯一走真实物理的。它验证的不是规则，而是**接线**：
   * solver 的事件确实到了 judge 手里、judge 的结论确实落到了状态上。
   *
   * 断言刻意宽松（只看「合法」「换人了」这种粗粒度结论），不钉具体进了哪颗球 ——
   * 那属于物理，物理系数动一位就会变，钉死了只会得到一个每次改物理都要重写的
   * 用例，而它红的时候说明不了任何规则问题。
   */
  it("正常力度开球：合法、broken 置真、球被打散", () => {
    const result = shoot(rackEightBall(0), {
      angle: 0,
      power: fromInt(7),
      offsetX: ZERO,
      offsetY: ZERO,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.foul).toBeNull();
    expect(result.state.broken).toBe(true);
    expect(result.outcome.firstContact).not.toBeNull();
    expect(distinctRailBalls(result.events)).toBeGreaterThanOrEqual(BREAK_RAIL_REQUIREMENT);
    // 球堆确实散开了：至少有一颗球离开了原位。
    const before = rackEightBall(0).table.balls;
    const moved = result.state.table.balls.filter(
      (b, i) => b.pos.x !== before[i].pos.x || b.pos.y !== before[i].pos.y,
    );
    expect(moved.length).toBeGreaterThan(1);
  });

  /**
   * 轻杆开球是废开球。
   *
   * 这条同时验证了两件事：`illegal_break` 这个分支在真实物理下**可达**（不是
   * 只能靠手工事件构造出来的死分支），以及 shoot 确实把 `broken: false` 的
   * 状态送进了开球分支。探针实测 power = 0.5 时母球连球堆都碰不到。
   */
  it("轻杆开球：废开球，且换人", () => {
    const result = shoot(rackEightBall(0), {
      angle: 0,
      power: fromRatio(1, 2),
      offsetX: ZERO,
      offsetY: ZERO,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.foul).toBe("illegal_break");
    expect(result.state.turn).toBe(1);
    expect(result.state.ballInHand).toBe(true);
  });

  it("背对球堆开球：碰不到球堆，仍是废开球", () => {
    const result = shoot(rackEightBall(0), {
      angle: BRAD_HALF,
      power: fromInt(3),
      offsetX: ZERO,
      offsetY: ZERO,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.foul).toBe("illegal_break");
  });

  /**
   * 同样的参数打两次，结果必须逐位相同。
   *
   * 这是「不传状态、传输入」整个同步方案的前提。solver 那边已经测过确定性，
   * 但规则层引入了 `Set`、`Array.filter`、对象展开 —— 任何一处若引入了迭代
   * 顺序依赖或共享可变状态，同步就废了。这条从最外层再钉一次。
   */
  it("同参数两次击球结果逐位相同 —— 规则层不能引入任何不确定性", () => {
    const params = { angle: 1234, power: fromInt(6), offsetX: fromRatio(1, 4), offsetY: ZERO };
    const a = shoot(rackEightBall(0), params);
    const b = shoot(rackEightBall(0), params);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.state.table).toEqual(b.state.table);
    expect(a.events).toEqual(b.events);
    expect(a.outcome).toEqual(b.outcome);
  });

  /**
   * 判罚喂给 `judge` 的必须是**击球前**的状态。
   *
   * `judge` 判「先碰到的球合不合法」要查 `legalTargets`，而合法目标是从台面上
   * **还剩哪些球**推出来的。若把演算后的末态喂进去，刚刚被打进的那颗球已经不在
   * 台面上了，于是「我打进了自己的球」会被判成 `wrong_first_contact` —— 打得
   * 越准罚得越狠，而且只在**进球**时才错，不进球的用例全是绿的。
   *
   * 几何是探针实测出来的：3 号球正对右下角袋，母球在其左后方偏上，切球把 3 号
   * 送进袋而母球自己不跟进。断言只钉「合法、续杆、3 号进了」这三条粗粒度结论。
   */
  it("判罚看击球前的台面 —— 打进自己的球不该被判打错球", () => {
    const corner = POCKETS.find((p) => f(p.center.x) > 0 && f(p.center.y) < 0)!;
    const target = vec2(sub(corner.center.x, fromRatio(25, 100)), corner.center.y);
    const cuePos = vec2(sub(target.x, fromRatio(50, 100)), add(target.y, fromRatio(4, 100)));
    const state: EightBallState = {
      table: {
        balls: [
          makeBall(CUE_BALL_ID, cuePos),
          makeBall(3, target),
          makeBall(5, vec2(ZERO, ZERO)),
        ],
      },
      turn: 0,
      solidsSeat: 0,
      broken: true,
      ballInHand: false,
      winner: null,
    };

    const result = shoot(state, { angle: -200, power: fromInt(3), offsetX: ZERO, offsetY: ZERO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.firstContact).toBe(3);
    expect(result.outcome.pocketed).toContain(3);
    expect(result.outcome.pocketed).not.toContain(CUE_BALL_ID);
    expect(result.outcome.foul).toBeNull();
    // 进了自己的球 ⇒ 续杆，不换人。
    expect(result.outcome.continues).toBe(true);
    expect(result.state.turn).toBe(0);
    expect(result.state.ballInHand).toBe(false);
  });

  it("终局后不能再击球", () => {
    const finished = midGame({ solidsSeat: 0, turn: 0, winner: 0 });
    const result = shoot(finished, { angle: 0, power: fromInt(5), offsetX: ZERO, offsetY: ZERO });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("game_over");
  });

  /**
   * 母球在袋里时必须先摆球。
   *
   * 不拦的话 `strike` 会对一颗 `pocketed` 的球设速度 —— 而 strike 里有
   * `!b.pocketed` 的守卫，于是什么都不会发生：一杆打出去，零事件，判罚成
   * 「没碰到球」，又一次犯规。玩家会卡在「每次击球都犯规」的死循环里。
   */
  it("母球在袋里时拒绝击球，摆球后恢复", () => {
    const scratched = midGame({
      solidsSeat: 0,
      turn: 0,
      ballInHand: true,
      pocketed: [CUE_BALL_ID],
    });
    const rejected = shoot(scratched, { angle: 0, power: fromInt(5), offsetX: ZERO, offsetY: ZERO });
    expect(rejected.ok === false && rejected.reason).toBe("place_cue_first");

    const placed = placeCueBall(scratched, vec2(ZERO, ZERO));
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(shoot(placed.state, { angle: 0, power: fromInt(5), offsetX: ZERO, offsetY: ZERO }).ok).toBe(true);
  });

  /**
   * 母球按 **id** 查，不按下标。
   *
   * 开局摆球时 id 与下标恰好相同，于是 `balls[CUE_BALL_ID]` 能一路绿到线上。
   * 这条用例把数组倒过来，让两者分离：按下标写的话拿到的是 15 号球，母球
   * 永远找不到，而所有正常用例仍然全绿。
   */
  it("母球按 id 查而非下标 —— 数组重排后仍能找到", () => {
    const base = midGame({ solidsSeat: 0, turn: 0 });
    const reversed: EightBallState = {
      ...base,
      table: { balls: [...base.table.balls].reverse() },
    };
    expect(reversed.table.balls[CUE_BALL_ID].id).not.toBe(CUE_BALL_ID);
    expect(cueBallOf(reversed)?.id).toBe(CUE_BALL_ID);
  });
});

/**
 * 走完整路径：judge 出结论，applyOutcome 搬状态。
 *
 * 两个都是实现里的**真函数**。最初这里写的是「judge 出结论，然后测试自己
 * 手工搬一遍状态」—— 那等于在测试里重写一份 applyOutcome 当基准，实现里那份
 * 错了照样全绿。这是 solver 的 M49（用被测函数自身造基准）的镜像版本：
 * 用测试重写的副本造基准，同样验证不了任何东西。改法是把 applyOutcome 导出。
 *
 * 末态直接沿用击球前的球桌 —— 这些用例验证的是判罚结论到状态字段的映射，
 * 球滚到哪里由 solver 负责，与这里无关。
 */
function shootEvents(before: EightBallState, events: BilliardsEvent[]): EightBallState {
  return applyOutcome(before, before.table, judge(before, events));
}
