

import { ZERO, abs, sub } from "./fixed";
import { VEC2_ZERO, vLen, vSub } from "./vec";
import type { Vec2 } from "./vec";
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  HALF_LENGTH,
  HALF_WIDTH,
  pocketAt,
} from "./table";
import type { Ball, TableState } from "./ball";
import {
  CUE_BALL_ID,
  MAX_TICKS,
  rackBalls,
  simulate,
  simulateWithTimeline,
  strike,
} from "./solver";
import type { BilliardsEvent, StrikeParams } from "./solver";

/** 8 号球的编号。它既不属于全色也不属于花色，是终局球。 */
export const EIGHT_BALL_ID = 8;

/** 一副球的总数：母球 + 15 颗目标球。 */
export const BALL_COUNT = 16;

/** 球组。全色 1~7，花色 9~15。 */
export type BallGroup = "solids" | "stripes";

/** 某颗球属于哪一组。母球与 8 号都不属于任何一组。 */
export function groupOfBall(id: number): BallGroup | null {
  if (id >= 1 && id <= 7) return "solids";
  if (id >= 9 && id <= 15) return "stripes";
  return null;
}

/** 另一组。 */
export function otherGroup(group: BallGroup): BallGroup {
  return group === "solids" ? "stripes" : "solids";
}

// ───────────────────────── 状态 ─────────────────────────

/**
 * 一局八球的完整状态。
 *
 * **不存「我这一方是全色还是花色」两份。** 只存「全色归哪个座位」，另一个座位
 * 的球组由 {@link groupOfSeat} 推出。两处各存一份必然有一天对不上 —— 围棋的
 * view.ts 已经在 `toPlay` 与 `activeSeat` 上踩过这个坑。
 *
 * 同理不存 `phase`：开球前后看 `broken`，定组与否看 `solidsSeat`，终局看
 * `winner`，三个布尔组合出来的「阶段」不必再存一份。
 */
export interface EightBallState {
  readonly table: TableState;
  /** 该谁击球。两个座位：0 与 1。 */
  readonly turn: number;
  /** 全色归属的座位。`null` 表示台面仍是**开放**的（未定组）。 */
  readonly solidsSeat: number | null;
  /** 是否已经开过球。开球杆的判罚口径与常规杆不同。 */
  readonly broken: boolean;
  /**
   * 当前击球方是否持球在手（自由摆放母球）。
   *
   * 犯规的唯一后果就是它。注意「持球在手」是**权利**不是义务：只有母球落袋时
   * 才**必须**先摆球再击球（球不在台面上，无从击起）。
   */
  readonly ballInHand: boolean;
  /** 胜者座位。`null` 表示未终局。 */
  readonly winner: number | null;
}

/** 座位的球组。台面开放时为 `null`。 */
export function groupOfSeat(
  state: EightBallState,
  seat: number,
): BallGroup | null {
  if (state.solidsSeat === null) return null;
  return state.solidsSeat === seat ? "solids" : "stripes";
}

/**
 * 开球摆法。
 *
 * 八球的摆法有硬性约束，不是随便填 1~15：
 *
 * - **8 号必须在第三排正中**；
 * - **底排两角一全一花**。
 *
 * 摆错了是可以被对手要求重摆的，而摆法一旦写死在代码里，错了每一局都错。
 * 位置本身复用 `rackBalls()`（它负责三角形的几何与余量），这里只负责把编号
 * 填进槽位。槽位序：第 0 排 1 颗、第 1 排 2 颗……第 4 排 5 颗，共 15 个。
 */
export const RACK_ORDER: readonly number[] = [
  1,
  9,
  2,
  10,
  EIGHT_BALL_ID,
  3,
  11,
  4,
  12,
  5,
  6,
  13,
  7,
  14,
  15,
];

/** 底排两角在 {@link RACK_ORDER} 里的槽位。 */
export const RACK_BACK_CORNERS: readonly [number, number] = [10, 14];

/** 第三排正中的槽位 —— 8 号球的位置。 */
export const RACK_EIGHT_SLOT = 4;

/**
 * 摆好一局八球的开局状态。
 *
 * `rackBalls()` 给出的球按下标顺序编号（1..15），八球需要的是按 {@link RACK_ORDER}
 * 重新编号。**只改 `id`，不动位置** —— 位置里的余量是 rackBalls 精心留的（见那边
 * 的注释），照抄就是。
 *
 * 球在数组里仍按 id 升序排列：solver.ts 的球对遍历是按**下标**升序的，下标与
 * id 一一对应才能让「事件里的 id」和「遍历顺序」是同一件事。
 */
export function rackEightBall(breaker = 0): EightBallState {
  const racked = rackBalls();
  const balls: Ball[] = [racked.balls[0]];
  for (let slot = 0; slot < RACK_ORDER.length; slot += 1) {
    balls.push({ ...racked.balls[slot + 1], id: RACK_ORDER[slot] });
  }
  balls.sort((a, b) => a.id - b.id);

  return {
    table: { balls },
    turn: breaker,
    solidsSeat: null,
    broken: false,
    ballInHand: false,
    winner: null,
  };
}

/** 台面上还剩哪些球（按 id 升序）。已入袋的不算。 */
export function remainingBalls(state: EightBallState): number[] {
  return state.table.balls.filter((b) => !b.pocketed).map((b) => b.id);
}

/** 某一组还剩几颗。清完自己这一组才轮到 8 号。 */
export function remainingOfGroup(
  state: EightBallState,
  group: BallGroup,
): number[] {
  return state.table.balls
    .filter((b) => !b.pocketed && groupOfBall(b.id) === group)
    .map((b) => b.id);
}

/**
 * 这一杆母球**必须先碰到**的球。
 *
 * 三种情形：
 *
 * - 台面开放（含开球）：除 8 号外的任何目标球都行；
 * - 已定组且本组未清完：只能先碰本组的球；
 * - 已定组且本组已清完：只能先碰 8 号。
 *
 * 界面拿它做瞄准提示，机器人拿它挑目标，判罚拿它定犯规 —— 三处必须是同一个
 * 函数，各写一遍必然分歧。
 */
export function legalTargets(state: EightBallState, seat: number): number[] {
  const group = groupOfSeat(state, seat);
  if (group === null) {
    return remainingBalls(state).filter(
      (id) => id !== CUE_BALL_ID && id !== EIGHT_BALL_ID,
    );
  }
  const own = remainingOfGroup(state, group);
  return own.length > 0 ? own : [EIGHT_BALL_ID];
}

/**
 * 台面上的母球。
 *
 * 按 **id** 查而不是按下标 `balls[CUE_BALL_ID]`。两者在开局摆球时恰好相同，
 * 于是按下标写的代码能一路绿到线上 —— 直到某个地方（比如把入袋的球移出数组、
 * 或者按某种顺序重排以便渲染）打破了这个巧合，此后「母球」指向的是 1 号球，
 * 而所有判罚都还是绿的，因为绝大多数用例里母球本来就在 0 位。
 */
export function cueBallOf(state: EightBallState): Ball | undefined {
  return state.table.balls.find((b) => b.id === CUE_BALL_ID);
}

// ───────────────────────── 判罚 ─────────────────────────

/** 犯规类型。后果统一是「对方持球在手」，区分只为了给玩家一句人话。 */
export type Foul =
  /** 母球落袋。 */
  | "cue_pocketed"
  /** 母球一颗球都没碰到。 */
  | "no_contact"
  /** 母球先碰到的不是该碰的球。 */
  | "wrong_first_contact"
  /** 碰到了，但之后既没进球也没有任何球吃库 —— 「做安全球」的下限。 */
  | "no_rail"
  /** 开球既没进球也没有四颗球吃库。 */
  | "illegal_break";

/** 一杆的判罚结论。 */
export interface ShotOutcome {
  /** 犯规类型。`null` 表示这是一杆合法击球。 */
  readonly foul: Foul | null;
  /** 本杆落袋的球，**按落袋先后**排列。定组要看这个顺序。 */
  readonly pocketed: readonly number[];
  /** 母球第一颗碰到的球。一颗没碰到为 `null`。 */
  readonly firstContact: number | null;
  /** 击球方是否继续拥有击球权。 */
  readonly continues: boolean;
  /** 是否需要重新摆球（开球进了 8 号）。 */
  readonly rerack: boolean;
  /** 本杆是否定了组。定组时给出击球方拿到的那一组。 */
  readonly assigned: BallGroup | null;
  readonly winner: number | null;
}

/**
 * 母球第一次碰到的球。
 *
 * 事件里 `a` 恒小于 `b`（solver 的球对遍历是 i&lt;j），而母球 id 为 0、下标也为 0，
 * 所以母球出现时一定在 `a` 位。这里仍然两边都查：这个不变量属于 solver 的内部
 * 实现，规则层不该依赖它 —— 依赖了，哪天 solver 改成按 id 排序广播，这里会
 * 静默地永远返回 `null`（母球再也匹配不上），而所有「先碰谁」的判罚随之失效，
 * 且**测试全绿**，因为大部分用例根本不触发犯规。
 */
export function firstContactOf(
  events: readonly BilliardsEvent[],
): number | null {
  for (const event of events) {
    if (event.kind !== "ball-hit") continue;
    if (event.a === CUE_BALL_ID) return event.b;
    if (event.b === CUE_BALL_ID) return event.a;
  }
  return null;
}

/** 本杆落袋的球，按落袋先后。 */
export function pocketedIn(events: readonly BilliardsEvent[]): number[] {
  return events.filter((e) => e.kind === "pocketed").map((e) => e.ball);
}

/**
 * 母球触到目标球**之后**，是否有球进袋或吃库。
 *
 * 这是「击球必须有效果」那条规则的落地：碰一下就停，双方可以互相磨到天荒地老。
 * 判据必须从第一次接触**之后**开始数 —— 母球在碰到目标球之前先吃了库（长台回球
 * 是常规打法）不能拿来充数，那一下发生在接触之前，不能证明这一杆有效。
 */
export function railOrPocketAfterContact(
  events: readonly BilliardsEvent[],
): boolean {
  const start = events.findIndex(
    (e) =>
      e.kind === "ball-hit" && (e.a === CUE_BALL_ID || e.b === CUE_BALL_ID),
  );
  if (start < 0) return false;
  return events
    .slice(start + 1)
    .some((e) => e.kind === "cushion-hit" || e.kind === "pocketed");
}

/** 开球合法性要求的吃库球数。四颗**不同**的球碰到库边。 */
export const BREAK_RAIL_REQUIREMENT = 4;

/** 有多少颗**不同**的球吃过库。开球合法性判据。 */
export function distinctRailBalls(events: readonly BilliardsEvent[]): number {
  const seen = new Set<number>();
  for (const event of events) {
    if (event.kind === "cushion-hit") seen.add(event.ball);
  }
  return seen.size;
}

// ───────────────────────── 击球 ─────────────────────────

/** 击球被拒的原因。合法性由这一层裁定，界面只负责显示。 */
export type ShotRejection = "game_over" | "place_cue_first";

export type ShotResult =
  | { readonly ok: false; readonly reason: ShotRejection }
  | {
      readonly ok: true;
      readonly state: EightBallState;
      readonly events: readonly BilliardsEvent[];
      readonly frames: readonly TableState[];
      readonly outcome: ShotOutcome;
    };

/**
 * 击一杆，演算到静止，然后判罚。
 *
 * 这是规则层唯一的状态推进入口。三件事绑在一起（击球 → 演算 → 判罚）而不是
 * 拆成三个导出函数，理由与 solver.ts 里 `resolvePair` 合并三步相同：调用方
 * 拿不到中间态，也就无从跳过判罚直接改状态。
 */
export function shoot(
  state: EightBallState,
  params: StrikeParams,
  withTimeline = false,
): ShotResult {
  if (state.winner !== null) {
    return { ok: false, reason: "game_over" };
  }
  const cue = cueBallOf(state);
  if (cue === undefined || cue.pocketed) {
    // 母球不在台面上，无从击起。必须先 placeCueBall。
    return { ok: false, reason: "place_cue_first" };
  }

  const struck = strike(state.table, CUE_BALL_ID, params);
  const simulation = withTimeline
    ? simulateWithTimeline(struck, MAX_TICKS)
    : { ...simulate(struck, MAX_TICKS), frames: [] };
  const { state: settled, events, frames } = simulation;
  const outcome = judge(state, events);

  return {
    ok: true,
    state: applyOutcome(state, settled, outcome),
    events,
    frames,
    outcome,
  };
}

/**
 * 判罚一杆。
 *
 * 单独导出是为了能直接喂手工构造的事件序列 —— 犯规组合有十几种，靠摆球打出来
 * 逐一复现既慢又脆（球差半毫米结果就变了）。判罚是纯函数，就该按纯函数测。
 */
export function judge(
  before: EightBallState,
  events: readonly BilliardsEvent[],
): ShotOutcome {
  const shooter = before.turn;
  const pocketed = pocketedIn(events);
  const firstContact = firstContactOf(events);
  const cueScratched = pocketed.includes(CUE_BALL_ID);
  const eightPocketed = pocketed.includes(EIGHT_BALL_ID);

  // —— 开球杆 ——
  if (!before.broken) {
    if (eightPocketed) {
      // 开球进 8：重摆，谁开还是谁开。母球是否同时落袋都不影响，重摆抹掉一切。
      return {
        foul: null,
        pocketed,
        firstContact,
        continues: true,
        rerack: true,
        assigned: null,
        winner: null,
      };
    }
    // 母球不算「进球」。这一句在当前判罚下其实**改不动结论**：唯一能让它生效的
    // 情形是母球落袋，而那时 `cueScratched` 已经把 foul 钉成 cue_pocketed，
    // `continues` 又以 `foul === null` 为前提，两个下游都被短路了。留着是因为
    // `objectPocketed` 是「进了几颗目标球」这个**概念**，一旦以后有人拿它去写
    // 「开球进球数」的统计或续杆口径，少这一句就会把母球算进去。
    const objectPocketed = pocketed.filter((id) => id !== CUE_BALL_ID);
    const legalBreak =
      objectPocketed.length > 0 ||
      distinctRailBalls(events) >= BREAK_RAIL_REQUIREMENT;
    const foul: Foul | null = cueScratched
      ? "cue_pocketed"
      : legalBreak
        ? null
        : "illegal_break";
    return {
      foul,
      pocketed,
      firstContact,
      // 开球即使进了球也**不定组**（WPA 口径：开球后台面开放）。
      continues: foul === null && objectPocketed.length > 0,
      rerack: false,
      assigned: null,
      winner: null,
    };
  }

  // —— 常规杆：先定犯规 ——
  const targets = legalTargets(before, shooter);
  const foul: Foul | null = cueScratched
    ? "cue_pocketed"
    : firstContact === null
      ? "no_contact"
      : !targets.includes(firstContact)
        ? "wrong_first_contact"
        : !railOrPocketAfterContact(events)
          ? "no_rail"
          : null;

  // —— 8 号落袋即终局，判胜负而不是判继续 ——
  if (eightPocketed) {
    const ownGroup = groupOfSeat(before, shooter);
    const clearedBefore =
      ownGroup !== null && remainingOfGroup(before, ownGroup).length === 0;
    // 合法赢下必须三条同时成立：本组**在这一杆之前**已清完、这一杆不犯规、
    // 母球没落袋。最后一条已经含在 foul 里，写出来是为了让条件读得出意图。
    const won = clearedBefore && foul === null && !cueScratched;
    return {
      foul,
      pocketed,
      firstContact,
      continues: false,
      rerack: false,
      assigned: null,
      winner: won ? shooter : otherSeat(shooter),
    };
  }

  // —— 定组：台面开放时，本杆第一颗落袋的目标球决定归属 ——
  let assigned: BallGroup | null = null;
  if (before.solidsSeat === null && foul === null) {
    for (const id of pocketed) {
      const group = groupOfBall(id);
      if (group !== null) {
        assigned = group;
        break;
      }
    }
  }

  // —— 是否续杆 ——
  const groupAfter = assigned ?? groupOfSeat(before, shooter);
  const pocketedOwn =
    groupAfter !== null &&
    pocketed.some((id) => groupOfBall(id) === groupAfter);

  return {
    foul,
    pocketed,
    firstContact,
    continues: foul === null && pocketedOwn,
    rerack: false,
    assigned,
    winner: null,
  };
}

/** 另一个座位。八球只有两个座位，写成函数是为了不到处出现 `1 - seat`。 */
export function otherSeat(seat: number): number {
  return seat === 0 ? 1 : 0;
}

/**
 * 把判罚结论套用到状态上。
 *
 * 与 `judge` 分开：`judge` 只看事件，`applyOutcome` 只搬状态，两者都不必知道
 * 对方是怎么算的。犯规的唯一后果在这里 —— 换人 + 对方持球在手。
 *
 * 导出是为了让测试能喂手工构造的 `outcome`。不导出的话测试只能在自己那边重写
 * 一份「结论怎么变成状态」的逻辑，然后拿它当基准 —— 那验证的是测试自己写的
 * 那份，实现里这一份错了照样全绿。同一个坑在 solver 的 M49 上踩过一次
 * （用被测函数自身造基准），这里是它的镜像：用测试重写的副本造基准。
 */
export function applyOutcome(
  before: EightBallState,
  settled: TableState,
  outcome: ShotOutcome,
): EightBallState {
  if (outcome.rerack) {
    return rackEightBall(before.turn);
  }

  const shooter = before.turn;
  const turn = outcome.continues ? shooter : otherSeat(shooter);
  const solidsSeat =
    outcome.assigned === null
      ? before.solidsSeat
      : outcome.assigned === "solids"
        ? shooter
        : otherSeat(shooter);

  return {
    table: settled,
    turn,
    solidsSeat,
    broken: true,
    // 犯规才给持球在手。上一杆的持球在手不会顺延到下一杆 —— 它是一次性的权利。
    ballInHand: outcome.foul !== null,
    winner: outcome.winner,
  };
}

// ───────────────────────── 持球在手 ─────────────────────────

/** 摆放母球被拒的原因。 */
export type PlacementRejection =
  | "not_in_hand"
  | "off_table"
  | "in_pocket"
  | "overlapping";

export type PlacementResult =
  | { readonly ok: false; readonly reason: PlacementRejection }
  | { readonly ok: true; readonly state: EightBallState };

/**
 * 母球可以放置的范围：距库边至少一个球半径。
 *
 * 不是「在台面矩形内」—— 球心贴到库边线上时球有一半在库里。
 */
export function withinPlacementBounds(pos: Vec2): boolean {
  return (
    abs(pos.x) <= sub(HALF_LENGTH, BALL_RADIUS) &&
    abs(pos.y) <= sub(HALF_WIDTH, BALL_RADIUS)
  );
}

/**
 * 把母球放到指定位置。
 *
 * 三条校验缺一不可，而且**必须在服务端做**：客户端界面会把非法位置画成红色
 * 不让松手，但那只是提示。摆球是持球在手唯一能作弊的地方 —— 直接把母球摆到
 * 贴着目标球、或者摆进袋口边上，就是无限续杆。
 */
export function placeCueBall(
  state: EightBallState,
  pos: Vec2,
): PlacementResult {
  if (!state.ballInHand) {
    return { ok: false, reason: "not_in_hand" };
  }
  if (!withinPlacementBounds(pos)) {
    return { ok: false, reason: "off_table" };
  }
  if (pocketAt(pos) !== null) {
    return { ok: false, reason: "in_pocket" };
  }
  for (const ball of state.table.balls) {
    if (ball.pocketed || ball.id === CUE_BALL_ID) continue;
    if (vLen(vSub(ball.pos, pos)) < BALL_DIAMETER) {
      return { ok: false, reason: "overlapping" };
    }
  }

  const balls = state.table.balls.map((b) =>
    b.id === CUE_BALL_ID
      ? // 清零 vel/spin/spinZ 是**卫生措施，不是正确性要求**：`strike` 会无条件
        // 覆写这三个字段，所以残速穿不过下一杆（探针实测：带残速与不带残速的
        // 末态与事件序列逐位相同）。清零是为了让「台面静止」这个状态在被渲染层、
        // 机器人、序列化读到时是自洽的 —— 一颗停着的球不该带着速度。
        {
          ...b,
          pos,
          vel: VEC2_ZERO,
          spin: VEC2_ZERO,
          spinZ: ZERO,
          pocketed: false,
        }
      : b,
  );
  // 摆完球权利即消耗。留着的话玩家可以摆一次、击一杆、发现不好再摆一次。
  return { ok: true, state: { ...state, table: { balls }, ballInHand: false } };
}
