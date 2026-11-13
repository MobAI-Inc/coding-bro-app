/**
 * 围棋棋盘表示与基础工具。
 *
 * 内部用一维数组存储，坐标 `(row, col)` 映射为 `row * size + col`。
 * 一维的理由不是性能，是提子算法要频繁做邻接遍历与集合运算——
 * 用整数下标做 Set 的键远比 `{row, col}` 对象干净，后者还得自己
 * 处理值相等问题。对外接口仍用 `(row, col)`，一维只是实现细节。
 */

/** 交叉点状态。 */
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Stone = typeof EMPTY | typeof BLACK | typeof WHITE;
/** 落子方。空不是一种颜色，故与 Stone 分开。 */
export type Player = typeof BLACK | typeof WHITE;

/** 支持的棋盘尺寸。9/13 路用于快速局，19 路为标准。 */
export type BoardSize = 9 | 13 | 19;

export interface Board {
  readonly size: BoardSize;
  /** 长度为 size×size 的交叉点数组。 */
  readonly cells: readonly Stone[];
}

/** 空棋盘。 */
export function createBoard(size: BoardSize = 19): Board {
  return { size, cells: new Array<Stone>(size * size).fill(EMPTY) };
}

/** `(row, col)` → 一维下标。不做越界检查，调用方需自行保证。 */
export function toIndex(size: number, row: number, col: number): number {
  return row * size + col;
}

/** 一维下标 → `(row, col)`。 */
export function toCoord(
  size: number,
  index: number,
): { row: number; col: number } {
  return { row: Math.floor(index / size), col: index % size };
}

/** 坐标是否在棋盘内。 */
export function inBounds(size: number, row: number, col: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

/**
 * 相邻交叉点的下标。
 *
 * 只有上下左右四个方向——围棋的「相邻」不含对角，把对角算进去会让
 * 气的计算全盘错误。边角自然少于 4 个邻居，这正是角上棋子只有 2 气
 * 的原因，不需要特殊处理。
 */
export function neighbors(size: number, index: number): number[] {
  const { row, col } = toCoord(size, index);
  const out: number[] = [];
  if (row > 0) out.push(index - size);
  if (row < size - 1) out.push(index + size);
  if (col > 0) out.push(index - 1);
  if (col < size - 1) out.push(index + 1);
  return out;
}

/** 读取交叉点。越界返回 `EMPTY`，调用方通常已用 neighbors 保证不越界。 */
export function stoneAt(board: Board, index: number): Stone {
  return board.cells[index] ?? EMPTY;
}

/** 对手颜色。 */
export function opponent(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

/**
 * 返回替换若干交叉点后的新棋盘。
 *
 * 不可变更新：规则引擎在服务端（权威）与客户端（预测）跑同一份代码，
 * 就地修改会让「试下一手看看合不合法」这类推演污染真实局面。
 */
export function withStones(
  board: Board,
  changes: Iterable<[index: number, stone: Stone]>,
): Board {
  const cells = board.cells.slice();
  for (const [index, stone] of changes) cells[index] = stone;
  return { size: board.size, cells };
}
