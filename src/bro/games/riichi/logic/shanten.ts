/**
 * 立直麻将：向听数。
 *
 * 向听 = 距离听牌还差几次有效摸牌。听牌 0，和牌 -1。
 *
 * 这里**不用**流行的「8 - 2×面子 - 搭子」速算式，而是直接按定义算：
 *
 *   向听 = min{ 把手牌变成某个合法和牌型 W 所需补进的张数 } - 1
 *
 * 原因是速算式会漏掉牌山张数上限。语料的 `11112222333444z` 就是拿这个来打的：
 * 111z/222z/333z/444z 四个刻子加一张孤张 1z，速算式判成 0（单骑听 1z），但那四张
 * 1z 已经全在手里，第五张不存在，实际是 1 向听 —— 语料写的正是 1。同类用例还有
 * `123456789m1111z`、`1111m123p112233s`、`333444555m1111s`，速算式全会少算一向听。
 * AI 每回合靠这个数决定打哪张，少算一向听会让它一直守着一手永远不可能和的牌。
 *
 * 按定义算的代价是要枚举 W，所以用一趟从 1m 扫到中的 DP：逐张决定 W 里这张牌
 * 用作几个刻子 / 是否雀头 / 起几个顺子，把「跨三张」的顺子用两个进位带过去。
 * 状态只有 (进位1, 进位2, 已成面子数, 雀头是否用掉) 共 250 种，扫 34 张即可。
 */

import { HONOR_START, TILE_KINDS } from "./tiles";
import type { TileCounts } from "./tiles";

/** 和牌状态。向听数为负是有意义的：它让「和了」和「听牌」在同一个数轴上比较。 */
export const AGARI_STATE = -1;

/** 一手牌里同一种牌最多 4 张 —— 整个模块存在的理由就是这一条。 */
const MAX_COPIES = 4;

/** 完整和牌型的面子数（不含雀头）。 */
const SET_COUNT = 4;

/** 一趟 DP 里的不可达标记。用 Infinity 而不是大整数，免得被后面的加法悄悄溢出成可达。 */
const UNREACHABLE = Number.POSITIVE_INFINITY;

function totalOf(counts: TileCounts): number {
  let total = 0;
  for (const c of counts) {
    total += c;
  }
  return total;
}

/**
 * 张数校验。
 *
 * 顺序不能反：15 张同时满足「超量」和「3n 张」两个条件（15 % 3 === 0），
 * 先查 3n 的话会报成「张数非法」，把「你多拿了一张牌」这个真正的错因盖掉。
 */
function assertTileCount(counts: TileCounts): number {
  const total = totalOf(counts);
  if (total > 14) {
    throw new Error(`Too many tiles = ${total}`);
  }
  if (total % 3 === 0) {
    throw new Error(`Invalid tile count`);
  }
  return total;
}

/**
 * 已副露的面子数，由张数反推。
 *
 * 本模块只拿到暗手 34 数组，看不到副露；但少三张就等于多一个面子已经在桌上了。
 * 不反推的话，11 张的手牌会被当成缺两个面子，向听凭空多算 2。
 */
function impliedMelds(total: number): number {
  return Math.floor((14 - total) / 3);
}

/** DP 状态编号：(前一张起的顺子数, 前两张起的顺子数, 已成面子数, 雀头已用)。 */
function stateIndex(
  r1: number,
  r2: number,
  sets: number,
  pair: number,
): number {
  return ((r1 * 5 + r2) * (SET_COUNT + 1) + sets) * 2 + pair;
}

const STATE_COUNT = 5 * 5 * (SET_COUNT + 1) * 2;

/**
 * 补齐成合法和牌型所需的最少补牌数。
 *
 * `needSets` 是暗手还要凑的面子数（4 减去副露数）。返回 Infinity 表示凑不出
 * —— 只会发生在 needSets < 0 这种输入本身就坏了的情况。
 */
function minTilesToWin(counts: TileCounts, needSets: number): number {
  let current = new Float64Array(STATE_COUNT).fill(UNREACHABLE);
  current[stateIndex(0, 0, 0, 0)] = 0;

  for (let i = 0; i < TILE_KINDS; i += 1) {
    const next = new Float64Array(STATE_COUNT).fill(UNREACHABLE);
    const have = counts[i];
    // 字牌无顺子；数牌的顺子不能跨花色，所以只有花色内第 1~7 张能起顺。
    const canStartRun = i < HONOR_START && i % 9 <= 6;

    for (let r1 = 0; r1 < 5; r1 += 1) {
      for (let r2 = 0; r2 < 5; r2 += 1) {
        for (let sets = 0; sets <= SET_COUNT; sets += 1) {
          for (let pair = 0; pair < 2; pair += 1) {
            const cost = current[stateIndex(r1, r2, sets, pair)];
            if (cost === UNREACHABLE) {
              continue;
            }
            // 刻子最多一组：两组就要 6 张，牌山里没有。
            for (let triplets = 0; triplets <= 1; triplets += 1) {
              for (let asPair = 0; asPair <= 1 - pair; asPair += 1) {
                for (let runs = 0; runs <= MAX_COPIES; runs += 1) {
                  if (runs > 0 && !canStartRun) {
                    break;
                  }
                  if (sets + triplets + runs > needSets) {
                    break;
                  }
                  // W 里这张牌的张数 = 自己起的刻子/雀头/顺子 + 前两张顺子带过来的。
                  const used = triplets * 3 + asPair * 2 + runs + r1 + r2;
                  if (used > MAX_COPIES) {
                    break;
                  }
                  const add = used > have ? used - have : 0;
                  const key = stateIndex(
                    runs,
                    r1,
                    sets + triplets + runs,
                    pair + asPair,
                  );
                  const total = cost + add;
                  if (total < next[key]) {
                    next[key] = total;
                  }
                }
              }
            }
          }
        }
      }
    }
    current = next;
  }

  // 收尾：顺子进位必须清零（扫完 34 张自然如此），面子数凑齐，雀头用掉。
  return current[stateIndex(0, 0, needSets < 0 ? 0 : needSets, 1)];
}

/** 一般型（4 面子 + 1 雀头）向听数。 */
export function shantenRegular(counts: TileCounts): number {
  const total = assertTileCount(counts);
  const needSets = SET_COUNT - impliedMelds(total);
  if (needSets < 0) {
    throw new Error(`Invalid tile count`);
  }
  return minTilesToWin(counts, needSets) - 1;
}

/**
 * 七对子向听数。
 *
 * 两项缺一不可：缺对子要补对子（`6 - pairs`），而牌种不足 7 种时，就算对子数够也
 * 得先换出重复的第 3、4 张（`7 - kinds`）。只写前一项的话，`2255m55p66677888s`
 * 会被算成 0 向听 —— 它有 6 个对子，但只有 6 种牌，实际是 1 向听，语料写的是 1。
 */
export function shantenChiitoitsu(counts: TileCounts): number {
  let pairs = 0;
  let kinds = 0;
  for (const c of counts) {
    if (c > 0) {
      kinds += 1;
    }
    if (c >= 2) {
      pairs += 1;
    }
  }
  const shortage = kinds < 7 ? 7 - kinds : 0;
  return 6 - pairs + shortage;
}

/** 国士无双向听数：13 种幺九各一张，其中一种成对。 */
export function shantenKokushi(counts: TileCounts): number {
  let kinds = 0;
  let hasPair = false;
  for (let i = 0; i < TILE_KINDS; i += 1) {
    if (i < HONOR_START && i % 9 !== 0 && i % 9 !== 8) {
      continue;
    }
    if (counts[i] > 0) {
      kinds += 1;
    }
    if (counts[i] >= 2) {
      hasPair = true;
    }
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/**
 * 三种形态取最小。
 *
 * 七对子与国士只在**门清且 13/14 张**时成立 —— 有副露就不门清，而副露会让张数
 * 掉到 11 张以下。所以这里用张数来判，而不是要求调用方额外传副露：语料的
 * `test_calculate_shanten_kokushi_should_be_ignored_when_melds_exist` 正是拿一手
 * 11 张的国士型来验这条（开/关国士开关结果必须一致）。
 */
export function shanten(
  counts: TileCounts,
  options?: { useKokushi?: boolean; useChiitoitsu?: boolean },
): number {
  const total = assertTileCount(counts);
  let best = shantenRegular(counts);
  if (total >= 13) {
    if (options?.useChiitoitsu !== false) {
      best = Math.min(best, shantenChiitoitsu(counts));
    }
    if (options?.useKokushi !== false) {
      best = Math.min(best, shantenKokushi(counts));
    }
  }
  return best;
}
