/**
 * 棋盘的几何换算与视觉常量。
 *
 * 从渲染器里抽出来，因为它是纯计算：给定容器尺寸算出每条线画在哪、
 * 鼠标点在哪个交叉点上。放在渲染器内部就只能靠真实 Canvas 上下文才能
 * 测，而 jsdom 里没有 2D 上下文。
 */

import type { BoardSize } from "../logic";

/** 一次布局的结果。所有单位都是 CSS 像素。 */
export interface BoardLayout {
  readonly size: BoardSize;
  /** 棋盘左上角第一条线的坐标。 */
  readonly origin: number;
  /** 相邻两条线的间距。 */
  readonly step: number;
  /** 棋子半径。 */
  readonly radius: number;
  /** 棋盘绘制区的边长（含留白）。 */
  readonly extent: number;
}

/**
 * 按容器尺寸计算布局。
 *
 * 取容器长宽的较小值，保证棋盘始终是正方形——拉伸的棋盘会让人误判
 * 棋形，这在围棋里是实打实的可用性问题，不是美观问题。
 *
 * @param size 路数
 * @param width 容器宽（CSS 像素）
 * @param height 容器高（CSS 像素）
 */
export function computeLayout(
  size: BoardSize,
  width: number,
  height: number,
): BoardLayout {
  const extent = Math.max(0, Math.min(width, height));
  // 留出半格多一点的边距，边线上的子才不会被裁掉
  const step = extent / (size + 1);
  const origin = step;
  return {
    size,
    origin,
    step,
    // 0.47 而非 0.5：相邻棋子之间留一丝缝，紧贴会糊成一片看不出个数
    radius: step * 0.47,
    extent,
  };
}

/** 交叉点下标 → 画布坐标。 */
export function pointToPixel(
  layout: BoardLayout,
  index: number,
): { x: number; y: number } {
  const row = Math.floor(index / layout.size);
  const col = index % layout.size;
  return {
    x: layout.origin + col * layout.step,
    y: layout.origin + row * layout.step,
  };
}

/**
 * 画布坐标 → 最近的交叉点下标。超出容差返回 `null`。
 *
 * 容差取半格：再宽就会把明显点在格子中间的操作也吸附过去，用户会觉得
 * 棋子「乱跑」。宁可不响应，也不要落错点——围棋落子不可悔。
 */
export function pixelToPoint(
  layout: BoardLayout,
  x: number,
  y: number,
): number | null {
  const col = Math.round((x - layout.origin) / layout.step);
  const row = Math.round((y - layout.origin) / layout.step);
  if (col < 0 || col >= layout.size || row < 0 || row >= layout.size) {
    return null;
  }
  const { x: px, y: py } = pointToPixel(layout, row * layout.size + col);
  if (Math.hypot(x - px, y - py) > layout.step * 0.5) return null;
  return row * layout.size + col;
}

/**
 * 星位。
 *
 * 位置是围棋的固定约定而非美术选择：19 路九个星位取 4/10/16 线；13 路与
 * 9 路只有四角加天元共五个。画错了棋手一眼就看得出来。
 */
export function starPoints(size: BoardSize): number[] {
  const lines = size === 19 ? [3, 9, 15] : size === 13 ? [3, 9] : [2, 6];
  const center = (size - 1) / 2;

  const out: number[] = [];
  for (const r of lines) {
    for (const c of lines) out.push(r * size + c);
  }
  // 19 路的中心已经落在 lines 的交叉里，不必重复加天元
  if (size !== 19) out.push(center * size + center);
  return out;
}
