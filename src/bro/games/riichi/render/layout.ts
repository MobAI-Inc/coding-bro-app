/**
 * 立直麻将：布局换算。
 *
 * 纯函数，不碰 DOM —— Canvas 渲染器与测试共用这一份换算。
 *
 * 麻将的布局与围棋、台球有个根本差别：那两个是**连续坐标**（交叉点、米），
 * 这里是**离散的一排牌**。所以核心函数不是「米↔像素」，而是「第 i 张牌画在
 * 哪」以及它的反函数「点到的是第几张」。这两个必须严格互逆 —— 不互逆的表现是
 * 玩家点 3 万打出去 4 万，而且只在手牌张数特定时才复现。
 */

import type { Tile136, Tile34 } from "../logic";
import {
  CHUN,
  HAKU,
  HATSU,
  isHonor,
  isRedFive,
  rankOf,
  suitOf,
  toTile34,
} from "../logic";

/** 牌面高宽比。1.35 接近真牌，太方会像扑克，太长会像骨牌。 */
export const TILE_ASPECT = 1.35;

/** 手牌最多 14 张。 */
export const MAX_HAND = 14;

/** 牌河一行几张。日麻牌河标准是 6 张一行、最多三行。 */
export const POND_COLS = 6;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TableLayout {
  /** 正方形台面的边长。 */
  readonly size: number;
  /** 台面左上角在容器里的位置（居中）。 */
  readonly originX: number;
  readonly originY: number;
  /** 手牌单张尺寸。 */
  readonly tileW: number;
  readonly tileH: number;
  /** 牌河单张尺寸，比手牌小。 */
  readonly pondW: number;
  readonly pondH: number;
  /** 手牌行的顶边。 */
  readonly handY: number;
  /** 摸到的那张与其余手牌之间的间隔。 */
  readonly drawGap: number;
}

/**
 * 按容器算台面布局。
 *
 * 台面取正方形：麻将四家对称，拉成长方形会让上下家的牌河一个挤一个空。
 * 零尺寸容器返回全 0，不产生 NaN —— 首帧挂载时容器常常还没量出尺寸。
 */
export function computeTableLayout(width: number, height: number): TableLayout {
  const size = Math.max(0, Math.min(width, height));
  // 手牌一行要放下 14 张 + 摸牌间隔，留一格余量
  const tileW = size / (MAX_HAND + 2);
  const tileH = tileW * TILE_ASPECT;
  return {
    size,
    originX: (width - size) / 2,
    originY: (height - size) / 2,
    tileW,
    tileH,
    pondW: tileW * 0.62,
    pondH: tileH * 0.62,
    handY: (height - size) / 2 + size - tileH,
    drawGap: tileW * 0.5,
  };
}

/**
 * 第 i 张手牌的矩形。
 *
 * `hasDrawn` 为真时最后一张是刚摸进来的，单独往右挪一格 —— 这是麻将界面的
 * 通用约定，玩家靠它一眼分辨「哪张是刚摸的」。
 */
export function handTileRect(
  layout: TableLayout,
  index: number,
  count: number,
  hasDrawn: boolean,
): Rect {
  const gaps = hasDrawn ? layout.drawGap : 0;
  const totalW = count * layout.tileW + gaps;
  const startX = layout.originX + (layout.size - totalW) / 2;
  const isDrawn = hasDrawn && index === count - 1;
  return {
    x: startX + index * layout.tileW + (isDrawn ? layout.drawGap : 0),
    y: layout.handY,
    w: layout.tileW,
    h: layout.tileH,
  };
}

/**
 * 点到了第几张手牌。没点中返回 null。
 *
 * 必须是 {@link handTileRect} 的严格反函数 —— 不用「除以宽度」这类闭式解算，
 * 而是逐张判矩形：摸牌间隔让闭式解在间隔前后各差一张，而那种错位只在特定
 * 张数下才显形。
 */
export function hitTestHand(
  layout: TableLayout,
  px: number,
  py: number,
  count: number,
  hasDrawn: boolean,
): number | null {
  for (let i = count - 1; i >= 0; i -= 1) {
    const r = handTileRect(layout, i, count, hasDrawn);
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return i;
  }
  return null;
}

/**
 * 某家牌河里第 i 张的矩形。
 *
 * `relSeat` 是相对座位：0 自己、1 下家、2 对家、3 上家。四家牌河围着中央
 * 摆一圈，但都按「横排」画不做旋转 —— 旋转 90° 的牌河更还原真牌桌，可它让
 * 上下家的牌变成竖排，在小窗口里根本认不出是什么牌。可读性优先。
 */
export function pondTileRect(
  layout: TableLayout,
  relSeat: number,
  index: number,
): Rect {
  const col = index % POND_COLS;
  const row = Math.floor(index / POND_COLS);
  const blockW = POND_COLS * layout.pondW;
  const cx = layout.originX + layout.size / 2;
  const cy = layout.originY + layout.size / 2;
  // 中央信息区的半径：牌河从这里往外排。
  //
  // 下界是左右两家牌河的半高：它们竖着排 6 张，占 POND_COLS * pondH，比横排的
  // 6 张宽（牌是竖长的）。只按 size 的固定比例取半径的话，左右两家的牌河会探进
  // 上下两家的区域 —— 实测 600×600 时半径 66，而半高是 94，重叠 28 像素，表现
  // 是左右家最后几张牌盖在自己牌河的头两张上，谁打的谁没打完全分不出来。
  const inner = Math.max(layout.size * 0.11, (POND_COLS * layout.pondH) / 2);

  switch (relSeat) {
    case 0: // 自己：中央下方，从里往外
      return {
        x: cx - blockW / 2 + col * layout.pondW,
        y: cy + inner + row * layout.pondH,
        w: layout.pondW,
        h: layout.pondH,
      };
    case 2: // 对家：中央上方，往上叠
      return {
        x: cx - blockW / 2 + col * layout.pondW,
        y: cy - inner - (row + 1) * layout.pondH,
        w: layout.pondW,
        h: layout.pondH,
      };
    case 1: // 下家：右侧
      return {
        x: cx + inner + row * layout.pondW,
        y: cy - (POND_COLS * layout.pondH) / 2 + col * layout.pondH,
        w: layout.pondW,
        h: layout.pondH,
      };
    default: // 上家：左侧
      return {
        x: cx - inner - (row + 1) * layout.pondW,
        y: cy - (POND_COLS * layout.pondH) / 2 + col * layout.pondH,
        w: layout.pondW,
        h: layout.pondH,
      };
  }
}

/* ------------------------------------------------------------------ *
 * 牌面文字
 * ------------------------------------------------------------------ */

/** 字牌的汉字。顺序与 tiles.ts 的常量一致：东南西北白发中。 */
const HONOR_TEXT = ["东", "南", "西", "北", "白", "发", "中"] as const;

/** 花色后缀。万 m / 饼 p / 索 s，与语料记法一致。 */
const SUIT_SUFFIX = ["m", "p", "s"] as const;

/**
 * 牌的短记法：`3m`、`东`。数牌带花色后缀，字牌直接是汉字。
 *
 * `rankOf` 返回的是 0..8，显示要 +1 —— 不加的话 1 万会写成 `0m`，而 `0m`
 * 在语料记法里是赤 5 万，两者会撞在一起。
 */
export function tileLabel(tile: Tile34): string {
  if (isHonor(tile)) return HONOR_TEXT[tile - 27];
  return `${rankOf(tile) + 1}${SUIT_SUFFIX[suitOf(tile)]}`;
}

/**
 * 牌的 Unicode 麻将字符。
 *
 * 三元牌的顺序是个坑：Unicode 里是「中发白」（U+1F004..1F006），我们的常量
 * 是「白发中」（HAKU=31 < HATSU=32 < CHUN=33）。顺着加会把白板画成红中。
 */
export function tileGlyph(tile: Tile34): string {
  if (tile === CHUN) return "\u{1F004}";
  if (tile === HATSU) return "\u{1F005}";
  if (tile === HAKU) return "\u{1F006}";
  if (isHonor(tile)) return String.fromCodePoint(0x1f000 + (tile - 27)); // 东南西北
  const suit = suitOf(tile);
  const rank = rankOf(tile); // 0..8
  if (suit === 0) return String.fromCodePoint(0x1f007 + rank); // 万
  if (suit === 1) return String.fromCodePoint(0x1f019 + rank); // 饼
  return String.fromCodePoint(0x1f010 + rank); // 索
}

/** 实体牌的显示文字。赤 5 显示成 `0m`，与语料记法一致。 */
export function labelOf(tile: Tile136): string {
  return isRedFive(tile)
    ? `0${SUIT_SUFFIX[suitOf(toTile34(tile))]}`
    : tileLabel(toTile34(tile));
}
