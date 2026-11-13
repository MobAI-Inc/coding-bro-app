/**
 * 着法生成与合法性判定。
 *
 * 分两层，边界刻意划在这里：
 *
 * 1. **伪合法（pseudo-legal）**：只问「这个子按走法能落到哪」，不问走完
 *    自家将帅会不会挨打。
 * 2. **合法（legal）**：伪合法 + 走完之后本方不被将军、且不形成飞将。
 *
 * 分层不是为了好看——被攻击判定本身要枚举对方的着法，如果生成阶段就顺带
 * 判断自杀，就会「生成 → 判自杀 → 生成对方着法 → 判对方自杀 → ……」无限
 * 递归。伪合法这一层不做自杀判断，递归就在此处止住。
 *
 * 将军判定（{@link isInCheck}）也放在本文件而不是 rules.ts：合法性依赖它，
 * 把它放到 rules.ts 会让 moves ↔ rules 互相 import 形成循环。rules.ts 因此
 * 只依赖本文件，方向单一。
 */

import type { Piece, Position, Side, Square } from "./board";
import {
  ALL_SQUARES,
  findKing,
  forwardStep,
  hasCrossedRiver,
  isInPalace,
  isOnBoard,
  opponent,
  pieceAt,
  sameSquare,
  square,
  squareIndex,
} from "./board";

/** 一步着法。中国象棋无升变、无王车易位，起点终点足以描述任何一步。 */
export interface Move {
  readonly from: Square;
  readonly to: Square;
}

type Delta = readonly [col: number, row: number];

const ORTHOGONAL: readonly Delta[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

const DIAGONAL: readonly Delta[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 马的八个目标偏移。「日」字，即一格直 + 一格斜。 */
const KNIGHT_DELTAS: readonly Delta[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

/** 象的四个目标偏移。「田」字。 */
const ELEPHANT_DELTAS: readonly Delta[] = [
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
];

/** 若目标格为空或为敌子则记入着法。返回是否可继续向该方向滑行。 */
function pushIfCapturable(
  out: Move[],
  pos: Position,
  from: Square,
  to: Square,
  side: Side,
): void {
  const target = pieceAt(pos, to);
  if (target === null || target.side !== side) out.push({ from, to });
}

/** 车：四方向滑行，遇第一个子止步，敌子可吃。 */
function rookMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  for (const [dc, dr] of ORTHOGONAL) {
    for (let step = 1; ; step += 1) {
      const to = square(from.col + dc * step, from.row + dr * step);
      if (!isOnBoard(to)) break;
      const target = pieceAt(pos, to);
      if (target === null) {
        out.push({ from, to });
        continue;
      }
      if (target.side !== side) out.push({ from, to });
      break;
    }
  }
  return out;
}

/**
 * 炮：不吃子时走法同车；吃子必须隔**恰好一个**子（炮架），且炮架与敌子之间
 * 不能再有别的子。
 *
 * 两个易错点：
 * - 炮架的归属无所谓，己方子照样能当炮架；
 * - 越过炮架后遇到的第一个子若是己方子，只是「不能吃」，不能继续往后找下一个
 *   敌子——「隔两个子吃」是最常见的实现错误。所以下面在炮架之后遇到任何棋子
 *   都无条件 break。
 */
function cannonMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  for (const [dc, dr] of ORTHOGONAL) {
    let screenPassed = false;
    for (let step = 1; ; step += 1) {
      const to = square(from.col + dc * step, from.row + dr * step);
      if (!isOnBoard(to)) break;
      const target = pieceAt(pos, to);
      if (!screenPassed) {
        // 炮架之前：空格可落，遇子则该子成为炮架（不可吃）
        if (target === null) out.push({ from, to });
        else screenPassed = true;
        continue;
      }
      if (target === null) continue;
      if (target.side !== side) out.push({ from, to });
      break;
    }
  }
  return out;
}

/**
 * 马：走「日」，蹩马腿。
 *
 * 马腿是马与目标之间的**直线相邻格**（长边方向上的那一格），不是对角格——
 * 写成对角格是最常见的实现错误，症状是「马明明被堵住却能跳过去」。
 * 例如从 (4,5) 跳向 (5,3)：长边是行方向，马腿在 (4,4)；而 (5,4) 只是路过的
 * 斜格，有子不影响。整除取半正好落在长边那一格：(±1,±2)→(0,±1)，
 * (±2,±1)→(±1,0)。
 */
function knightMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  for (const [dc, dr] of KNIGHT_DELTAS) {
    const to = square(from.col + dc, from.row + dr);
    // 必须先判目标在盘内：pieceAt 对越界格返回 null，若先读马腿，
    // 盘外的马腿会被当成「空格可通过」
    if (!isOnBoard(to)) continue;
    const leg = square(
      from.col + Math.trunc(dc / 2),
      from.row + Math.trunc(dr / 2),
    );
    if (pieceAt(pos, leg) !== null) continue;
    pushIfCapturable(out, pos, from, to, side);
  }
  return out;
}

/**
 * 象/相：走「田」，塞象眼，且不过河。
 *
 * 象眼是田字中心格，即两格偏移的一半。过河判定看**目标格**：象每步恰好跨两行，
 * 只要落点仍在本方半场就没过河。
 */
function elephantMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  for (const [dc, dr] of ELEPHANT_DELTAS) {
    const to = square(from.col + dc, from.row + dr);
    if (!isOnBoard(to)) continue;
    if (hasCrossedRiver(to, side)) continue;
    const eye = square(from.col + dc / 2, from.row + dr / 2);
    if (pieceAt(pos, eye) !== null) continue;
    pushIfCapturable(out, pos, from, to, side);
  }
  return out;
}

/** 士/仕：九宫内斜走一格。九宫外与直走都不允许。 */
function advisorMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  for (const [dc, dr] of DIAGONAL) {
    const to = square(from.col + dc, from.row + dr);
    if (!isInPalace(to, side)) continue;
    pushIfCapturable(out, pos, from, to, side);
  }
  return out;
}

/**
 * 将/帅：九宫内直走一格。
 *
 * 「飞将」不在这里生成为一步吃子着法，而是作为**非法局面**在
 * {@link kingsFaceEachOther} 中判定——因为对局中将帅照面本身就不允许出现，
 * 不只是「可以吃」的问题：黑方走出一步让双将照面，即使红方并不想吃，
 * 那步棋也是非法的。
 */
function kingMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  for (const [dc, dr] of ORTHOGONAL) {
    const to = square(from.col + dc, from.row + dr);
    if (!isInPalace(to, side)) continue;
    pushIfCapturable(out, pos, from, to, side);
  }
  return out;
}

/**
 * 兵/卒：未过河只能向前一格；过河后多出左右横走，但永远不能后退。
 *
 * 「能否横走」取决于**当前所在格**是否已过河，不是目标格。后退之所以不可能，
 * 是因为向前方向由 {@link forwardStep} 按方固定，压根不生成反向着法。
 */
function pawnMoves(pos: Position, from: Square, side: Side): Move[] {
  const out: Move[] = [];
  const candidates: Square[] = [square(from.col, from.row + forwardStep(side))];
  if (hasCrossedRiver(from, side)) {
    candidates.push(square(from.col - 1, from.row));
    candidates.push(square(from.col + 1, from.row));
  }
  for (const to of candidates) {
    if (!isOnBoard(to)) continue;
    pushIfCapturable(out, pos, from, to, side);
  }
  return out;
}

/**
 * 某格棋子的全部伪合法着法。
 *
 * 「伪合法」指未检查走后是否自杀或形成飞将。空格返回空数组。
 * 生成只看棋子自身归属，与 `pos.sideToMove` 无关——被攻击判定需要在不轮到
 * 对方走时枚举对方的着法。
 */
export function pseudoLegalMovesFrom(pos: Position, from: Square): Move[] {
  const piece = pieceAt(pos, from);
  if (piece === null) return [];
  return movesForPiece(pos, from, piece);
}

function movesForPiece(pos: Position, from: Square, piece: Piece): Move[] {
  switch (piece.type) {
    case "R":
      return rookMoves(pos, from, piece.side);
    case "C":
      return cannonMoves(pos, from, piece.side);
    case "N":
      return knightMoves(pos, from, piece.side);
    case "B":
      return elephantMoves(pos, from, piece.side);
    case "A":
      return advisorMoves(pos, from, piece.side);
    case "K":
      return kingMoves(pos, from, piece.side);
    case "P":
      return pawnMoves(pos, from, piece.side);
  }
}

/** 某方全部伪合法着法。默认取走子方。 */
export function pseudoLegalMoves(
  pos: Position,
  side: Side = pos.sideToMove,
): Move[] {
  const out: Move[] = [];
  for (const sq of ALL_SQUARES) {
    const piece = pos.board[squareIndex(sq)];
    if (piece === null || piece.side !== side) continue;
    out.push(...movesForPiece(pos, sq, piece));
  }
  return out;
}

/**
 * 执行着法，返回新局面。原局面不被修改。
 *
 * **不做合法性检查**——调用方应当先过 {@link isLegalMove}，或直接用
 * rules.ts 的 `playMove`。这里保持"哑"的原因是合法性判定本身需要先落子
 * 再看结果，若此处校验就成了死循环。
 */
export function applyMove(pos: Position, move: Move): Position {
  const board = pos.board.slice();
  board[squareIndex(move.to)] = board[squareIndex(move.from)];
  board[squareIndex(move.from)] = null;
  return { board, sideToMove: opponent(pos.sideToMove) };
}

/**
 * 某格是否被指定一方攻击。
 *
 * 用「枚举该方所有伪合法着法，看有没有落到这一格」实现，而不是从目标格
 * 反向推各种攻击型。反向推需要为炮、马各写一套镜像逻辑，两套逻辑迟早会
 * 不一致；正向枚举只有一份走法定义，正确性只依赖它。
 */
export function isAttackedBy(
  pos: Position,
  target: Square,
  bySide: Side,
): boolean {
  return pseudoLegalMoves(pos, bySide).some((m) => sameSquare(m.to, target));
}

/**
 * 某方是否被将军。
 *
 * 将帅不在盘上时返回 `false`（测试残局可能不摆将）——若返回 `true` 会让
 * 缺将的局面一律判成将死，掩盖构造错误。
 */
export function isInCheck(pos: Position, side: Side): boolean {
  const king = findKing(pos, side);
  if (king === null) return false;
  return isAttackedBy(pos, king, opponent(side));
}

/**
 * 双方将帅是否照面（同列且中间无子）。
 *
 * 这是「飞将」规则：该局面本身非法，与谁走子无关。任何导致它出现的着法都
 * 不合法，因此它与自杀判定并列作为合法性的第二个否决条件。
 */
export function kingsFaceEachOther(pos: Position): boolean {
  const red = findKing(pos, "red");
  const black = findKing(pos, "black");
  if (red === null || black === null) return false;
  if (red.col !== black.col) return false;
  // 用 min/max 而非「黑在上、红在下」的假设：构造出来的局面（残局编辑、
  // 测试）可能把将摆在任意行，写死方向会让扫描区间为空而误判成「无子相隔」
  const top = Math.min(red.row, black.row);
  const bottom = Math.max(red.row, black.row);
  for (let row = top + 1; row < bottom; row += 1) {
    if (pieceAt(pos, square(red.col, row)) !== null) return false;
  }
  return true;
}

/**
 * 走子后的局面对走子方而言是否合法。
 *
 * 两条否决：自己被将军（含"送将"与"解将不彻底"）、双将照面。二者都是
 * 「走完之后」的判断，所以必须在落子后的局面上做。
 */
function isPositionLegalFor(after: Position, mover: Side): boolean {
  return !isInCheck(after, mover) && !kingsFaceEachOther(after);
}

/**
 * 判断一步着法是否合法。
 *
 * 依次校验：起点有己方棋子（且轮到该方）、终点在该子的伪合法着法内、
 * 走完后不自杀且不形成飞将。
 */
export function isLegalMove(pos: Position, move: Move): boolean {
  if (!isOnBoard(move.from) || !isOnBoard(move.to)) return false;
  const piece = pieceAt(pos, move.from);
  if (piece === null || piece.side !== pos.sideToMove) return false;
  const reachable = movesForPiece(pos, move.from, piece).some((m) =>
    sameSquare(m.to, move.to),
  );
  if (!reachable) return false;
  return isPositionLegalFor(applyMove(pos, move), piece.side);
}

/** 走子方的全部合法着法。空数组意味着已被将死或困毙，见 rules.ts。 */
export function legalMoves(pos: Position): Move[] {
  const mover = pos.sideToMove;
  return pseudoLegalMoves(pos, mover).filter((move) =>
    isPositionLegalFor(applyMove(pos, move), mover),
  );
}
