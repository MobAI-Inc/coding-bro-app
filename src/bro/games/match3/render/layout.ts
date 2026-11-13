/**
 * 盘面几何与动画时序。
 *
 * 从渲染器里抽出来的理由和围棋 render/layout.ts 一样：这里全是纯计算，
 * 而 jsdom 没有 2D 上下文，写在渲染器内部就一行都测不了。
 *
 * 动画时序也放这里。它同样是纯函数（给定「已经过去多少毫秒」算出进度），
 * 唯独不能放 `requestAnimationFrame`——那是 DOM 的事，留在渲染器里。这样
 * 「第三层连锁的闪光在第几毫秒开始」这种最容易写错、又最难肉眼验证的东西
 * 变成可断言的。
 */

import type { Pos } from "../logic";

/** 四周留白，以格子边长为单位。留白不足时元素的投影会被画布边缘切掉。 */
export const BOARD_PADDING_RATIO = 0.25;

/**
 * 元素占格子的比例。
 *
 * 0.86 而非 1：相邻元素之间必须留缝。三消要靠「一眼数出连着几个」来决策，
 * 元素贴在一起时三连和四连看起来一模一样。
 */
export const TILE_FILL_RATIO = 0.86;

/** 一次布局的结果。单位全是 CSS 像素。 */
export interface Match3Layout {
  readonly columns: number;
  readonly rows: number;
  /** 单个格子的边长（含缝隙）。 */
  readonly cell: number;
  /** 元素本身的边长（不含缝隙）。 */
  readonly tile: number;
  /** 左上角第一个格子的外边界坐标。 */
  readonly origin: number;
  /** 画布宽高（含四周留白）。 */
  readonly extentX: number;
  readonly extentY: number;
}

/**
 * 按容器尺寸计算布局。
 *
 * 格子必须是正方形：长方形格子会让横向三连和纵向三连看起来长度不同，玩家
 * 对「差一个」的判断直接失准。所以取横竖两个方向能容纳的较小边长，剩下的
 * 空间留白，而不是把格子拉伸填满。
 */
export function computeLayout(
  columns: number,
  rows: number,
  width: number,
  height: number,
): Match3Layout {
  const pad = 2 * BOARD_PADDING_RATIO;
  const cell = Math.max(
    0,
    Math.min(width / (columns + pad), height / (rows + pad)),
  );
  const origin = cell * BOARD_PADDING_RATIO;
  return {
    columns,
    rows,
    cell,
    tile: cell * TILE_FILL_RATIO,
    origin,
    extentX: cell * columns + 2 * origin,
    extentY: cell * rows + 2 * origin,
  };
}

/** 格子中心的画布坐标。 */
export function cellCenter(
  layout: Match3Layout,
  p: Pos,
): { x: number; y: number } {
  return {
    x: layout.origin + (p.col + 0.5) * layout.cell,
    y: layout.origin + (p.row + 0.5) * layout.cell,
  };
}

/**
 * 画布坐标 → 格子。落在留白或盘外返回 `null`。
 *
 * 不做「就近吸附」：格子是平铺的，指针落在哪个格子里毫无歧义，吸附只会把
 * 明显点在盘外留白上的操作也算进来。围棋那边要吸附是因为交叉点之间有空隙，
 * 这里没有这个问题。
 */
export function pixelToCell(
  layout: Match3Layout,
  x: number,
  y: number,
): Pos | null {
  if (layout.cell <= 0) return null;
  const col = Math.floor((x - layout.origin) / layout.cell);
  const row = Math.floor((y - layout.origin) / layout.cell);
  if (col < 0 || col >= layout.columns) return null;
  if (row < 0 || row >= layout.rows) return null;
  return { row, col };
}



/** 消除闪光时长。对应 §5.1 的「状态切换 250ms」。 */
export const CLEAR_MS = 250;

/** 下落时长。与消除同档，两者并行播放。 */
export const DROP_MS = 250;

/** 两颗宝石真正交换位置的时长。先交换，再进入消除/下落阶段。 */
export const SWAP_MS = 220;

/** 无效交换先换过去再弹回，必须比单程交换长但不能拖沓。 */
export const REJECTED_SWAP_MS = 360;

/**
 * 连锁逐层错峰的间隔。
 *
 * §5.1 给列表入场定的是 30~50ms/项，这里放宽到 90ms：连锁层不是列表项，
 * 层与层之间要看得出先后，太密就糊成一次闪光，「连锁」这个卖点也就没了。
 * 但也不能太长——五层连锁就得等半秒多，那已经是可感知的卡顿。
 */
export const CHAIN_STAGGER_MS = 90;

/**
 * 整条时间线的长度。
 *
 * 下落与消除闪光**并行**而不是串行。串行（先闪完再落）总时长翻倍，五层
 * 连锁要一秒多，玩家会觉得点一下要等半天；而且串行意味着闪光期间盘面
 * 是静止的结算后状态，反而更让人困惑。
 */
export function timelineDuration(
  stepCount: number,
  includesSwap = false,
): number {
  if (stepCount <= 0) return includesSwap ? SWAP_MS : 0;
  const settlement = Math.max(
    DROP_MS,
    (stepCount - 1) * CHAIN_STAGGER_MS + CLEAR_MS,
  );
  return settlement + (includesSwap ? SWAP_MS : 0);
}

/** 有效交换从起点到终点；非法交换在一条时间线上往返。 */
export function swapProgress(elapsed: number, rejected = false): number {
  if (!rejected) return easeOut(clamp01(elapsed / SWAP_MS));
  const half = REJECTED_SWAP_MS / 2;
  if (elapsed <= half) return easeOut(clamp01(elapsed / half));
  return 1 - easeOut(clamp01((elapsed - half) / half));
}

/**
 * 第 `chain` 层连锁的闪光进度，`[0, 1]`。未开始或已结束返回 `null`。
 *
 * 返回 `null` 而不是 0：0 是「刚开始，最亮」的合法进度值，用它兼表「不该
 * 画」会让所有未开始的层在第 0 毫秒全部亮一下，错峰效果直接消失。
 */
export function chainFlashProgress(
  elapsed: number,
  chain: number,
): number | null {
  const start = (chain - 1) * CHAIN_STAGGER_MS;
  const t = (elapsed - start) / CLEAR_MS;
  if (t < 0 || t > 1) return null;
  return t;
}

/** 下落进度，`[0, 1]`。0 = 还在上方，1 = 已落到位。 */
export function dropProgress(elapsed: number): number {
  return clamp01(elapsed / DROP_MS);
}

/**
 * 每一列在本次结算中被清掉的格子数。
 *
 * 用来决定该列的元素从多高的地方落下来。这是**近似**：真实的下落距离逐格
 * 不同（下方消得多的格子落得远），精确还原需要在渲染层重演一次消除与下落，
 * 那就是把规则搬进渲染层了（core/types.ts 约束一）。按列取总数，方向和数量
 * 级都对，代价只是同一列的元素同步下落——肉眼看不出，规则也没被复制。
 */
export function clearedPerColumn(
  columns: number,
  cleared: readonly Pos[],
): number[] {
  const counts = new Array<number>(columns).fill(0);
  for (const p of cleared) {
    if (p.col >= 0 && p.col < columns) counts[p.col] += 1;
  }
  return counts;
}

/**
 * 某列元素的起始下落高度（像素）。
 *
 * 截到整盘高度：连锁多轮时一列的累计消除数可以超过行数，不截的话元素会从
 * 画布外老远的地方飞进来，看着像掉帧。
 */
export function fallDistance(
  layout: Match3Layout,
  clearedInColumn: number,
): number {
  return Math.min(clearedInColumn, layout.rows) * layout.cell;
}

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)` 的求值。
 *
 * 这是 §5.1 为「状态切换」指定的曲线，CSS 里写一行就完事，Canvas 里得自己
 * 算。用牛顿迭代由 x 反解参数 t 再求 y——直接拿 `1-(1-t)³` 顶替是常见做法，
 * 但那条曲线的起手速度明显更慢，和界面上其他用 CSS 过渡的元素放在一起会
 * 「不同步」，正是这种说不出哪里怪的不一致最伤质感。
 */
export function easeOut(x: number): number {
  const t = clamp01(x);
  if (t === 0 || t === 1) return t;
  return bezierY(solveBezierT(t, 0.16, 0.3), 1, 1);
}

/** 三次贝塞尔在参数 `t` 处的坐标分量（首末控制点固定为 0 与 1）。 */
function bezierY(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

/** 由 x 反解贝塞尔参数 t。迭代次数固定，够 1px 精度就停，不追求解析解。 */
function solveBezierT(x: number, p1: number, p2: number): number {
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const error = bezierY(t, p1, p2) - x;
    if (Math.abs(error) < 1e-6) break;
    const inv = 1 - t;
    const slope =
      3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2);
    if (slope === 0) break;
    t -= error / slope;
  }
  return clamp01(t);
}

/** 截到 `[0, 1]`。NaN 归 0——NaN 一路传下去会让整帧画不出来且不报错。 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
