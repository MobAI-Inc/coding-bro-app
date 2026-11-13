/**
 * 棋子字形表。
 *
 * 单独成文件是因为 Canvas 与 TUI 两个渲染器都要用它，而它既不属于几何
 * （layout.ts）也不属于字符排版（tui-text.ts）。围棋没有这个文件，是因为
 * 围棋的子只有黑白两个圆，没有「字」这回事。
 *
 * **红黑用不同的字，不只是不同的颜色。** 帥/將、仕/士、相/象、傌/馬、
 * 俥/車、炮/砲、兵/卒——七个兵种无一重复。这是 UI-DESIGN.md §9「颜色不作为
 * 唯一信息载体」在棋盘上的落地：色盲用户、灰度截图、黑白打印下都还分得清
 * 敌我。两张表不得有交集，有测试守着；哪天为了「统一」把红黑写成同一组字，
 * 那条测试会拦下来。
 */

import type { Piece, PieceType, Side } from "../logic";

/** 红方字形。用繁体的「俥傌炮」而非「车马炮」，这是红黑分字的传统写法。 */
export const RED_GLYPH: Readonly<Record<PieceType, string>> = {
  K: "帥",
  A: "仕",
  B: "相",
  N: "傌",
  R: "俥",
  C: "炮",
  P: "兵",
};

/** 黑方字形。 */
export const BLACK_GLYPH: Readonly<Record<PieceType, string>> = {
  K: "將",
  A: "士",
  B: "象",
  N: "馬",
  R: "車",
  C: "砲",
  P: "卒",
};

/** 棋子的显示字形。 */
export function glyphOf(piece: Piece): string {
  return piece.side === "red" ? RED_GLYPH[piece.type] : BLACK_GLYPH[piece.type];
}

/** 该方的字形表。 */
export function glyphTable(side: Side): Readonly<Record<PieceType, string>> {
  return side === "red" ? RED_GLYPH : BLACK_GLYPH;
}

/**
 * 棋子的无障碍名称，如「红俥」。
 *
 * 供 `aria-label` 与战报使用——字形本身对读屏软件是一个孤字，念出来没有
 * 归属信息，必须把颜色补进去。
 */
export function pieceLabel(piece: Piece): string {
  return `${piece.side === "red" ? "红" : "黑"}${glyphOf(piece)}`;
}
