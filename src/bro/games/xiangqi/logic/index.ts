/**
 * 中国象棋规则引擎对外入口。
 *
 * 四层依赖是单向的：board（表示）← moves（走法与合法性）← rules（局面胜负）
 * ← match-rules（需要历史的和棋与长将）。外部只从本文件导入，模块拆分才可以
 * 在不惊动调用方的前提下调整。
 *
 * rules 与 match-rules 的分工见 match-rules.ts 文件头：前者只看一个局面，
 * 后者要看整盘。判「这盘棋结束了吗」一律用 `matchOutcome`，`getOutcome` 只
 * 回答「轮走方还有棋走吗」。
 */

export type { Piece, PieceType, Position, Side, Square } from "./board";
export {
  ALL_SQUARES,
  BOARD_SIZE,
  FILES,
  INITIAL_FEN,
  RANKS,
  findKing,
  formatSquare,
  forwardStep,
  hasCrossedRiver,
  initialPosition,
  isInPalace,
  isOnBoard,
  opponent,
  parseFen,
  parseSquare,
  pieceAt,
  positionFrom,
  sameSquare,
  square,
  squareIndex,
  toFen,
  withPiece,
} from "./board";

export type { Move } from "./moves";
export {
  applyMove,
  isAttackedBy,
  isInCheck,
  isLegalMove,
  kingsFaceEachOther,
  legalMoves,
  pseudoLegalMoves,
  pseudoLegalMovesFrom,
} from "./moves";

export type { Outcome } from "./rules";
export {
  getOutcome,
  hasLegalMove,
  isCheck,
  isCheckmate,
  isStalemate,
  playMove,
} from "./rules";

export type { MatchOutcome, MatchPly } from "./match-rules";
export {
  NATURAL_LIMIT_MOVES,
  NATURAL_LIMIT_PLIES,
  REPETITION_LIMIT,
  adjudicatePerpetual,
  bothSidesCannotWin,
  hasAttackingPiece,
  isFinished,
  matchOutcome,
  movesUntilNaturalDraw,
  pliesSinceCapture,
  positionKey,
} from "./match-rules";
