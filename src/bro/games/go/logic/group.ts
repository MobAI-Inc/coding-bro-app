/**
 * 棋串与气。
 *
 * 围棋所有规则最终都归结到一件事：某个棋串还有没有气。提子、自杀、
 * 劫争的判定全部建立在这上面，所以这个文件错了后面全错。
 */

import type { Board, Player, Stone } from "./board";
import { EMPTY, neighbors, stoneAt } from "./board";

/** 一个棋串：相连的同色棋子，以及它当前的气。 */
export interface Group {
  /** 组成该串的交叉点下标。 */
  readonly stones: ReadonlySet<number>;
  /** 该串的气（相邻的空点）。同一个空点被多颗子共用时只算一次。 */
  readonly liberties: ReadonlySet<number>;
}

/**
 * 从任一交叉点出发，求出它所属的棋串及其气。
 *
 * 用显式栈做深度优先，不用递归——19 路棋盘上一条大龙可能有两三百子，
 * 递归深度虽然通常够用，但没有理由把栈溢出这种风险留在核心路径上。
 *
 * 气用 Set 收集是必须的：一个空点可能同时与串中多颗子相邻，用计数会
 * 把它重复计算，导致「明明还有一气」的串被误判为可提。这是气的计算里
 * 最经典的错误。
 *
 * @param board 棋盘
 * @param start 起点下标。该点必须有子，否则返回空串。
 */
export function collectGroup(board: Board, start: number): Group {
  const color = stoneAt(board, start);
  if (color === EMPTY) {
    return { stones: new Set(), liberties: new Set() };
  }

  const stones = new Set<number>();
  const liberties = new Set<number>();
  const stack = [start];
  stones.add(start);

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of neighbors(board.size, current)) {
      const s = stoneAt(board, next);
      if (s === EMPTY) {
        liberties.add(next);
      } else if (s === color && !stones.has(next)) {
        stones.add(next);
        stack.push(next);
      }
      // 异色子：既不是气也不属于本串，跳过
    }
  }

  return { stones, liberties };
}

/** 该点所属棋串的气数。空点返回 0。 */
export function countLiberties(board: Board, index: number): number {
  return collectGroup(board, index).liberties.size;
}

/**
 * 找出指定颜色所有已无气的棋串。
 *
 * 只检查 `around` 附近，因为一手棋只可能让与它相邻的串失去最后一气——
 * 远处的串气数不会因这一手减少。全盘扫描能得到同样结果但白费力气。
 *
 * @param board 落子后的棋盘
 * @param color 要检查的一方（通常是对手）
 * @param around 刚落子的位置
 */
export function findCaptured(
  board: Board,
  color: Stone,
  around: number,
): Set<number> {
  const captured = new Set<number>();
  const visited = new Set<number>();

  for (const next of neighbors(board.size, around)) {
    if (stoneAt(board, next) !== color || visited.has(next)) continue;
    const group = collectGroup(board, next);
    for (const s of group.stones) visited.add(s);
    if (group.liberties.size === 0) {
      for (const s of group.stones) captured.add(s);
    }
  }

  return captured;
}

/** 该点是否为指定方的眼位（四周与所有对角均为己方或边界）。用于终局与 AI 的粗判。 */
export function isEye(board: Board, index: number, player: Player): boolean {
  if (stoneAt(board, index) !== EMPTY) return false;

  // 四邻必须全是己方子
  for (const next of neighbors(board.size, index)) {
    if (stoneAt(board, next) !== player) return false;
  }

  // 对角还需多数为己方：四邻皆己方但对角被占的「假眼」会被对手破掉，
  // 只看四邻会把假眼当真眼，导致 AI 自填或误判死活。
  const { size } = board;
  const row = Math.floor(index / size);
  const col = index % size;
  let diagonalOwn = 0;
  let diagonalTotal = 0;
  for (const [dr, dc] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= size || c < 0 || c >= size) continue; // 边界对角不计入
    diagonalTotal += 1;
    if (board.cells[r * size + c] === player) diagonalOwn += 1;
  }

  // 边角处对角点少，要求全部己方；中央允许一个被占
  return diagonalTotal <= 2
    ? diagonalOwn === diagonalTotal
    : diagonalOwn >= diagonalTotal - 1;
}
