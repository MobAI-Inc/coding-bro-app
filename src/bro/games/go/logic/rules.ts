/**
 * 落子规则：提子、自杀禁着、劫争、终局。
 *
 * 全部为纯函数。规则引擎在服务端（权威裁定）与客户端（即时预测）跑
 * 同一份代码，任何就地修改或隐藏状态都会让两边分叉。
 */

import type { Board, BoardSize, Player, Stone } from "./board";
import {
  BLACK,
  EMPTY,
  WHITE,
  createBoard,
  opponent,
  toIndex,
  withStones,
} from "./board";
import { collectGroup, findCaptured } from "./group";

/** 落子被拒绝的原因。全部是正常流程的一部分，不是异常。 */
export type RejectReason =
  | "occupied"
  | "out_of_bounds"
  /** 落子后己方无气，且没能提掉对方任何子。 */
  | "suicide"
  /** 立即回提，会让局面重复。 */
  | "ko"
  | "not_your_turn"
  | "game_over";

export interface GoState {
  readonly board: Board;
  readonly toPlay: Player;
  /**
   * 劫点：对方下一手不可落子处。`null` 表示无劫。
   *
   * 只保存一个点而非整个历史局面，是「简单劫」规则。它挡不住极罕见的
   * 超级劫（长生、三劫循环），但实现代价与理解成本都低得多，且与日本
   * 规则一致。真要处理超级劫需要保存局面哈希历史，等有实际需求再说。
   */
  readonly koPoint: number | null;
  /** 各方已提子数，用于终局计分。 */
  readonly captures: { readonly [BLACK]: number; readonly [WHITE]: number };
  /** 连续虚手数。连续两次虚手即终局。 */
  readonly consecutivePasses: number;
  readonly finished: boolean;
}

/** 开局状态。黑先。 */
export function createGame(size: BoardSize = 19): GoState {
  return {
    board: createBoard(size),
    toPlay: BLACK,
    koPoint: null,
    captures: { [BLACK]: 0, [WHITE]: 0 },
    consecutivePasses: 0,
    finished: false,
  };
}

export type PlayResult =
  | { readonly ok: true; readonly state: GoState; readonly captured: number }
  | { readonly ok: false; readonly reason: RejectReason };

/**
 * 落子。
 *
 * **求值顺序是本函数的全部难点**：先落子 → 再提对方无气的串 → 最后才
 * 检查己方是否无气。顺序颠倒会把「扑」（送一子进对方阵中以提掉对方一块）
 * 误判为自杀——那手棋落下的瞬间确实没气，但它提掉了对方的子，因而合法。
 * 这是围棋规则实现的头号错误。
 *
 * @param state 当前状态
 * @param player 落子方
 * @param row 行（0 起）
 * @param col 列（0 起）
 */
export function play(
  state: GoState,
  player: Player,
  row: number,
  col: number,
): PlayResult {
  if (state.finished) return { ok: false, reason: "game_over" };
  if (player !== state.toPlay) return { ok: false, reason: "not_your_turn" };

  const { size } = state.board;
  if (row < 0 || row >= size || col < 0 || col >= size) {
    return { ok: false, reason: "out_of_bounds" };
  }

  const index = toIndex(size, row, col);
  if (state.board.cells[index] !== EMPTY) {
    return { ok: false, reason: "occupied" };
  }
  if (index === state.koPoint) {
    return { ok: false, reason: "ko" };
  }

  // 1. 落子
  const placed = withStones(state.board, [[index, player]]);

  // 2. 提掉对方无气的串
  const foe = opponent(player);
  const captured = findCaptured(placed, foe, index);
  const afterCapture =
    captured.size === 0
      ? placed
      : withStones(
          placed,
          [...captured].map((i) => [i, EMPTY] as [number, Stone]),
        );

  // 3. 现在才检查自杀。提子已经腾出空点，先前无气的己方串可能已获得气。
  const own = collectGroup(afterCapture, index);
  if (own.liberties.size === 0) {
    return { ok: false, reason: "suicide" };
  }

  return {
    ok: true,
    captured: captured.size,
    state: {
      board: afterCapture,
      toPlay: foe,
      koPoint: detectKo(captured, own),
      captures: {
        ...state.captures,
        [player]: state.captures[player] + captured.size,
      },
      consecutivePasses: 0,
      finished: false,
    },
  };
}

/**
 * 判定这一手是否形成劫。
 *
 * 成劫的充要条件是三者同时满足：恰好提了 1 子、落下的子自成一串
 * （大小为 1）、且该串只有 1 气。少任何一条都不是劫——例如提掉 2 子后
 * 对方无法立即回提，因为回提需要先填掉另一个点。
 *
 * 只判「提了一子」是常见的过宽实现，会把正常的提子误锁为劫点。
 */
function detectKo(
  captured: ReadonlySet<number>,
  placedGroup: { stones: ReadonlySet<number>; liberties: ReadonlySet<number> },
): number | null {
  if (
    captured.size === 1 &&
    placedGroup.stones.size === 1 &&
    placedGroup.liberties.size === 1
  ) {
    return [...captured][0];
  }
  return null;
}

/** 虚手。连续两次虚手即终局。 */
export function pass(state: GoState, player: Player): PlayResult {
  if (state.finished) return { ok: false, reason: "game_over" };
  if (player !== state.toPlay) return { ok: false, reason: "not_your_turn" };

  const passes = state.consecutivePasses + 1;
  return {
    ok: true,
    captured: 0,
    state: {
      ...state,
      toPlay: opponent(player),
      // 虚手解除劫争：对方已放弃这一手，劫的封锁自然失效
      koPoint: null,
      consecutivePasses: passes,
      finished: passes >= 2,
    },
  };
}

/** 该点当前是否可落子。用于渲染层提示，不替代 play 的裁定。 */
export function isLegal(
  state: GoState,
  player: Player,
  row: number,
  col: number,
): boolean {
  return play(state, player, row, col).ok;
}
