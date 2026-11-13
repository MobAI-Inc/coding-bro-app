/**
 * 立直麻将对局状态机测试。
 *
 * 算番（役 / 符 / 点数）已经在 riichi-*.test.ts 里按语料钉死，这里一概不重测。
 * 这一层测的是**算番层看不见的那些事**：牌山发得对不对、轮转对不对、立直合不
 * 合法、振听拦不拦得住、点棒守不守恒。
 *
 * 两条贯穿全文件的写法：
 *
 * 1. **拒绝路径同时断言「回了错误」和「状态没动」。** 状态机的 `reject` 原样退回
 *    同一个引用，所以后者可以直接用 `===` 断言 —— 只断言错误码的测试挡不住
 *    「拒绝了但状态已经改了」这种实现。
 *
 * 2. **手牌用具名常量摆好，不靠随机局面撞。** 撞出来的局面换个种子就没了，测试
 *    会随种子飘。
 */

import { describe, expect, it } from "vitest";
import {
  DEAD_WALL_SIZE,
  RIICHI_STICK,
  SEATS,
  START_POINTS,
  WALL_SIZE,
  buildWall,
  discard,
  isFuriten,
  isTenpai,
  passCall,
  ron,
  startRound,
  tsumo,
  waitingTiles,
  windOfSeat,
} from "@/bro/games/riichi/match/round";
import type { PlayerState, RoundState, Seat } from "@/bro/games/riichi/match/round";
import {
  canRon,
  chooseDiscard,
  playTurn,
  resolveDiscard,
  shouldRiichi,
  tenpaiDiscards,
} from "@/bro/games/riichi/match/bot";
import { EAST, countsOf, shanten, toTile34 } from "@/bro/games/riichi/logic";

/* ------------------------------------------------------------------ *
 * 局面构造
 * ------------------------------------------------------------------ */

/** 覆写某座位的手牌，构造受控局面。 */
function withHand(
  s: RoundState,
  seat: Seat,
  hand: readonly number[],
  patch: Partial<PlayerState> = {},
): RoundState {
  const players = s.players.map((p, i) =>
    i === seat ? { ...p, hand: [...hand].sort((a, b) => a - b), ...patch } : p,
  ) as unknown as RoundState["players"];
  return { ...s, players };
}

/** 把局面摆成「seat 刚打出 tile，等别家响应」。 */
function afterDiscard(s: RoundState, from: Seat, tile: number): RoundState {
  return { ...s, phase: "awaiting_call", lastDiscard: { tile, from }, turn: from } as RoundState;
}

/**
 * 一気通貫听单骑 5s：123m 456m 789m 123p + 5s。
 * 探针确认过它只听 5s（牌种 22），且有役（ittsu）—— 用无役的手测振听会分不清
 * 是被振听拦下还是被无役拦下。
 */
const ITTSU_TANKI = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 88];
/** 5s 的另外两个实体，用于「别人打出来的那张」。 */
const FIVE_SOU_A = 89;
const FIVE_SOU_B = 90;

/**
 * 无役听牌：123m 456m 789p 2s4s 5z5z，听 3s 坎张。
 * 探针确认算番层对它返回 ERR_NO_YAKU。
 */
const NO_YAKU = [0, 4, 8, 12, 16, 20, 60, 64, 68, 76, 84, 124, 125];
const THREE_SOU = 80;

/** 遍地孤张，探针实测 6 向听 —— 拿它测「非听牌不能立直」。 */
const SCATTER = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 112, 116, 120];

function totalPoints(s: RoundState): number {
  return s.players.reduce((a, p) => a + p.points, 0);
}

/** 全机器人推一局到底。 */
function autoplay(seed: number, maxSteps = 400) {
  let s = startRound({ seed });
  let steps = 0;
  let stalled = false;
  let rejected: string | null = null;
  while (s.phase !== "finished" && steps < maxSteps) {
    steps += 1;
    const before = s;
    const r = s.phase === "awaiting_discard" ? playTurn(s, s.turn) : resolveDiscard(s, null);
    if (!r.ok) {
      rejected = r.reason;
      break;
    }
    s = r.state;
    if (s === before) {
      stalled = true;
      break;
    }
  }
  return { state: s, steps, stalled, rejected };
}

/* ------------------------------------------------------------------ *
 * 牌山与开局
 * ------------------------------------------------------------------ */

describe("牌山", () => {
  it("136 张不重不漏", () => {
    const wall = buildWall(42);
    expect(wall).toHaveLength(WALL_SIZE);
    expect(new Set(wall).size).toBe(WALL_SIZE);
    expect([...wall].sort((a, b) => a - b)).toEqual(
      Array.from({ length: WALL_SIZE }, (_, i) => i),
    );
  });

  it("同种子同牌山 —— 服务端权威推进要靠这条复现对局", () => {
    expect(buildWall(1234)).toEqual(buildWall(1234));
  });

  it("不同种子不同牌山", () => {
    expect(buildWall(1)).not.toEqual(buildWall(2));
  });

  it("种子 0 不退化 —— xorshift 遇 0 会永远吐 0", () => {
    const wall = buildWall(0);
    expect(new Set(wall).size).toBe(WALL_SIZE);
    // 没洗过的牌山是 0..135 原序，退化的表现就是它
    expect(wall).not.toEqual(Array.from({ length: WALL_SIZE }, (_, i) => i));
  });
});

describe("开局", () => {
  it("四家 13 张，庄家摸完是 14 张", () => {
    const s = startRound({ seed: 7 });
    expect(s.players[s.dealer].hand).toHaveLength(14);
    for (const seat of SEATS) {
      if (seat === s.dealer) continue;
      expect(s.players[seat].hand).toHaveLength(13);
    }
  });

  it("牌山 = 136 - 王牌 14 - 发出去的 52 - 庄家那一张", () => {
    const s = startRound({ seed: 7 });
    expect(s.deadWall).toHaveLength(DEAD_WALL_SIZE);
    expect(s.wall).toHaveLength(WALL_SIZE - DEAD_WALL_SIZE - 52 - 1);
  });

  it("手牌、牌山、王牌加起来仍是完整一副 —— 发牌不能凭空造牌", () => {
    const s = startRound({ seed: 7 });
    const all = [...s.wall, ...s.deadWall, ...s.players.flatMap((p) => p.hand)];
    expect(new Set(all).size).toBe(WALL_SIZE);
  });

  it("开局翻一张宝牌指示", () => {
    expect(startRound({ seed: 7 }).doraRevealed).toBe(1);
  });

  it("起始点数四家各 25000", () => {
    const s = startRound({ seed: 7 });
    expect(s.players.map((p) => p.points)).toEqual([
      START_POINTS,
      START_POINTS,
      START_POINTS,
      START_POINTS,
    ]);
  });

  it("轮到庄家，且 lastDraw 就是他刚摸那张", () => {
    const s = startRound({ seed: 7, dealer: 2 });
    expect(s.turn).toBe(2);
    expect(s.phase).toBe("awaiting_discard");
    expect(s.players[2].hand).toContain(s.lastDraw!);
  });

  it("lastDraw 不等于手牌里编号最大的那张", () => {
    // 手牌是排序存的。用「最后一张」代替 lastDraw 的话，自摸和了牌会取成编号
    // 最大的牌 —— 符数（自摸符、单骑听）跟着全错。探针跑了 6 个种子无一相等。
    for (const seed of [1, 2, 3, 4, 5, 7]) {
      const s = startRound({ seed });
      const hand = s.players[s.turn].hand;
      expect(s.lastDraw).not.toBe(Math.max(...hand));
    }
  });
});

describe("自风", () => {
  it("庄家是东，按座次顺推", () => {
    expect(windOfSeat(0, 0)).toBe(EAST);
    expect(windOfSeat(1, 0)).toBe(EAST + 1);
    expect(windOfSeat(2, 0)).toBe(EAST + 2);
    expect(windOfSeat(3, 0)).toBe(EAST + 3);
  });

  it("换庄之后跟着转，且不会算出负数下标", () => {
    expect(windOfSeat(2, 2)).toBe(EAST);
    // 0 - 3 = -3，取模不当就会是 EAST-3（南风变成了别的牌）
    expect(windOfSeat(0, 3)).toBe(EAST + 1);
    expect(windOfSeat(1, 3)).toBe(EAST + 2);
  });
});

/* ------------------------------------------------------------------ *
 * 打牌与轮转
 * ------------------------------------------------------------------ */

describe("打牌", () => {
  it("打完手牌回到 13 张，牌进牌河", () => {
    const s = startRound({ seed: 7 });
    const tile = s.lastDraw!;
    const r = discard(s, s.turn, tile);
    expect(r.ok).toBe(true);
    expect(r.state.players[s.turn].hand).toHaveLength(13);
    expect(r.state.players[s.turn].discards).toEqual([tile]);
    expect(r.state.phase).toBe("awaiting_call");
  });

  it("打完清空 lastDraw —— 不清的话打完还能再自摸一次", () => {
    const s = startRound({ seed: 7 });
    const r = discard(s, s.turn, s.lastDraw!);
    expect(r.ok).toBe(true);
    expect(r.state.lastDraw).toBeNull();
    // 而且此时阶段已经变了，自摸这条路根本进不去
    expect(tsumo(r.state, s.turn).ok).toBe(false);
  });

  it("不是自己的回合：拒绝，状态不动", () => {
    const s = startRound({ seed: 7, dealer: 0 });
    const before = s;
    const r = discard(s, 2, s.players[2].hand[0]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("not_your_turn");
    expect(r.state).toBe(before);
  });

  it("打一张手里没有的牌：拒绝，状态不动", () => {
    const s = startRound({ seed: 7 });
    const notInHand = [...Array(136).keys()].find(
      (t) => !s.players[s.turn].hand.includes(t),
    )!;
    const r = discard(s, s.turn, notInHand);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("tile_not_in_hand");
    expect(r.state).toBe(s);
  });

  it("等待响应期间不能再打牌", () => {
    const s = startRound({ seed: 7 });
    const after = discard(s, s.turn, s.lastDraw!);
    expect(after.ok).toBe(true);
    const again = discard(after.state, s.turn, after.state.players[s.turn].hand[0]);
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toBe("wrong_phase");
    expect(again.state).toBe(after.state);
  });

  it("终局后一概拒绝", () => {
    const finished = { ...startRound({ seed: 7 }), phase: "finished" } as RoundState;
    for (const r of [
      discard(finished, finished.turn, finished.lastDraw!),
      tsumo(finished, finished.turn),
      ron(finished, 1),
    ]) {
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("round_over");
      expect(r.state).toBe(finished);
    }
  });
});

describe("轮转", () => {
  it("过牌后轮到下家，且他摸了一张", () => {
    const s = startRound({ seed: 7, dealer: 0 });
    const d = discard(s, 0, s.lastDraw!);
    expect(d.ok).toBe(true);
    const p = passCall(d.state);
    expect(p.ok).toBe(true);
    expect(p.state.turn).toBe(1);
    expect(p.state.players[1].hand).toHaveLength(14);
    expect(p.state.players[1].hand).toContain(p.state.lastDraw!);
    expect(p.state.wall).toHaveLength(d.state.wall.length - 1);
  });

  it("绕回庄家时巡目 +1，中途不加", () => {
    let s = startRound({ seed: 7, dealer: 0 });
    expect(s.turnCount).toBe(1);
    for (const expected of [1, 1, 1, 2]) {
      const d = discard(s, s.turn, s.lastDraw!);
      expect(d.ok).toBe(true);
      const p = passCall(d.state);
      expect(p.ok).toBe(true);
      s = p.state;
      expect(s.turnCount).toBe(expected);
    }
  });

  it("没人打牌时不能过", () => {
    const s = startRound({ seed: 7 });
    const r = passCall(s);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("wrong_phase");
    expect(r.state).toBe(s);
  });
});

/* ------------------------------------------------------------------ *
 * 立直
 * ------------------------------------------------------------------ */

describe("立直", () => {
  const readyToRiichi = (extra = 104) =>
    withHand(startRound({ seed: 7, dealer: 0 }), 0, [...ITTSU_TANKI, extra]);

  it("合法立直：扣 1000、桌上多一根棒、一发生效", () => {
    const s = readyToRiichi();
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(true);
    const me = r.state.players[0];
    expect(me.riichi).toBe(true);
    expect(me.points).toBe(START_POINTS - RIICHI_STICK);
    expect(r.state.riichiSticks).toBe(1);
    expect(me.ippatsu).toBe(true);
  });

  it("第一巡立直算双立直", () => {
    const r = discard(readyToRiichi(), 0, 104, true);
    expect(r.ok).toBe(true);
    expect(r.state.players[0].isDoubleRiichi).toBe(true);
  });

  it("第二巡起立直不算双立直", () => {
    const s = { ...readyToRiichi(), turnCount: 2 } as RoundState;
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(true);
    expect(r.state.players[0].isDoubleRiichi).toBe(false);
  });

  it("打完不听牌：拒绝，状态不动", () => {
    // SCATTER 探针实测 6 向听，怎么打都不可能听
    const s = withHand(startRound({ seed: 7, dealer: 0 }), 0, [...SCATTER, 104]);
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("not_tenpai");
    expect(r.state).toBe(s);
  });

  it("点数不足 1000：拒绝", () => {
    const s = withHand(
      startRound({ seed: 7, dealer: 0 }),
      0,
      [...ITTSU_TANKI, 104],
      { points: 500 },
    );
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("riichi_no_points");
    expect(r.state).toBe(s);
  });

  it("恰好 1000 点可以立直 —— 边界不能连自己一起挡掉", () => {
    const s = withHand(
      startRound({ seed: 7, dealer: 0 }),
      0,
      [...ITTSU_TANKI, 104],
      { points: RIICHI_STICK },
    );
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(true);
    expect(r.state.players[0].points).toBe(0);
  });

  it("已立直不能再立", () => {
    const s = withHand(
      startRound({ seed: 7, dealer: 0 }),
      0,
      [...ITTSU_TANKI, 104],
      { riichi: true },
    );
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("riichi_already");
    expect(r.state).toBe(s);
  });

  it("有明露副露不能立直", () => {
    const s = withHand(
      startRound({ seed: 7, dealer: 0 }),
      0,
      [...ITTSU_TANKI, 104],
      { melds: [{ type: "pon", tiles: [108, 109, 110], opened: true }] },
    );
    const r = discard(s, 0, 104, true);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("riichi_not_closed");
  });

  it("不宣告立直时，这些限制一概不生效", () => {
    const s = withHand(
      startRound({ seed: 7, dealer: 0 }),
      0,
      [...SCATTER, 104],
      { points: 0 },
    );
    // 同一手牌，不立直就打得出去 —— 证明上面几条拒绝确实来自立直分支
    expect(discard(s, 0, 104, false).ok).toBe(true);
  });

  it("自己再打一张，一发就失效", () => {
    const s = discard(readyToRiichi(), 0, 104, true);
    expect(s.ok).toBe(true);
    let next = passCall(s.state).state;
    // 转一圈回到自己
    for (let i = 0; i < 3; i += 1) {
      const d = discard(next, next.turn, next.lastDraw!);
      next = passCall(d.state).state;
    }
    expect(next.turn).toBe(0);
    expect(next.players[0].ippatsu).toBe(true); // 还没轮到自己打第二张
    const second = discard(next, 0, next.lastDraw!);
    expect(second.ok).toBe(true);
    expect(second.state.players[0].ippatsu).toBe(false);
  });

  it("别家过牌不打断一发", () => {
    const s = discard(readyToRiichi(), 0, 104, true);
    expect(s.ok).toBe(true);
    const after = passCall(s.state);
    expect(after.state.players[0].ippatsu).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 听牌与振听
 * ------------------------------------------------------------------ */

describe("听牌", () => {
  it("一気通貫单骑只听那一张", () => {
    expect(waitingTiles(ITTSU_TANKI)).toEqual([toTile34(88)]);
  });

  it("非听牌手没有和了张", () => {
    expect(waitingTiles(SCATTER)).toEqual([]);
  });

  it("isTenpai 与向听数一致", () => {
    const s = withHand(startRound({ seed: 7 }), 1, ITTSU_TANKI);
    expect(isTenpai(s.players[1])).toBe(true);
    expect(shanten(countsOf(ITTSU_TANKI))).toBe(0);

    const flat = withHand(startRound({ seed: 7 }), 1, SCATTER);
    expect(isTenpai(flat.players[1])).toBe(false);
  });

  it("自己手里已有四张的牌不算和了张 —— 第五张不存在", () => {
    // 1m 四张全在手，任何听 1m 的形都该把 1m 排除
    const fourOnes = [0, 1, 2, 3, 4, 8, 12, 16, 20, 24, 28, 32, 36];
    expect(waitingTiles(fourOnes)).not.toContain(0);
  });
});

describe("振听", () => {
  it("牌河里有和了张就不能荣，状态不动", () => {
    let s = startRound({ seed: 7 });
    // seat1 听 5s，但自己牌河里已经有一张 5s
    s = withHand(s, 1, ITTSU_TANKI, { discards: [FIVE_SOU_A] });
    expect(isFuriten(s.players[1], waitingTiles(ITTSU_TANKI))).toBe(true);

    const table = afterDiscard(s, 0, FIVE_SOU_B);
    const r = ron(table, 1);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("furiten");
    expect(r.state).toBe(table);
  });

  it("同一手牌不振听就能荣 —— 证明上一条是被振听拦下的", () => {
    let s = startRound({ seed: 7 });
    s = withHand(s, 1, ITTSU_TANKI, { discards: [] });
    const r = ron(afterDiscard(s, 0, FIVE_SOU_B), 1);
    expect(r.ok).toBe(true);
    expect(r.state.result?.winner).toBe(1);
    expect(r.state.result?.loser).toBe(0);
  });

  it("摸牌解除同巡振听，但不解除牌河振听", () => {
    let s = startRound({ seed: 7, dealer: 1 });
    s = withHand(s, 1, ITTSU_TANKI, {
      discards: [FIVE_SOU_A],
      temporaryFuriten: true,
    });
    const d = discard(s, 1, s.players[1].hand[0]);
    expect(d.ok).toBe(true);
    const p = passCall(d.state);
    // 转一圈回到 seat1，他会摸一张
    let next = p.state;
    for (let i = 0; i < 3; i += 1) {
      const dd = discard(next, next.turn, next.lastDraw!);
      next = passCall(dd.state).state;
    }
    expect(next.turn).toBe(1);
    expect(next.players[1].temporaryFuriten).toBe(false); // 同巡的清了
    // 牌河那张 5s 还在，仍然振听
    expect(isFuriten(next.players[1], waitingTiles(ITTSU_TANKI))).toBe(true);
  });

  it("不听牌的手荣和：not_winning_hand 而不是 furiten", () => {
    const s = withHand(startRound({ seed: 7 }), 1, SCATTER);
    const table = afterDiscard(s, 0, FIVE_SOU_B);
    const r = ron(table, 1);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("not_winning_hand");
    expect(r.state).toBe(table);
  });

  it("不能荣自己打的牌", () => {
    const s = withHand(startRound({ seed: 7 }), 1, ITTSU_TANKI);
    const table = afterDiscard(s, 1, FIVE_SOU_B);
    const r = ron(table, 1);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("nothing_to_call");
  });
});

describe("无役", () => {
  it("无役荣和被拒，且宣告者吃一个同巡振听", () => {
    // 不罚的话，同一张牌可以反复宣告荣和，白嫖到蒙对为止
    let s = startRound({ seed: 7 });
    s = withHand(s, 1, NO_YAKU);
    const table = afterDiscard(s, 0, THREE_SOU);

    const first = ron(table, 1);
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.reason).toBe("no_yaku");
    // 这是唯一一条会改状态的拒绝
    expect(first.state).not.toBe(table);
    expect(first.state.players[1].temporaryFuriten).toBe(true);
    expect(first.state.phase).toBe("awaiting_call");

    // 再宣告一次，这回直接是振听
    const second = ron(first.state, 1);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("furiten");
  });

  it("无役的处罚只落在宣告者身上", () => {
    let s = startRound({ seed: 7 });
    s = withHand(s, 1, NO_YAKU);
    const table = afterDiscard(s, 0, THREE_SOU);
    const r = ron(table, 1);
    for (const seat of [0, 2, 3] as Seat[]) {
      expect(r.state.players[seat].temporaryFuriten).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 结算
 * ------------------------------------------------------------------ */

describe("结算", () => {
  it("荣和：放铳者付，另外两家不动", () => {
    let s = startRound({ seed: 7 });
    s = withHand(s, 1, ITTSU_TANKI);
    const r = ron(afterDiscard(s, 2, FIVE_SOU_B), 1);
    expect(r.ok).toBe(true);
    const { deltas } = r.state.result!;
    expect(deltas[1]).toBeGreaterThan(0);
    expect(deltas[2]).toBeLessThan(0);
    expect(deltas[0]).toBe(0);
    expect(deltas[3]).toBe(0);
    expect(deltas[1] + deltas[2]).toBe(0);
  });

  it("庄家自摸：三家各付同一份", () => {
    let s = startRound({ seed: 7, dealer: 0 });
    s = withHand(s, 0, [...ITTSU_TANKI, FIVE_SOU_A]);
    const r = tsumo({ ...s, lastDraw: FIVE_SOU_A } as RoundState, 0);
    expect(r.ok).toBe(true);
    const { deltas } = r.state.result!;
    expect(deltas[1]).toBe(deltas[2]);
    expect(deltas[2]).toBe(deltas[3]);
    expect(deltas[0]).toBe(-(deltas[1] + deltas[2] + deltas[3]));
  });

  it("闲家自摸：庄家付得比另外两闲多", () => {
    let s = startRound({ seed: 7, dealer: 0 });
    s = withHand(s, 1, [...ITTSU_TANKI, FIVE_SOU_A]);
    const r = tsumo({ ...s, turn: 1, lastDraw: FIVE_SOU_A } as RoundState, 1);
    expect(r.ok).toBe(true);
    const { deltas } = r.state.result!;
    expect(Math.abs(deltas[0])).toBeGreaterThan(Math.abs(deltas[2]));
    expect(deltas[2]).toBe(deltas[3]);
  });

  it("和了后桌上的立直棒清零，且归了和了者", () => {
    let s = startRound({ seed: 7, riichiSticks: 2 });
    s = withHand(s, 1, ITTSU_TANKI);
    const r = ron(afterDiscard(s, 0, FIVE_SOU_B), 1);
    expect(r.ok).toBe(true);
    expect(r.state.riichiSticks).toBe(0);
    // 和了者拿到的比放铳者付的多，多出来的正是 2 根棒
    const { deltas } = r.state.result!;
    expect(deltas[1] + deltas[0]).toBe(2 * RIICHI_STICK);
  });

  it("本场棒由放铳者付", () => {
    const build = (honba: number) => {
      const s = withHand(startRound({ seed: 7, honba }), 1, ITTSU_TANKI);
      const r = ron(afterDiscard(s, 0, FIVE_SOU_B), 1);
      expect(r.ok).toBe(true);
      return r.state.result!.deltas;
    };
    const zero = build(0);
    const two = build(2);
    // 荣和每本场 300，两本场就是 600
    expect(two[1] - zero[1]).toBe(600);
    expect(zero[0] - two[0]).toBe(600);
  });

  it("和了时 result 带得出役与番符", () => {
    let s = startRound({ seed: 7 });
    s = withHand(s, 1, ITTSU_TANKI);
    const r = ron(afterDiscard(s, 0, FIVE_SOU_B), 1);
    expect(r.ok).toBe(true);
    const result = r.state.result!;
    expect(result.reason).toBe("ron");
    expect(result.han).toBeGreaterThan(0);
    expect(result.fu).toBeGreaterThan(0);
    expect(result.yaku.map((y) => y.id)).toContain("ittsu");
  });
});

describe("荒牌流局", () => {
  /**
   * 摆一个「牌山已空，seat0 刚打完最后一张」的局面。
   *
   * seat0 是当前行动者，手上必须是 14 张 —— 覆写他的手牌时补一张 104（9s，
   * 两个测试用手牌里都没有），再把这张打掉，落地的正好是传进来的那 13 张。
   * 直接给 13 张再打一张的话会剩 12 张，`shanten()` 遇 3 的倍数张会抛。
   */
  const drained = (hands: Partial<Record<Seat, readonly number[]>>) => {
    const FILLER = 104;
    let s = startRound({ seed: 7, dealer: 0 });
    for (const seat of SEATS) {
      const hand = hands[seat];
      if (!hand) continue;
      s = withHand(s, seat, seat === 0 ? [...hand, FILLER] : hand);
    }
    s = { ...s, wall: [] } as RoundState;
    const tile = hands[0] ? FILLER : s.players[0].hand[13];
    const d = discard(s, 0, tile);
    expect(d.ok).toBe(true);
    return passCall(d.state).state;
  };

  it("牌山摸空即流局", () => {
    const s = drained({});
    expect(s.phase).toBe("finished");
    expect(s.result?.reason).toBe("exhaustive_draw");
    expect(s.result?.winner).toBeNull();
  });

  it("听牌的收、没听的付，总额 3000", () => {
    // seat1 听牌，其余三家摊平
    const s = drained({ 1: ITTSU_TANKI, 2: SCATTER, 3: SCATTER });
    const deltas = s.result!.deltas;
    expect(deltas[1]).toBe(3000);
    expect(deltas[2]).toBe(-1000);
    expect(deltas[3]).toBe(-1000);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("四家全不听：不罚符", () => {
    const s = drained({ 0: SCATTER, 1: SCATTER, 2: SCATTER, 3: SCATTER });
    expect(s.result!.deltas).toEqual([0, 0, 0, 0]);
  });

  it("流局不清桌上的立直棒 —— 那是下一局的彩头", () => {
    let s = startRound({ seed: 7, dealer: 0, riichiSticks: 2 });
    s = { ...s, wall: [] } as RoundState;
    const d = discard(s, 0, s.lastDraw!);
    const p = passCall(d.state);
    expect(p.state.result?.reason).toBe("exhaustive_draw");
    expect(p.state.riichiSticks).toBe(2);
  });

  it("张数异常的手牌不会把整局结算炸掉", () => {
    // shanten() 对 3 的倍数张会抛。抛在这里的代价是**一整局的点数全丢** ——
    // 副露接上之后手牌张数本来就会变成 13/10/7/4，这条路必须是软失败。
    let s = startRound({ seed: 7, dealer: 0 });
    s = withHand(s, 2, [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44]); // 12 张
    expect(() => isTenpai(s.players[2])).not.toThrow();
    expect(isTenpai(s.players[2])).toBe(false);

    s = { ...s, wall: [] } as RoundState;
    const d = discard(s, 0, s.lastDraw!);
    expect(d.ok).toBe(true);
    const p = passCall(d.state);
    expect(p.state.result?.reason).toBe("exhaustive_draw");
  });
});

/* ------------------------------------------------------------------ *
 * 点棒守恒
 * ------------------------------------------------------------------ */

describe("点棒守恒", () => {
  it("100 局跑下来，四家点数 + 桌上立直棒 恒为 100000", () => {
    // 这是整个状态机唯一一条能一句话说清的全局不变量：点棒只在四家与桌面之间
    // 移动，谁也印不出新的。立直棒宣告时从点数里扣走、和了时随 cost.total 回到
    // 和了者手上 —— 少记任何一头，这个和都会飘。
    //
    // 必须把桌上的棒也算进来：流局时棒留在桌上，只看四家点数的话和会小 1000 的
    // 整数倍，而那是**正常**的。探针实测 100 局里出现过 97000/98000/99000。
    for (let seed = 1; seed <= 100; seed += 1) {
      const { state, stalled, rejected } = autoplay(seed);
      expect(stalled, `seed=${seed} 卡住了`).toBe(false);
      expect(rejected, `seed=${seed} 机器人被状态机拒绝：${rejected}`).toBeNull();
      expect(
        totalPoints(state) + state.riichiSticks * RIICHI_STICK,
        `seed=${seed} 点棒不守恒`,
      ).toBe(4 * START_POINTS);
    }
  });

  it("带进来的立直棒也守恒", () => {
    let s = startRound({ seed: 7, riichiSticks: 3, honba: 2 });
    let steps = 0;
    while (s.phase !== "finished" && steps < 400) {
      steps += 1;
      const r = s.phase === "awaiting_discard" ? playTurn(s, s.turn) : resolveDiscard(s, null);
      expect(r.ok).toBe(true);
      s = r.state;
    }
    // 带进来 3 根棒 = 3000 点彩头，最后必然落到某个人手里或留在桌上
    expect(totalPoints(s) + s.riichiSticks * RIICHI_STICK).toBe(
      4 * START_POINTS + 3 * RIICHI_STICK,
    );
  });

  it("100 局里三种结局都出现过 —— 否则等于只测了一条路", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 100; seed += 1) {
      seen.add(autoplay(seed).state.result!.reason);
    }
    // 探针实测：ron 69 / tsumo 14 / 流局 17
    expect(seen).toEqual(new Set(["ron", "tsumo", "exhaustive_draw"]));
  });

  it("每局都能在有限步内收敛", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const { state, steps } = autoplay(seed);
      expect(state.phase).toBe("finished");
      // 一局最多 4 家 × 18 巡 × 2（打 + 响应）= 144 步，探针实测上限 140
      expect(steps).toBeLessThanOrEqual(160);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 机器人
 * ------------------------------------------------------------------ */

describe("陪练机器人", () => {
  it("选的牌一定在手里 —— 选错就是死局", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const s = startRound({ seed });
      expect(s.players[s.turn].hand).toContain(chooseDiscard(s, s.turn));
    }
  });

  it("不会打出让向听数变差的牌", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const s = startRound({ seed });
      const hand = s.players[s.turn].hand;
      const chosen = chooseDiscard(s, s.turn);
      const best = Math.min(
        ...hand.map((t) => shanten(countsOf(hand.filter((x) => x !== t)))),
      );
      expect(shanten(countsOf(hand.filter((x) => x !== chosen)))).toBe(best);
    }
  });

  it("立直之后只摸切 —— 立直了还换听是一眼假", () => {
    const s0 = startRound({ seed: 7, dealer: 0 });
    const s = withHand(s0, 0, [...ITTSU_TANKI, 104], { riichi: true });
    expect(chooseDiscard({ ...s, lastDraw: 104 } as RoundState, 0)).toBe(104);
  });

  it("门清听牌就立直，不听就不立", () => {
    const s0 = startRound({ seed: 7, dealer: 0 });
    const tenpai = withHand(s0, 0, [...ITTSU_TANKI, 104]);
    expect(shouldRiichi(tenpai, 0, 104)).toBe(true);

    const flat = withHand(s0, 0, [...SCATTER, 104]);
    expect(shouldRiichi(flat, 0, 104)).toBe(false);
  });

  it("已立直就不再宣告", () => {
    const s0 = startRound({ seed: 7, dealer: 0 });
    const s = withHand(s0, 0, [...ITTSU_TANKI, 104], { riichi: true });
    expect(shouldRiichi(s, 0, 104)).toBe(false);
  });

  it("头跳：多家能荣时离放铳者最近的那家先和", () => {
    // seat0 打 5s，seat1 与 seat3 都听 5s。规则是下家优先，seat1 该拿
    let s = startRound({ seed: 7, dealer: 0 });
    s = withHand(s, 1, ITTSU_TANKI);
    s = withHand(s, 3, ITTSU_TANKI);
    const r = resolveDiscard(afterDiscard(s, 0, FIVE_SOU_B), null);
    expect(r.ok).toBe(true);
    expect(r.state.result?.winner).toBe(1);
  });

  it("人类座位不由机器人代打", () => {
    let s = startRound({ seed: 7, dealer: 0 });
    s = withHand(s, 1, ITTSU_TANKI);
    // seat1 是人类，机器人不该替他宣告荣和
    const r = resolveDiscard(afterDiscard(s, 0, FIVE_SOU_B), 1);
    expect(r.ok).toBe(true);
    expect(r.state.result).toBeNull();
    expect(r.state.turn).toBe(1); // 流转到下家，等人类自己决定
  });

  it("canRon 与 ron 的判断一致", () => {
    let s = startRound({ seed: 7 });
    s = withHand(s, 1, ITTSU_TANKI);
    const table = afterDiscard(s, 0, FIVE_SOU_B);
    expect(canRon(table, 1)).toBe(true);
    expect(canRon(table, 2)).toBe(false);
    expect(canRon(table, 0)).toBe(false); // 自己打的
  });

  it("tenpaiDiscards 列出的牌打完确实听牌", () => {
    const s0 = startRound({ seed: 7, dealer: 0 });
    const s = withHand(s0, 0, [...ITTSU_TANKI, 104]);
    const options = tenpaiDiscards(s, 0);
    expect(options).toContain(104);
    for (const tile of options) {
      const rest = s.players[0].hand.filter((t) => t !== tile);
      expect(shanten(countsOf(rest))).toBe(0);
      expect(waitingTiles(rest).length).toBeGreaterThan(0);
    }
  });

  it("不听牌时 tenpaiDiscards 是空的", () => {
    const s0 = startRound({ seed: 7, dealer: 0 });
    const s = withHand(s0, 0, [...SCATTER, 104]);
    expect(tenpaiDiscards(s, 0)).toEqual([]);
  });
});
