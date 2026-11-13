/**
 * 立直麻将：和牌判定。
 *
 * 「这 14 张能不能和牌」= 能否拆成 4 面子 + 1 雀头，或七对子，或国士无双。
 *
 * 判定与拆解分开两个模块，原因是用途不同：和牌判定只要回答是/否，可以一路贪心
 * 早退；拆解要枚举**全部**拆法（同一手牌可能既是二杯口又是三色，番数不同，
 * 必须都算出来再取高）。把两者合成一个函数，结果要么是判定被拖慢，要么是拆解
 * 被贪心剪掉了正确的那一支。
 */

import { HONOR_START, TILE_KINDS } from "./tiles";
import type { TileCounts } from "./tiles";
import type { TileGroup } from "./types";

/** 一手牌里同一种牌最多 4 张。多于 4 张的牌型在牌山里不存在。 */
const MAX_COPIES = 4;

/**
 * 递归吃掉一个花色区间内的面子。
 *
 * 只从**最小的未消耗牌**开始试，这是穷举不重不漏的关键：每一步都必须处理掉当前
 * 最小的那张牌（否则它永远没机会被处理），而它只有两种归宿 —— 刻子或顺子的头。
 * 若换成「任选一张来试」，同一种拆法会沿不同顺序被数出很多遍。
 */
function consumeSuit(rest: number[], start: number, end: number): boolean {
  let i = start;
  while (i < end && rest[i] === 0) {
    i += 1;
  }
  if (i >= end) {
    return true;
  }
  if (rest[i] >= 3) {
    rest[i] -= 3;
    if (consumeSuit(rest, i, end)) {
      rest[i] += 3;
      return true;
    }
    rest[i] += 3;
  }
  // `i + 2 < end` 是**唯一**挡住顺子跨花色的东西：调用方按花色分段传 [start, end)，
  // 越过 end 就是下一门花色了。写成 `i + 2 < TILE_KINDS` 之类的全局上界，
  // `8m9m1p` 就成了合法顺子。
  if (i + 2 < end && rest[i + 1] > 0 && rest[i + 2] > 0) {
    rest[i] -= 1;
    rest[i + 1] -= 1;
    rest[i + 2] -= 1;
    if (consumeSuit(rest, i, end)) {
      rest[i] += 1;
      rest[i + 1] += 1;
      rest[i + 2] += 1;
      return true;
    }
    rest[i] += 1;
    rest[i + 1] += 1;
    rest[i + 2] += 1;
  }
  return false;
}

/** 字牌只能成刻，散张或对子（雀头已扣除后）一律不成立。 */
function honorsOk(rest: number[]): boolean {
  for (let i = HONOR_START; i < TILE_KINDS; i += 1) {
    if (rest[i] !== 0 && rest[i] !== 3) {
      return false;
    }
  }
  return true;
}

function allGroupsFormed(counts: TileCounts): boolean {
  const rest = [...counts];
  if (!honorsOk(rest)) {
    return false;
  }
  for (let i = HONOR_START; i < TILE_KINDS; i += 1) {
    rest[i] = 0;
  }
  return (
    consumeSuit(rest, 0, 9) &&
    consumeSuit(rest, 9, 18) &&
    consumeSuit(rest, 18, 27)
  );
}

/** 七对子：恰好 14 张、恰好 7 个对子。同一种牌 4 张算两对是**不**成立的。 */
export function isChiitoitsu(counts: TileCounts): boolean {
  let pairs = 0;
  let total = 0;
  for (const c of counts) {
    if (c !== 0 && c !== 2) {
      return false;
    }
    total += c;
    if (c === 2) {
      pairs += 1;
    }
  }
  return total === 14 && pairs === 7;
}

/** 国士无双：13 种幺九字牌各至少一张，其中恰好一种是两张。 */
export function isKokushi(counts: TileCounts): boolean {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < TILE_KINDS; i += 1) {
    const c = counts[i];
    if (c === 0) {
      continue;
    }
    const isYaochu = i >= HONOR_START || i % 9 === 0 || i % 9 === 8;
    if (!isYaochu) {
      return false;
    }
    total += 1;
    if (c === 2) {
      pairs += 1;
    } else if (c !== 1) {
      return false;
    }
  }
  return total === 13 && pairs === 1;
}

/**
 * 是否和牌。
 *
 * `melds` 是已副露的面子（Tile34 组），且**必须**已经包含在 `counts` 里 ——
 * 上游语料就是这么组织的，把副露另算会让张数对不上。
 *
 * 副露不是「顺便记一下」：它把对应的牌**锁死**了。语料的
 * `test_is_agari_and_open_hand`（碰了 555s 之后剩下的牌凑不出面子）证明的正是
 * 这一点 —— 只看整手 14 张能不能拆开，会把「这三张 5 索已经吃出去了、不能再
 * 参与暗手的顺子」这条约束整个漏掉，于是一手实际没和的牌被判成和了。
 *
 * 杠会让总张数多出一张（4 张占一个面子的位），所以张数校验按面子数算而不是
 * 按 14 张写死。
 */
export function isAgari(
  counts: TileCounts,
  melds: readonly TileGroup[] = [],
): boolean {
  const rest = [...counts];
  for (const c of rest) {
    if (c < 0 || c > MAX_COPIES) {
      return false;
    }
  }
  for (const meld of melds) {
    for (const tile of meld) {
      rest[tile] -= 1;
      if (rest[tile] < 0) {
        return false;
      }
    }
  }
  // 暗手要补齐的面子数 = 4 - 已副露数。每个面子 3 张，加一个雀头 2 张。
  const needSets = 4 - melds.length;
  if (needSets < 0) {
    return false;
  }
  let remaining = 0;
  for (const c of rest) {
    remaining += c;
  }
  if (remaining !== needSets * 3 + 2) {
    return false;
  }

  if (melds.length === 0 && (isChiitoitsu(rest) || isKokushi(rest))) {
    return true;
  }

  for (let pair = 0; pair < TILE_KINDS; pair += 1) {
    if (rest[pair] < 2) {
      continue;
    }
    const withoutPair = [...rest];
    withoutPair[pair] -= 2;
    if (allGroupsFormed(withoutPair)) {
      return true;
    }
  }
  return false;
}
