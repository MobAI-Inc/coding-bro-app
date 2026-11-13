

import type { Piece } from "../logic";
import { FILES, RANKS, formatSquare } from "../logic";
import type { XiangqiView } from "../view";
import {
  UNDO_PLIES,
  awaitingMyReply,
  canRequestUndo,
  undoRequestsLeft,
} from "../view";
import { glyphOf } from "./glyphs";
import { RIVER_TOP_ROW, palacePoints } from "./layout";

/** 非棋子格的字符。改这里就能整体换字符集，不必翻遍渲染代码。 */
export const GLYPH = {
  /** 普通交叉点。 */
  point: "┼",
  /** 九宫内的交叉点。九宫范围是象棋的硬规则，画出来玩家才知道将士的活动范围。 */
  palace: "╬",
  /** 河界。 */
  river: "~",
  /** 行号/列标栏与河界行首的空位。 */
  blank: " ",
} as const;

/**
 * 河界行的九个字。
 *
 * 「楚河漢界」不是装饰，是棋盘的一部分——少了它这就是一张 9×10 的网格纸。
 * 长度必须等于列数，否则整行错位，有测试守着。
 */
const RIVER_CELLS: readonly string[] = [
  GLYPH.river,
  "楚",
  "河",
  GLYPH.river,
  GLYPH.river,
  GLYPH.river,
  "漢",
  "界",
  GLYPH.river,
];

/** 河界占的文本行号：紧挨在「红方已过河的最后一行」下面。 */
export const RIVER_TEXT_ROW = RIVER_TOP_ROW + 1;

/** 网格行数：10 行棋盘 + 1 行河界 + 1 行列标。 */
export const GRID_ROWS = RANKS + 2;
/** 网格列数：1 列行号 + 9 列棋盘。 */
export const GRID_COLS = FILES + 1;

export type TuiCellKind =
  /** 空的交叉点。 */
  | "point"
  /** 九宫内的空交叉点。 */
  | "palace"
  | "red"
  | "black"
  | "river"
  /** 行号与列标。 */
  | "label";

export type TuiMark =
  | "cursor"
  | "selected"
  /** 可走的空点。 */
  | "target"
  /** 可吃的敌子。与 target 分开，因为「走过去」和「吃掉它」值得画成两样。 */
  | "capture"
  /** 最后一手的起点或终点。 */
  | "last"
  /** 正被将军的将/帅。 */
  | "check";

export interface TuiCell {
  readonly glyph: string;
  readonly kind: TuiCellKind;
  /** 对应的交叉点下标。行号、列标、河界格为 `null`。 */
  readonly index: number | null;
  readonly marks: readonly TuiMark[];
}

/** 渲染器的本地装饰状态。不进服务端快照，也不因对手走子而重置。 */
export interface BoardDecor {
  readonly cursor: number | null;
  readonly selected: number | null;
  /** 从选中点出发的合法落点。由 selection.ts 的 `targetsFrom` 算好传进来。 */
  readonly targets: ReadonlySet<number>;
}

const EMPTY_DECOR: BoardDecor = {
  cursor: null,
  selected: null,
  targets: new Set(),
};

/** 九宫点集合。九宫位置是定值，每帧重算 18 个点没必要。 */
const PALACE_SET = new Set([...palacePoints("red"), ...palacePoints("black")]);

/**
 * 把局面排成字符网格。
 *
 * 行号沿用规则层的坐标（0..9，row 0 是黑方底线），列标沿用 a..i——两者都直接
 * 取自 `formatSquare`，而不是另写一张字母表。日志、错误信息、棋谱与界面必须
 * 说同一种坐标，否则「a3 那个马」在界面上找不到。
 */
export function renderBoardCells(
  view: XiangqiView,
  decor: BoardDecor = EMPTY_DECOR,
): TuiCell[][] {
  const rows: TuiCell[][] = [];

  for (let text = 0; text < GRID_ROWS; text += 1) {
    if (text === RIVER_TEXT_ROW) {
      rows.push([labelCell(GLYPH.blank), ...RIVER_CELLS.map(riverCell)]);
      continue;
    }
    if (text === GRID_ROWS - 1) {
      rows.push([labelCell(GLYPH.blank), ...columnLabels()]);
      continue;
    }

    const row = text < RIVER_TEXT_ROW ? text : text - 1;
    const line: TuiCell[] = [labelCell(String(row))];
    for (let col = 0; col < FILES; col += 1) {
      line.push(boardCell(view, decor, row * FILES + col));
    }
    rows.push(line);
  }

  return rows;
}

function columnLabels(): TuiCell[] {
  return Array.from({ length: FILES }, (_, col) =>
    labelCell(formatSquare({ col, row: 0 })[0]),
  );
}

function labelCell(glyph: string): TuiCell {
  return { glyph, kind: "label", index: null, marks: [] };
}

function riverCell(glyph: string): TuiCell {
  return { glyph, kind: "river", index: null, marks: [] };
}

function boardCell(
  view: XiangqiView,
  decor: BoardDecor,
  index: number,
): TuiCell {
  const piece = view.board[index] ?? null;
  return {
    glyph: piece ? glyphOf(piece) : baseGlyph(index),
    kind: piece ? piece.side : PALACE_SET.has(index) ? "palace" : "point",
    index,
    marks: marksAt(view, decor, index, piece),
  };
}

function baseGlyph(index: number): string {
  return PALACE_SET.has(index) ? GLYPH.palace : GLYPH.point;
}

function marksAt(
  view: XiangqiView,
  decor: BoardDecor,
  index: number,
  piece: Piece | null,
): TuiMark[] {
  const marks: TuiMark[] = [];
  if (decor.cursor === index) marks.push("cursor");
  if (decor.selected === index) marks.push("selected");
  if (decor.targets.has(index)) marks.push(piece ? "capture" : "target");
  if (view.lastMove?.from === index || view.lastMove?.to === index) {
    marks.push("last");
  }
  if (view.checkSquare === index) marks.push("check");
  return marks;
}

/**
 * 开始提示限着倒计时的剩余回合数。
 *
 * 太早提示会让每盘棋从头到尾都挂着一个和棋警告，玩家会学会无视它；太晚提示
 * 就失去了意义——限着的用处是让人知道该抢攻了，只剩两三回合时才说已经来不及
 * 变招。10 回合大致是"还够走一次完整的攻防"的长度。
 *
 * 与 `NATURAL_LIMIT_MOVES` 不同，这个数**可以随便调**：60 出自竞赛规则，改错
 * 了是规则错误；10 只是手感，改了不影响任何裁定。所以测试只钉住「有阈值、
 * 边界是闭区间、报的是真实剩余数」，不钉 10 本身——钉住它只会让日后调手感的
 * 人删掉一条什么也没验证的用例。
 */
export const DRAW_WARN_MOVES = 10;

/**
 * 底部状态栏。
 *
 * UI-DESIGN.md §6.3 有一条硬性要求：状态栏列出的快捷键必须与当前真正生效的
 * 完全一致。所以这里接收的不只是 `canAct`，还有座位、选中态与认输待确认态——
 * 选中之后 Enter 的含义从「选子」变成「落子」，写死一句话就成了骗人。悔棋
 * 同理，开局第一手没得可悔、额度用光了、已经有请求悬着，三种情况都不该列
 * 「u 悔棋」。
 *
 * 优先级从高到低，每一条都是「不看见就要吃亏」的程度排的：
 *
 * 1. **待我答复的悔棋请求**——对方的棋局卡在这里等我，而且答不答直接改变
 *    局面。它压过将军：将军是我该怎么走，这是我不答对方就走不了。
 * 2. **将军**——象棋里唯一一个没看见就直接输的状态。
 * 3. **限着倒计时**——和棋对双方都不算赢，而入场费已经扣了。
 */
export function renderStatusBar(
  view: XiangqiView,
  canAct: boolean,
  decor: Pick<BoardDecor, "selected"> = { selected: null },
  pendingResign = false,
  mySeat: number | null = null,
): string {
  const lost = capturedText(view);

  if (view.result) {
    return `终局 ${verdictText(view.result)} · ${lost}`;
  }

  // 对方在等我答复：这时棋盘是冻住的，列走子快捷键会让人以为还能走。
  if (awaitingMyReply(view, mySeat)) {
    return `对方请求悔棋（退 ${UNDO_PLIES} 手） · y 同意 · n 拒绝 · ${lost}`;
  }
  // 我发的请求还没被答复：同样冻住，但我这边什么也做不了，只能等。
  if (view.undoRequest !== null) {
    return `已请求悔棋，等待对方答复 · ${lost}`;
  }

  const alarm = view.checkSquare === null ? "" : "将军！ · ";
  const countdown =
    view.movesUntilDraw <= DRAW_WARN_MOVES
      ? `限着还剩 ${view.movesUntilDraw} 回合 · `
      : "";
  const keys = pendingResign
    ? "再按一次 r 确认认输 · Esc 取消"
    : !canAct
      ? "等待对手 · r 认输"
      : decor.selected !== null
        ? "hjkl/方向键 移动 · Enter 落子 · Esc 取消选择 · r 认输"
        : `hjkl/方向键 移动 · Enter 选子${undoKey(view, mySeat)} · r 认输`;

  return `${alarm}${countdown}${lost} · ${keys}`;
}

/**
 * 悔棋那一段快捷键提示。发不出请求时返回空串。
 *
 * 剩余次数写进提示里：不写的话玩家会在第 4 次按 u 时收到一个没头没脑的拒绝。
 * 额度是发起时扣的（见 view.ts），所以这个数会在对方还没答复时就已经减掉，
 * 这正是它该有的行为——发起本身就是消耗。
 */
function undoKey(view: XiangqiView, mySeat: number | null): string {
  if (!canRequestUndo(view, mySeat)) return "";
  return ` · u 悔棋(${undoRequestsLeft(view, mySeat!)})`;
}

/**
 * 终局说法。
 *
 * 两条措辞上的硬要求：
 *
 * 1. **困毙判负，不是和棋。** 这是中国象棋与国际象棋的分野，也是移植时最经典
 *    的错处，措辞不能含糊。
 * 2. **和棋不能说成谁胜。** 以前这里是 `result.winner === "red" ? "红方" : "黑方"`，
 *    和棋（无 winner）会静默渲染成「黑方胜」。现在和棋分支在类型上就没有
 *    `winner`，switch 收窄之后编译器不允许再那样读。
 */
export function verdictText(
  result: NonNullable<XiangqiView["result"]>,
): string {
  switch (result.kind) {
    case "draw_natural_limit":
      return "和棋 · 自然限着";
    case "draw_material":
      return "和棋 · 双方无攻击子力";
    case "draw_repetition":
      return "和棋 · 三次重复局面";
    default: {
      const winner = result.winner === "red" ? "红方" : "黑方";
      const how =
        result.kind === "checkmate"
          ? "将死"
          : result.kind === "stalemate"
            ? "困毙"
            : result.kind === "perpetual_check"
              ? "对方长将"
              : "对方认输";
      return `${winner}胜 · ${how}`;
    }
  }
}

/** 双方被吃的子。两边都看得见，才谈得上公平。 */
export function capturedText(view: XiangqiView): string {
  const byside = (side: Piece["side"]) => {
    const glyphs = view.captured
      .filter((p) => p.side === side)
      .map(glyphOf)
      .join("");
    return glyphs === "" ? "无" : glyphs;
  };
  return `被吃 红:${byside("red")} 黑:${byside("black")}`;
}
