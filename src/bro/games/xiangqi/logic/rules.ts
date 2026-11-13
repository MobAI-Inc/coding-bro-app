/**
 * 将军、应将与胜负判定。
 *
 * 本文件只依赖 moves.ts，方向单一。这里回答的是「这盘棋现在算什么结果」，
 * 而不是「这个子能怎么走」。
 *
 * 中国象棋与国际象棋在此处有一条关键差异：**困毙（无子可走但未被将军）
 * 判负，不是和棋**。照搬国际象棋的 stalemate = draw 是移植时最典型的错误，
 * 因此 {@link getOutcome} 对将死与困毙都给出胜方，只在 `kind` 上区分二者。
 */

import type { Position, Side } from "./board";
import { opponent } from "./board";
import type { Move } from "./moves";
import { applyMove, isInCheck, isLegalMove, legalMoves } from "./moves";

/**
 * 对局结果。
 *
 * `stalemate`（困毙）同样有 `winner`——见文件头说明。保留 `kind` 是因为
 * 战报展示需要区分「被将死」与「无棋可走」。
 */
export type Outcome =
  | { readonly kind: "ongoing" }
  | { readonly kind: "checkmate"; readonly winner: Side }
  | { readonly kind: "stalemate"; readonly winner: Side };

/** 走子方是否还有合法着法。 */
export function hasLegalMove(pos: Position): boolean {
  return legalMoves(pos).length > 0;
}

/** 走子方是否被将军。 */
export function isCheck(pos: Position): boolean {
  return isInCheck(pos, pos.sideToMove);
}

/**
 * 走子方是否被将死：正在被将军且无法应将。
 *
 * 「应将」的三种手段（避将、吃掉将军的子、垫子）不需要分别实现——它们都只是
 * 「走完之后不再被将军」的着法，由 `legalMoves` 统一筛出。分开实现只会漏掉
 * 边角情况（例如用将吃掉贴脸的攻击子）。
 */
export function isCheckmate(pos: Position): boolean {
  return isCheck(pos) && !hasLegalMove(pos);
}

/** 走子方是否困毙：未被将军但无合法着法。中国象棋规则下判负。 */
export function isStalemate(pos: Position): boolean {
  return !isCheck(pos) && !hasLegalMove(pos);
}

/**
 * 判定当前局面的结果。
 *
 * 只看当前局面，不看历史，因此不涉及长将/长捉判负与自然限着和棋——那些需要
 * 着法历史，属于对局层而非局面层的判定。
 */
export function getOutcome(pos: Position): Outcome {
  if (hasLegalMove(pos)) return { kind: "ongoing" };
  const winner = opponent(pos.sideToMove);
  return isCheck(pos)
    ? { kind: "checkmate", winner }
    : { kind: "stalemate", winner };
}

/**
 * 状态转换：`(state, move) => newState`。着法非法时返回 `null`。
 *
 * 用返回值而非抛异常表达非法着法，与内核约定一致——「非法意图被拒绝是正常
 * 流程，不是异常」（见 core/types.ts）。服务端每帧都会收到客户端的臆测着法，
 * 拒绝是常态。
 */
export function playMove(pos: Position, move: Move): Position | null {
  if (!isLegalMove(pos, move)) return null;
  return applyMove(pos, move);
}
