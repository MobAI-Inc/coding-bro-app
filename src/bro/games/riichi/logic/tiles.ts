/**
 * 立直麻将：牌的表示。
 *
 * 全局只有两种编码，任何一处混用都会静默算错，所以先把它们钉死：
 *
 * - **Tile34**（0..33）：牌的**种类**。万 0-8、饼 9-17、索 18-26、
 *   字牌 27-33（东南西北白发中）。判役、算符、拆牌一律用这个 —— 规则关心
 *   「是不是 5 索」，不关心「是四张 5 索里的哪一张」。
 * - **Tile136**（0..135）：牌的**实体**，`tile34 * 4 + 第几张`。只有两处
 *   非用不可：赤宝牌（同一种类里只有特定那张是红的）、以及和了牌要指认
 *   具体是哪张。
 *
 * 换算永远是单向的：`tile136 >> 2` 得到 Tile34，反过来则要补上「第几张」，
 * 补错就会把普通 5 万当成赤 5 万。所以本文件不提供 34→136 的转换函数，
 * 需要具体张时必须从实际牌堆里取。
 */

/** 牌的种类，0..33。 */
export type Tile34 = number;

/** 牌的实体，0..135。`tile34 * 4 + copy`。 */
export type Tile136 = number;

/** 牌种总数。 */
export const TILE_KINDS = 34;

/** 各花色在 34 编码里的起始下标。 */
export const MAN_START = 0;
export const PIN_START = 9;
export const SOU_START = 18;
export const HONOR_START = 27;

/** 字牌。风牌顺序即座位顺序（东南西北），三元牌顺序即白发中。 */
export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const HAKU = 31;
export const HATSU = 32;
export const CHUN = 33;

/** 四张风牌。顺序与座位轮转一致，别改。 */
export const WINDS: readonly Tile34[] = [EAST, SOUTH, WEST, NORTH];

/** 三元牌（白发中）。 */
export const DRAGONS: readonly Tile34[] = [HAKU, HATSU, CHUN];

/**
 * 幺九牌：三色的 1 和 9，不含字牌。
 *
 * 与 {@link isTerminalOrHonor} 的区别是纯九字面上最容易搞混的地方：
 * 纯全带幺九（junchan）只认这七张，混全带幺九（chantai）还认字牌。
 */
export const TERMINALS: readonly Tile34[] = [0, 8, 9, 17, 18, 26];

/** 三色的 5，赤宝牌就长在这三个种类里。 */
export const FIVES: readonly Tile34[] = [4, 13, 22];

/**
 * 三张赤宝牌的 136 编号：赤 5 万 16、赤 5 饼 52、赤 5 索 88。
 *
 * 即每个 5 的第 0 张。这是个约定而非推导 —— 牌山里必须按同一约定发牌，
 * 否则「哪张 5 是红的」两边对不上。
 */
export const RED_FIVES: readonly Tile136[] = [16, 52, 88];

/** 实体牌 -> 种类。 */
export function toTile34(tile: Tile136): Tile34 {
  return tile >> 2;
}

/** 是否字牌（风牌或三元牌）。 */
export function isHonor(tile: Tile34): boolean {
  return tile >= HONOR_START;
}

/** 是否幺九牌（1 或 9，不含字牌）。 */
export function isTerminal(tile: Tile34): boolean {
  return !isHonor(tile) && (tile % 9 === 0 || tile % 9 === 8);
}

/** 是否幺九牌或字牌。 */
export function isTerminalOrHonor(tile: Tile34): boolean {
  return isHonor(tile) || isTerminal(tile);
}

/** 是否赤宝牌。 */
export function isRedFive(tile: Tile136): boolean {
  return RED_FIVES.includes(tile);
}

/** 花色区号：0 万 / 1 饼 / 2 索 / 3 字。 */
export function suitOf(tile: Tile34): number {
  return isHonor(tile) ? 3 : Math.floor(tile / 9);
}

/** 数牌在本花色内的序数 0..8。字牌返回 -1。 */
export function rankOf(tile: Tile34): number {
  return isHonor(tile) ? -1 : tile % 9;
}

/** 34 位张数数组。下标是 Tile34，值是张数。 */
export type TileCounts = number[];

/** 新建一个全 0 的张数数组。 */
export function emptyCounts(): TileCounts {
  return new Array<number>(TILE_KINDS).fill(0);
}

/** 把一组实体牌折算成张数数组。 */
export function countsOf(tiles: readonly Tile136[]): TileCounts {
  const counts = emptyCounts();
  for (const tile of tiles) {
    counts[toTile34(tile)] += 1;
  }
  return counts;
}

/**
 * 宝牌指示牌 -> 宝牌。
 *
 * 三条独立的环：数牌 9→1、风牌 北→东、三元牌 中→白。三条环必须分开绕，
 * 把 34 个下标当成一条环来 +1 会让 9 万变 1 饼、北变白 —— 这种错在指示牌
 * 恰好是 9 或北时才发作，正常对局里能藏很久。
 */
export function doraFromIndicator(indicator: Tile34): Tile34 {
  if (indicator < HONOR_START) {
    const suit = Math.floor(indicator / 9);
    return suit * 9 + (((indicator % 9) + 1) % 9);
  }
  if (indicator <= NORTH) {
    return EAST + ((indicator - EAST + 1) % 4);
  }
  return HAKU + ((indicator - HAKU + 1) % 3);
}
