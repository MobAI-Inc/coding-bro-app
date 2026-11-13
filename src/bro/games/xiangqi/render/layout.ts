/**
 * 棋盘的几何换算与视觉常量。
 *
 * 从渲染器里抽出来，因为它是纯计算：给定容器尺寸算出每条线画在哪、鼠标点
 * 在哪个交叉点上。放在渲染器内部就只能靠真实 Canvas 上下文才能测，而 jsdom
 * 里没有 2D 上下文。
 *
 * 与围棋最大的不同是**棋盘不是正方形**：9 路 × 10 路，横 8 格、竖 9 格，
 * 照搬围棋那套「取长宽较小值当边长」会把棋盘压扁。这里改为按格宽取较小值，
 * 保证格子本身是正方形——格子被拉成长方形，马的「日」字和象的「田」字就
 * 看不出形状了。
 *
 * 河界位置与九宫范围都**从规则层反推**，不在这里重抄一份常量。抄一份就多
 * 一个会和规则层分叉的数字，而分叉的表现是「线画在这儿、子却走到那儿」。
 */

import type { Side } from "../logic";
import {
  ALL_SQUARES,
  FILES,
  RANKS,
  hasCrossedRiver,
  isInPalace,
} from "../logic";

/** 一次布局的结果。所有单位都是 CSS 像素。 */
export interface BoardLayout {
  /** 最左一条竖线的 x。 */
  readonly originX: number;
  /** 最上一条横线的 y。 */
  readonly originY: number;
  /** 相邻两条线的间距。横竖相同。 */
  readonly step: number;
  /** 棋子半径。 */
  readonly radius: number;
  /** 棋盘绘制区宽（含留白）。 */
  readonly width: number;
  /** 棋盘绘制区高（含留白）。 */
  readonly height: number;
}

/** 含留白后棋盘占几格。四周各留一格，栅格本身是 8 × 9 格。 */
const CELLS_X = FILES + 1;
const CELLS_Y = RANKS + 1;

/** 棋盘绘制区的宽高比。CSS 用它给容器定 `aspect-ratio`，两处必须一致。 */
export const BOARD_ASPECT = CELLS_X / CELLS_Y;

/**
 * 河界上沿所在行——红方「已过河」的最靠下那一行。
 *
 * 直接写 4 会与规则层各存一份河界位置，改规则时必然漏改这里，症状是竖线
 * 断在错误的地方而兵却在别处过河。从 `hasCrossedRiver` 反推就只有一份真相。
 */
export const RIVER_TOP_ROW = (() => {
  let last = 0;
  for (let row = 0; row < RANKS; row += 1) {
    if (hasCrossedRiver({ col: 0, row }, "red")) last = row;
  }
  return last;
})();

/**
 * 按容器尺寸计算布局。
 *
 * 取横竖两个方向上格宽的较小值，保证格子是正方形；剩余空间留白，不拉伸。
 *
 * @param width 容器宽（CSS 像素）
 * @param height 容器高（CSS 像素）
 */
export function computeLayout(width: number, height: number): BoardLayout {
  const step = Math.max(0, Math.min(width / CELLS_X, height / CELLS_Y));
  return {
    originX: step,
    originY: step,
    step,
    // 0.45 而非 0.5：相邻棋子之间留一丝缝。象棋的子是带字的圆盘，紧贴会让
    // 两个字挤在一起看不清是哪个兵种
    radius: step * 0.45,
    width: step * CELLS_X,
    height: step * CELLS_Y,
  };
}

/** 交叉点下标 → 画布坐标。 */
export function pointToPixel(
  layout: BoardLayout,
  index: number,
): { x: number; y: number } {
  const row = Math.floor(index / FILES);
  const col = index % FILES;
  return {
    x: layout.originX + col * layout.step,
    y: layout.originY + row * layout.step,
  };
}

/**
 * 画布坐标 → 最近的交叉点下标。超出容差返回 `null`。
 *
 * 容差取半格：再宽就会把明显点在格子中间的操作也吸附过去。象棋是「选起点
 * 再选终点」两步，吸附错一格的后果是选中了旁边那个子，用户往往到落子之后
 * 才发现——宁可不响应。
 */
export function pixelToPoint(
  layout: BoardLayout,
  x: number,
  y: number,
): number | null {
  const col = Math.round((x - layout.originX) / layout.step);
  const row = Math.round((y - layout.originY) / layout.step);
  if (col < 0 || col >= FILES || row < 0 || row >= RANKS) return null;
  const index = row * FILES + col;
  const { x: px, y: py } = pointToPixel(layout, index);
  if (Math.hypot(x - px, y - py) > layout.step * 0.5) return null;
  return index;
}

/**
 * 河界带的上下沿 y 坐标。
 *
 * 中间七条竖线在这一带断开（最外两条不断，它们是棋盘边框）。断开的位置画
 * 错，棋盘就不是象棋盘了。
 */
export function riverBand(layout: BoardLayout): {
  top: number;
  bottom: number;
} {
  return {
    top: layout.originY + RIVER_TOP_ROW * layout.step,
    bottom: layout.originY + (RIVER_TOP_ROW + 1) * layout.step,
  };
}

/** 竖线是否贯通全盘。只有最左最右两条贯通，其余在河界处断开。 */
export function isEdgeFile(col: number): boolean {
  return col === 0 || col === FILES - 1;
}

/**
 * 九宫斜线的端点对（交叉点下标）。
 *
 * 范围从规则层的 `isInPalace` 反推，不重抄 3/5/7/9 这四个数字。返回四条线：
 * 黑方两条、红方两条。
 */
export function palaceDiagonals(): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (const side of ["black", "red"] as const) {
    const box = palaceBox(side);
    if (box === null) continue;
    const { minCol, maxCol, minRow, maxRow } = box;
    out.push([minRow * FILES + minCol, maxRow * FILES + maxCol]);
    out.push([minRow * FILES + maxCol, maxRow * FILES + minCol]);
  }
  return out;
}

/** 某方九宫的全部交叉点下标。TUI 用它把九宫内的点画成另一个字符。 */
export function palacePoints(side: Side): number[] {
  return ALL_SQUARES.filter((sq) => isInPalace(sq, side)).map(
    (sq) => sq.row * FILES + sq.col,
  );
}

function palaceBox(side: Side): {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
} | null {
  const squares = ALL_SQUARES.filter((sq) => isInPalace(sq, side));
  if (squares.length === 0) return null;
  return {
    minCol: Math.min(...squares.map((s) => s.col)),
    maxCol: Math.max(...squares.map((s) => s.col)),
    minRow: Math.min(...squares.map((s) => s.row)),
    maxRow: Math.max(...squares.map((s) => s.row)),
  };
}
