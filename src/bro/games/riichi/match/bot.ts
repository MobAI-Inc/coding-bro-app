/**
 * 立直麻将：陪练机器人。
 *
 * 目标不是打得好，是**打得像回事且永不卡住**。页面在等它出牌，它返回不了合法
 * 动作就是死局 —— 所以这里没有任何一条路径会返回 null 或抛错：兜底是「摸切」，
 * 而摸切在任何时候都合法。
 *
 * 策略只有一句：打完之后向听数最小的那张。同为最小时按「留搭子、丢孤张」排序。
 * 不做读牌、不算铳率、不算打点。真人打三局就能赢它，但它不会做出「听牌了还拆听」
 * 这种一眼假的动作 —— 陪练机器人的下限比上限重要。
 */

import type { Tile136 } from "../logic";
import {
  countsOf,
  isHonor,
  isTerminalOrHonor,
  rankOf,
  shanten,
  suitOf,
  toTile34,
} from "../logic";
import type { RoundState, Seat } from "./round";
import { discard, passCall, ron, tsumo, waitingTiles } from "./round";
import type { ActionResult } from "./round";

/**
 * 一张牌有多「孤」。数越大越该打。
 *
 * 只在向听数相同的候选之间做区分 —— 向听数是硬指标，这个只是软偏好。分档而不是
 * 连续打分：连续打分会让两张差别很小的牌因为浮点噪声频繁换序，同一手牌在不同轮
 * 里打出不同的牌，看着像随机乱打。
 */
function isolation(tile: Tile136, hand: readonly Tile136[]): number {
  const kind = toTile34(tile);
  const counts = countsOf(hand);

  // 手里已有对子及以上 —— 留着
  if (counts[kind] >= 2) return 0;

  if (isHonor(kind)) {
    // 孤张字牌最该打：它连不成顺子，只能等刻子
    return 5;
  }

  // 数牌：看左右两格内有没有牌搭。
  // rankOf 是 0..8 而不是 1..9 —— 按 1..9 写的话 `near` 会算到牌自己头上，
  // 于是每张孤张都「找到一个邻居」，孤立度这套排序整个失效（探针实测：
  // 27 种孤张数牌里被判为完全孤张的有 0 种）。
  const suit = suitOf(kind);
  const rank = rankOf(kind);
  let neighbours = 0;
  for (let d = -2; d <= 2; d += 1) {
    if (d === 0) continue;
    const r = rank + d;
    if (r < 0 || r > 8) continue;
    if (counts[suit * 9 + r] > 0) neighbours += 1;
  }
  if (neighbours === 0) {
    // 完全孤张。幺九比中张更该打（成顺子的路少一半）
    return isTerminalOrHonor(kind) ? 4 : 3;
  }
  if (neighbours === 1) return 2;
  return 1;
}

/** 选一张打。返回的牌保证在手里。 */
export function chooseDiscard(state: RoundState, seat: Seat): Tile136 {
  const player = state.players[seat];

  // 立直之后不能换听，只能摸切
  if (player.riichi) {
    return state.lastDraw ?? player.hand[player.hand.length - 1];
  }

  let best: Tile136 = player.hand[0];
  let bestShanten = Number.POSITIVE_INFINITY;
  let bestIsolation = -1;

  // 同一种牌只试一次：手里两张 3m，打哪张结果都一样
  const tried = new Set<number>();
  for (const tile of player.hand) {
    const kind = toTile34(tile);
    if (tried.has(kind)) continue;
    tried.add(kind);

    const rest = player.hand.filter((t) => t !== tile);
    let s: number;
    try {
      s = shanten(countsOf(rest));
    } catch {
      // 张数异常（理论上到不了这里）。跳过这个候选，别让整局崩掉
      continue;
    }
    const iso = isolation(tile, player.hand);
    if (s < bestShanten || (s === bestShanten && iso > bestIsolation)) {
      best = tile;
      bestShanten = s;
      bestIsolation = iso;
    }
  }
  return best;
}

/** 该不该立直：门清听牌就立。不挑打点 —— 挑打点是人类才做的事。 */
export function shouldRiichi(
  state: RoundState,
  seat: Seat,
  tile: Tile136,
): boolean {
  const player = state.players[seat];
  if (player.riichi) return false;
  if (player.melds.some((m) => m.opened)) return false;
  if (player.points < 1000) return false;
  const rest = player.hand.filter((t) => t !== tile);
  try {
    return shanten(countsOf(rest)) === 0;
  } catch {
    return false;
  }
}

/**
 * 轮到自己时走一步：能自摸就自摸，否则打一张。
 *
 * 返回 `ActionResult` 而不是直接返回新状态：调用方（服务端）要能看到被拒的原因。
 * 正常情况下这里不会被拒 —— 真被拒了说明机器人和状态机对规则的理解不一致，
 * 那是必须暴露出来的 bug，不是可以吞掉的小事。
 */
export function playTurn(state: RoundState, seat: Seat): ActionResult {
  const win = tsumo(state, seat);
  if (win.ok) return win;

  const tile = chooseDiscard(state, seat);
  return discard(state, seat, tile, shouldRiichi(state, seat, tile));
}

/**
 * 处理别家打出的一张：有人能荣就荣，否则过。
 *
 * 座位按「下家优先」而不是从 0 开始扫 —— 多家同时能和时，规则是**离放铳者最近的
 * 那家优先**（头跳）。从 0 扫的话，座位号小的白捡一个头跳。
 */
export function resolveDiscard(
  state: RoundState,
  humanSeat: Seat | null,
): ActionResult {
  const from = state.lastDiscard?.from;
  if (from === undefined) return passCall(state);

  for (let i = 1; i < 4; i += 1) {
    const seat = ((from + i) % 4) as Seat;
    if (seat === humanSeat) continue; // 人类自己决定要不要荣
    const r = ron(state, seat);
    if (r.ok) return r;
  }
  return passCall(state);
}

/** 这个座位现在能不能荣和（给界面点亮「荣」按钮用）。 */
export function canRon(state: RoundState, seat: Seat): boolean {
  return ron(state, seat).ok;
}

/** 这个座位现在能不能自摸。 */
export function canTsumo(state: RoundState, seat: Seat): boolean {
  return tsumo(state, seat).ok;
}

/** 现在打哪些牌能保持听牌（给界面标出来）。空数组表示没听牌。 */
export function tenpaiDiscards(state: RoundState, seat: Seat): Tile136[] {
  const player = state.players[seat];
  const out: Tile136[] = [];
  const tried = new Set<number>();
  for (const tile of player.hand) {
    const kind = toTile34(tile);
    if (tried.has(kind)) continue;
    tried.add(kind);
    const rest = player.hand.filter((t) => t !== tile);
    try {
      if (
        shanten(countsOf(rest)) === 0 &&
        waitingTiles(rest, player.melds).length > 0
      ) {
        out.push(tile);
      }
    } catch {
      continue;
    }
  }
  return out;
}
