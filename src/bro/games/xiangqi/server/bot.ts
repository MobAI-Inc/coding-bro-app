/**
 * 陪练机器人。
 *
 * 定位是「陪练」不是「对手」：目标是让人一个人也能把一局棋走完，顺手教会
 * 新手别送子。所以它只做三件事——能将死就将死，能白吃就吃，别把子送到
 * 对方嘴边——没有搜索，没有开局库，两三层的战术它看不见。
 *
 * 特意不做搜索：一个下得过强的机器人会让新手一路挨打，而这个模块要服务的
 * 恰恰是「点开就想下一盘」的人。等真人对战接进来，本文件就只剩练习模式在用。
 *
 * 随机源由外部注入。用全局 `Math.random` 的话，测试要么断言不了，要么只能
 * 打补丁改全局——那会污染同一进程里的其他用例。
 */

import type { Move, Piece, PieceType, Position, Side } from "../logic";
import {
  applyMove,
  getOutcome,
  isAttackedBy,
  isCheck,
  legalMoves,
  opponent,
  pieceAt,
} from "../logic";

/**
 * 子力价值。
 *
 * 数值取自象棋常见的估值习惯（车 9、马炮 4 上下、兵过河前很轻），只用于比较
 * 大小，不代表任何精确评估。将/帅给一个远大于其余之和的值——将被吃就已经
 * 输了，任何数量的子都换不来，用「大数」而不是 Infinity 是为了让加减法不出
 * NaN。
 */
const VALUE: Readonly<Record<PieceType, number>> = {
  K: 1000,
  R: 9,
  C: 4.5,
  N: 4,
  B: 2,
  A: 2,
  P: 1,
};

/** 注入的随机源。返回 [0, 1)。 */
export type Rng = () => number;

export interface BotOptions {
  readonly rng?: Rng;
}

/**
 * 选一步棋。无棋可走（已被将死或困毙）时返回 `null`。
 *
 * 返回着法而不是新局面：谁来推进局面是服务端的事，机器人只是提意见。这条
 * 边界与人类玩家发意图是同一条——机器人不该有绕过裁定的特权。
 */
export function chooseMove(
  pos: Position,
  options: BotOptions = {},
): Move | null {
  const rng = options.rng ?? Math.random;
  const moves = legalMoves(pos);
  if (moves.length === 0) return null;

  // 一击致胜的先看。放过送到眼前的将死，人一眼就能看出来，机器人显得很傻
  const mate = moves.filter((move) => isMate(pos, move));
  if (mate.length > 0) return pick(mate, rng);

  let best = -Infinity;
  let bucket: Move[] = [];
  for (const move of moves) {
    const s = score(pos, move);
    // 同分的全留着，最后随机挑一个。取第一个会让机器人在同一局面下永远走
    // 同一步，几盘之后就变成背棋谱
    if (s > best) {
      best = s;
      bucket = [move];
    } else if (s === best) {
      bucket.push(move);
    }
  }
  return pick(bucket, rng);
}

/** 这一手走完对方是否已被将死。 */
function isMate(pos: Position, move: Move): boolean {
  return getOutcome(applyMove(pos, move)).kind === "checkmate";
}

/**
 * 给一手棋打分：吃到的子力 − 走完之后自己这个子被吃的风险。
 *
 * 「被吃的风险」只看一层：走完之后终点格是否被对方攻击。看不出「垫一手再吃」
 * 这类两层战术，但足以避免最刺眼的送子——新手最难受的就是陪练一直白送。
 */
function score(pos: Position, move: Move): number {
  const captured = valueOf(pieceAt(pos, move.to));
  const after = applyMove(pos, move);
  const mover = pos.sideToMove;

  let s = captured;
  if (isAttackedBy(after, move.to, opponent(mover))) {
    s -= valueOf(pieceAt(after, move.to));
  }
  // 将军多给一点：不是因为将军就一定好，而是这样它偶尔会主动进攻，
  // 否则一盘棋会退化成双方在原地挪子
  if (isCheck(after)) s += 0.5;
  return s;
}

function valueOf(piece: Piece | null): number {
  return piece === null ? 0 : VALUE[piece.type];
}

function pick(moves: readonly Move[], rng: Rng): Move {
  // 夹一次范围：注入的随机源若返回 1（或负数），下标就会越界拿到 undefined，
  // 而那会在服务端那边变成一个莫名其妙的「非法着法」
  const i = Math.min(
    moves.length - 1,
    Math.max(0, Math.floor(rng() * moves.length)),
  );
  return moves[i];
}

/** 机器人执哪一方由服务端决定，这里只提供一个可读的名字给界面显示。 */
export function botName(side: Side): string {
  return side === "red" ? "机器人（红）" : "机器人（黑）";
}
