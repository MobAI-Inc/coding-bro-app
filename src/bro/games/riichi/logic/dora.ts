/**
 * 立直麻将：宝牌统计。
 *
 * 宝牌不是役 —— 没有役的手牌不能靠宝牌和牌。但结算时它与役同列显示、同样加番，
 * 所以放在同一条链路上算。
 *
 * 三种宝牌各有一条独立的坑：
 *   - 表宝牌：由**指示牌**推出，不是指示牌本身（指示 9 万 -> 宝牌是 1 万）。
 *   - 赤宝牌：认的是**实体牌**（136 编号），同一种 5 万里只有一张是红的。
 *     用 34 编码算的话，四张 5 万会全被当成赤宝牌。
 *   - 里宝牌：**只有立直**才生效。不判立直的话，未立直的手牌会白拿几番。
 */

import { RED_FIVES, doraFromIndicator, toTile34 } from "./tiles";
import type { Tile136 } from "./tiles";

export interface DoraCount {
  readonly dora: number;
  readonly akaDora: number;
  readonly uraDora: number;
}

function countAgainst(
  tiles: readonly Tile136[],
  indicators: readonly Tile136[],
): number {
  let total = 0;
  for (const indicator of indicators) {
    const dora = doraFromIndicator(toTile34(indicator));
    for (const tile of tiles) {
      if (toTile34(tile) === dora) {
        total += 1;
      }
    }
  }
  return total;
}

export function countDora(
  tiles: readonly Tile136[],
  doraIndicators: readonly Tile136[],
  uraDoraIndicators: readonly Tile136[],
  hasAkaDora: boolean,
  isRiichi: boolean,
): DoraCount {
  let akaDora = 0;
  if (hasAkaDora) {
    for (const tile of tiles) {
      if (RED_FIVES.includes(tile)) {
        akaDora += 1;
      }
    }
  }
  return {
    dora: countAgainst(tiles, doraIndicators),
    akaDora,
    uraDora: isRiichi ? countAgainst(tiles, uraDoraIndicators) : 0,
  };
}
