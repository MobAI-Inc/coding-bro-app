/**
 * 立直麻将：点数计算。
 *
 * 这是全链路里唯一没有牌型的一段 —— 纯查表加乘法，所以也是唯一能靠穷举把边界钉死
 * 的一段（语料在这里给了 108 行）。
 *
 * 基本符点 = 符 × 2^(2 + 番)，然后：
 *   荣和   闲家 ×4    庄家 ×6
 *   自摸   闲家：庄家付 ×2、另两家各付 ×1；庄家：每家付 ×2
 * 每一笔付款各自进位到百位 —— 是**分别**进位而不是算完总数再进位。3 番 30 符自摸
 * 闲家收 500/300/300 而不是 1000 的三分之一，差别就在这里。
 */

import { EAST } from "./tiles";
import type { ScoreBreakdown, WinContext } from "./types";

/** 满贯的基本符点。超过这个数的普通手牌一律按满贯算（4 番 40 符 = 2560 -> 2000）。 */
const MANGAN_BASE = 2000;
/** 役满的基本符点。 */
const YAKUMAN_BASE = 8000;
/** 累计役满的番数门槛。 */
const KAZOE_HAN = 13;

/** 每档番数的基本符点。索引即番数，5 番起脱离符数改查表。 */
function limitBase(han: number): number {
  if (han >= KAZOE_HAN) {
    /**
     * 累计役满。§2.2 没写它算役满还是三倍满，本项目取天凤口径：**算役满，且不叠加**
     * （26 番的普通手牌仍是单倍役满，只有真的凑出两个役满役才是双役满）。
     */
    return YAKUMAN_BASE;
  }
  if (han >= 11) {
    return 6000; // 三倍满
  }
  if (han >= 8) {
    return 4000; // 倍满
  }
  if (han >= 6) {
    return 3000; // 跳满
  }
  return MANGAN_BASE; // 满贯
}

/** 进位到百位。点数表里所有付款都是百位整数。 */
function roundUp100(value: number): number {
  return Math.ceil(value / 100) * 100;
}

/**
 * 算一次和了的各项点数。
 *
 * `isYakuman` 与「番数 >= 13」不是一回事：前者表示番数来自**役满役**（大三元、四暗刻
 * 之类），此时 26 番就是双役满、39 番是三倍役满，按倍数翻；后者是累计役满，封顶在
 * 单倍。分不清的话，一手 13 番的断幺平和三色一杯口宝牌会被当成役满付 32000。
 */
export function calculateScores(
  han: number,
  fu: number,
  context: WinContext,
  isYakuman: boolean,
): ScoreBreakdown {
  const isDealer = context.playerWind === EAST;

  let base: number;
  if (isYakuman) {
    // 役满役叠出来的番数按 13 番一倍翻。语料的 26/39/52/65/78 番就是拿这条钉死的。
    base = YAKUMAN_BASE * Math.floor(han / KAZOE_HAN);
  } else if (han >= 5) {
    base = limitBase(han);
  } else {
    const raw = fu * Math.pow(2, 2 + han);
    // 4 番 40 符 / 3 番 70 符会算出超过满贯的基本点。切上满贯（本项目不采用「切上满贯」
    // 之外的流派，如允许 12000 点的 4 番 40 符）。
    base = Math.min(raw, MANGAN_BASE);
  }

  let main: number;
  let additional: number;
  if (context.isTsumo) {
    if (isDealer) {
      // 庄家自摸：三家各付两倍。main 与 additional 相同，但仍分开返回 ——
      // 上层要按「谁付了多少」逐个扣分，合并成一个数就没法区分了。
      main = roundUp100(base * 2);
      additional = main;
    } else {
      main = roundUp100(base * 2); // 庄家付的那份
      additional = roundUp100(base); // 另两个闲家各付的那份
    }
  } else {
    main = roundUp100(base * (isDealer ? 6 : 4));
    additional = 0;
  }

  // 本场棒：荣和由放铳者一人付 300/本场；自摸由三家各付 100/本场。
  const mainBonus = context.isTsumo ? context.honba * 100 : context.honba * 300;
  const additionalBonus = context.isTsumo ? context.honba * 100 : 0;
  const riichiStickBonus = context.riichiSticks * 1000;

  return {
    main,
    additional,
    mainBonus,
    additionalBonus,
    riichiStickBonus,
    total:
      main +
      additional * 2 +
      mainBonus +
      additionalBonus * 2 +
      riichiStickBonus,
  };
}
