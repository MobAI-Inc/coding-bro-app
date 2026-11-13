/**
 * 立直麻将：手牌拆解。
 *
 * 与 `agari.ts` 的区别是「一个 vs 全部」：判定只要找到一种拆法就能收工，拆解必须
 * 枚举**所有**拆法。因为同一手牌的不同拆法番数可以不同 —— `11122233388899m`
 * 既可拆成三个刻子（三暗刻），又可拆成三个 123（一杯口 + 三色的料）；谁高谁低要
 * 算完才知道。少枚举一支，玩家就少拿番，而且这种少算不会报错，只会安静地少给点。
 */

import { HONOR_START, TILE_KINDS } from "./tiles";
import type { TileCounts } from "./tiles";
import type { Division, TileGroup } from "./types";

/** 一手牌里同一种牌最多 4 张。5 张以上的牌型在牌山里不存在，直接判无解。 */
const MAX_COPIES = 4;

/** 完整手牌的面子数（不含雀头）。副露每占一个。 */
const SET_COUNT = 4;

/**
 * 从当前最小的未消耗牌开始，穷举它的全部归宿。
 *
 * 关键在于**一次把这张牌的所有张数分配完**，而不是「先拿走一组再回来看看」。
 * 含牌 i 的组只有三类：刻子、雀头、以 i 起头的顺子（以 i-1、i-2 起头的顺子在处理
 * 更小的牌时就已经消耗掉了）。所以一次决定 (雀头?, 刻子?, 几个顺子) 三元组，就
 * 把这张牌彻底了结，然后永不回头。
 *
 * 这不只是快慢问题，而是**去重**问题：若允许「先拿刻子、回头再拿顺子」这种走法，
 * 4 张 1s + 2s + 3s 会走出两条路径（先 111s 后 123s / 先 123s 后 111s）却得到同一
 * 个拆法集合，于是 `111123666789s11z` 会被报成 2 种拆法 —— 语料明确写着 1 种。
 * 番数按拆法逐个算再取高，重复拆法本身不会算错番，但拆法个数是我们对外的契约
 * （UI 要展示、测试要断言），报重了就是错。
 */
function walk(
  rest: number[],
  from: number,
  pairUsed: boolean,
  groups: TileGroup[],
  out: Division[],
): void {
  let i = from;
  while (i < TILE_KINDS && rest[i] === 0) {
    i += 1;
  }
  if (i >= TILE_KINDS) {
    if (pairUsed) {
      out.push([...groups]);
    }
    return;
  }

  const n = rest[i];
  // 字牌没有顺子；数牌的顺子不能跨花色，所以起点在花色内必须 <= 7（i % 9 <= 6）。
  const canRun = i < HONOR_START && i % 9 <= 6;
  const runRoom = canRun ? Math.min(rest[i + 1], rest[i + 2]) : 0;

  for (const pair of pairUsed ? [0] : [0, 2]) {
    for (const triplet of [0, 3]) {
      const runs = n - pair - triplet;
      if (runs < 0 || runs > runRoom) {
        continue;
      }

      rest[i] = 0;
      if (runs > 0) {
        // 只在真的取了顺子时才碰 i+1 / i+2。无条件写的话，i = 33（中）会写到
        // rest[34]，把数组悄悄撑长一格。
        rest[i + 1] -= runs;
        rest[i + 2] -= runs;
      }
      if (pair === 2) {
        groups.push([i, i]);
      }
      if (triplet === 3) {
        groups.push([i, i, i]);
      }
      for (let k = 0; k < runs; k += 1) {
        groups.push([i, i + 1, i + 2]);
      }

      walk(rest, i + 1, pairUsed || pair === 2, groups, out);

      groups.length -= runs + (pair === 2 ? 1 : 0) + (triplet === 3 ? 1 : 0);
      if (runs > 0) {
        rest[i + 1] += runs;
        rest[i + 2] += runs;
      }
      rest[i] = n;
    }
  }
}

/**
 * 七对子拆法。
 *
 * 单列一条路径是因为它根本不是「4 面子 + 1 雀头」，普通拆解永远拆不出它。
 * 同一种牌 4 张**不**算两对（这是日麻与部分地方规则的分歧点，§2.2 取日麻口径），
 * 所以要求每种牌张数只能是 0 或 2。有副露则不可能门清，七对子直接不成立。
 */
function chiitoitsuDivision(counts: TileCounts): Division | null {
  const pairs: TileGroup[] = [];
  let total = 0;
  for (let i = 0; i < TILE_KINDS; i += 1) {
    const c = counts[i];
    if (c === 0) {
      continue;
    }
    if (c !== 2) {
      return null;
    }
    total += c;
    pairs.push([i, i]);
  }
  return total === 14 && pairs.length === 7 ? pairs : null;
}

/**
 * 国士无双拆法。
 *
 * 表示成 12 个单张组 + 1 个对子组。「长度 1 的面子」在麻将里不存在，这里是刻意的
 * 记法：拆法的契约是「把 14 张牌不重不漏地分完」，国士唯一的分法就是这样。
 *
 * 之所以要给国士也造一个拆法，而不是在上层特判：算役、算符、算点全都以「遍历拆法」
 * 为骨架，国士不出现在拆法列表里的话，它会在整条链路上处处需要 if 特判，
 * 而漏掉任何一处就是一个役满被算成诈和。
 */
function kokushiDivision(counts: TileCounts): Division | null {
  const groups: TileGroup[] = [];
  let pairs = 0;
  for (let i = 0; i < TILE_KINDS; i += 1) {
    const c = counts[i];
    if (c === 0) {
      continue;
    }
    const isYaochu = i >= HONOR_START || i % 9 === 0 || i % 9 === 8;
    if (!isYaochu) {
      return null;
    }
    if (c === 1) {
      groups.push([i]);
    } else if (c === 2) {
      pairs += 1;
      groups.push([i, i]);
    } else {
      return null;
    }
  }
  return groups.length === 13 && pairs === 1 ? groups : null;
}

/**
 * 列出一手牌的全部拆法。无解（含未和牌）时返回空数组。
 *
 * `melds` 里的牌**必须**已经算在 `counts` 里。副露不是提示而是硬约束：它把那几张
 * 牌钉死在一个面子里，不能再参与暗手的其它组合。语料的
 * `test_third_one_suit_hand_dividing`（777888999p 吃了 789p 之后只剩一种拆法）
 * 正是拿这条来打的 —— 忽略副露的话它会被拆出「三个刻子」那一支，而那一支在
 * 桌面上根本不存在。
 *
 * 返回的拆法**包含**副露那几个面子，因为算役（三色、一气通贯、对对和）要看整手
 * 五个组，不能只看暗手。
 */
export function divideHand(
  counts: TileCounts,
  melds: readonly TileGroup[] = [],
): readonly Division[] {
  const rest = [...counts];
  for (const c of rest) {
    // 5 张同种牌要在扣副露**之前**查。扣完再查的话，「5 张 1m + 碰了 111m」会被
    // 减成 2 张，看着像一副正常的雀头，于是一手不存在的牌被拆了出来。
    if (c < 0 || c > MAX_COPIES) {
      return [];
    }
  }

  const fixed: TileGroup[] = [];
  for (const meld of melds) {
    for (const tile of meld) {
      rest[tile] -= 1;
      if (rest[tile] < 0) {
        return [];
      }
    }
    fixed.push([...meld]);
  }

  const needSets = SET_COUNT - melds.length;
  if (needSets < 0) {
    return [];
  }
  let remaining = 0;
  for (const c of rest) {
    remaining += c;
  }
  if (remaining !== needSets * 3 + 2) {
    return [];
  }

  const out: Division[] = [];
  if (melds.length === 0) {
    const chiitoi = chiitoitsuDivision(rest);
    if (chiitoi !== null) {
      out.push(chiitoi);
    }
    const kokushi = kokushiDivision(rest);
    if (kokushi !== null) {
      out.push(kokushi);
    }
  }
  const regular: Division[] = [];
  walk(rest, 0, false, [], regular);
  for (const division of regular) {
    out.push([...fixed, ...division]);
  }
  return out;
}
