

import type { GoState, Player } from "../logic";
import { isEye, isLegal, toCoord } from "../logic";

/**
 * 选一手。无合法着手（或只剩自填眼）时虚手。
 *
 * @param state 当前局面
 * @param player 执子方
 * @param random 返回 [0, 1) 的随机数
 */
export function chooseMove(
  state: GoState,
  player: Player,
  random: () => number,
): number | "pass" {
  const { size } = state.board;
  const candidates: number[] = [];

  for (let index = 0; index < state.board.cells.length; index += 1) {
    if (isEye(state.board, index, player)) continue;
    const { row, col } = toCoord(size, index);
    if (isLegal(state, player, row, col)) candidates.push(index);
  }

  if (candidates.length === 0) return "pass";
  return candidates[Math.floor(random() * candidates.length)];
}
