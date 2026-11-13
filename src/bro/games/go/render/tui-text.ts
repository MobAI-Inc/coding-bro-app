

import type { BoardSize, Stone } from "../logic";
import { BLACK, EMPTY, WHITE } from "../logic";
import type { GoView } from "../view";
import { starPoints } from "./layout";

/** 棋盘字符。改这里就能整体换字符集，不必翻遍渲染代码。 */
export const GLYPH = {
  black: "●",
  white: "○",
  intersection: "┼",
  star: "╋",
  /** 横向连接两个交叉点的线。棋子之间不画线，否则会挤成一团。 */
  link: "─",
} as const;

/** 列标。用字母是国际通行记法，且跳过 I 以免与 1 混淆。 */
const COLUMN_LABELS = "ABCDEFGHJKLMNOPQRST";

/** 行号栏宽度。19 路要两位，9/13 路也按两位对齐，换棋盘时版面不跳。 */
const ROW_LABEL_WIDTH = 2;

/**
 * 把局面排成字符网格。
 *
 * 行号从上到下递减（19…1），与围棋棋谱一致——直接用数组下标当行号
 * 会让棋谱对不上，棋手记录的坐标全错。
 */
export function renderBoardText(view: GoView): string {
  const { size } = view;
  const lines: string[] = [];

  for (let row = 0; row < size; row += 1) {
    const label = String(size - row).padStart(ROW_LABEL_WIDTH, " ");
    let line = `${label} `;
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      line += glyphAt(view, index);
      if (col < size - 1) line += linkAt(view.cells, index);
    }
    lines.push(line);
  }

  lines.push(
    " ".repeat(ROW_LABEL_WIDTH + 1) +
      COLUMN_LABELS.slice(0, size).split("").join(" "),
  );

  return lines.join("\n");
}

/**
 * 光标所在交叉点在 `renderBoardText` 结果里的字符下标。
 *
 * 每行等宽（行号栏 + 空格 + 交叉点与连接线交替），所以能直接算，
 * 不必扫描字符串。
 */
export function cursorTextOffset(size: BoardSize, index: number): number {
  const row = Math.floor(index / size);
  const col = index % size;
  // 末列没有连接线，故为 size*2 - 1
  const lineLength = ROW_LABEL_WIDTH + 1 + size * 2 - 1;
  return row * (lineLength + 1) + ROW_LABEL_WIDTH + 1 + col * 2;
}

/** 单个交叉点的字符。 */
function glyphAt(view: GoView, index: number): string {
  const stone = view.cells[index];
  if (stone === BLACK) return GLYPH.black;
  if (stone === WHITE) return GLYPH.white;
  return starPointSet(view.size).has(index) ? GLYPH.star : GLYPH.intersection;
}

/**
 * 两个交叉点之间的连接字符。
 *
 * 任一端有子就留空格：棋子本身已经占满格位，再画线会让两颗子看起来
 * 连成一体，分不出是两颗还是一颗。
 */
function linkAt(cells: readonly Stone[], index: number): string {
  return cells[index] === EMPTY && cells[index + 1] === EMPTY
    ? GLYPH.link
    : " ";
}

/** 星位下标缓存。每帧重算 19 路的星位没必要。 */
const starCache = new Map<BoardSize, Set<number>>();
function starPointSet(size: BoardSize): Set<number> {
  let set = starCache.get(size);
  if (!set) {
    set = new Set(starPoints(size));
    starCache.set(size, set);
  }
  return set;
}

/**
 * 底部状态栏。
 *
 * UI-DESIGN.md §6.3 有一条硬性要求：状态栏列出的快捷键必须与当前真正
 * 生效的完全一致。所以这里接收 `canAct`——轮不到你时不能显示「Enter
 * 落子」，那是骗人。
 */
export function renderStatusBar(view: GoView, canAct: boolean): string {
  const captures = `提子 ●${view.captures.black} ○${view.captures.white}`;

  if (view.score) {
    const { winner, margin } = view.score;
    const verdict =
      winner === null
        ? "和棋"
        : `${winner === BLACK ? "黑" : "白"}胜 ${Math.abs(margin)} 目`;
    return `终局 ${verdict} · ${captures} · q 退出`;
  }

  const keys = canAct
    ? "hjkl/方向键 移动 · Enter 落子 · p 虚手 · q 退出"
    : "等待对手 · q 退出";
  const warn = view.passes === 1 ? " · 对方虚手，再虚一手即终局" : "";

  return `${captures} · ${keys}${warn}`;
}

/** 交叉点下标 → 棋谱坐标，如 `Q16`。用于棋谱与日志。 */
export function coordLabel(size: BoardSize, index: number): string {
  return `${COLUMN_LABELS[index % size]}${size - Math.floor(index / size)}`;
}
