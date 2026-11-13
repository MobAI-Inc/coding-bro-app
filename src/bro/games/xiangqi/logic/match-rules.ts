/**
 * 对局层规则：需要**着法历史**才能判的那部分胜负与和棋。
 *
 * 与 rules.ts 的分工是一条硬线：
 *
 * - `rules.getOutcome(pos)` 只问「轮走方还有棋走吗」，只看一个局面。
 * - `matchOutcome(history, pos)` 问「这盘棋结束了吗」，要看整盘。
 *
 * 分开是因为二者的输入不同，混在一起会逼着纯局面判定也去接一个它用不上的
 * 历史参数；而更要紧的是，象棋里**同一个局面**可以既是和棋也不是和棋——差别
 * 全在怎么走到这里的。把这件事塞进 `getOutcome` 会让那个函数从纯函数变成
 * 「看起来是纯函数」，那比不纯更危险。
 *
 * ## 为什么必须有这个文件
 *
 * 在此之前象棋只会以将死、困毙、认输三种方式结束。也就是说双方各剩一个光杆
 * 将时，这盘棋**永远不会结束**——两个将在九宫里互相躲，`getOutcome` 永远返回
 * `ongoing`。对规则来说这是错的，对我们来说还更贵一层：入场费在进场时就扣了
 * （见 lobby/GamesRoute.tsx），一盘不结算的棋等于把积分收了却不给任何结果。
 * 所以和棋判定不是"规则完整性"这种锦上添花，是补一个吞积分的洞。
 *
 * ## 实现了哪些，没实现哪些
 *
 * | 规则 | 状态 |
 * |------|------|
 * | 自然限着（60 回合无吃子）判和 | ✅ |
 * | 双方均无攻击子力判和 | ✅ |
 * | 三次重复局面，双方不变作和 | ✅ |
 * | 长将判负 | ✅（以三次重复为客观判据，见下） |
 * | **长捉判负** | ❌ **刻意不做** |
 *
 * **长捉不做的理由**：判长捉要先分清「捉」与「闲」，而这个区分依赖对子力
 * 价值、根的有无、是否属于兑/献/拦/跟的判断——真人裁判之间都会有分歧。做一个
 * 七成准的长捉判定，会在三成的情况下把不该判负的一方判负，那比不判更糟：
 * 玩家会觉得系统在乱扣分，而这套系统扣的是有兑换价值的积分。宁可漏判也不错判，
 * 漏判的后果是那盘棋走到自然限着变成和棋，是个可接受的兜底。
 *
 * **长将用三次重复作判据**：真实规则里长将由裁判认定「一方长将不变」，没有
 * 次数门槛。三次重复是能写成代码的客观替代——代价是判定会比裁判晚几个回合，
 * 但不会判错方向。
 */

import type { PieceType, Position, Side } from "./board";
import { toFen } from "./board";
import { isInCheck } from "./moves";
import type { Outcome } from "./rules";
import { getOutcome } from "./rules";

/**
 * 自然限着的回合数。一个回合是双方各走一着。
 *
 * 数值取自中国象棋竞赛规则的 60 回合。写成常量而不是字面量，是因为对局
 * 层与界面（"还剩 N 回合判和"的提示）必须用同一个数——两处各写一遍，迟早
 * 出现界面倒数到 0 了棋还在继续。
 */
export const NATURAL_LIMIT_MOVES = 60;

/** 自然限着换算成半着（ply）。判定按半着走，因为历史是按半着记的。 */
export const NATURAL_LIMIT_PLIES = NATURAL_LIMIT_MOVES * 2;

/**
 * 判定重复局面所需的出现次数。
 *
 * 三次指「同一局面第三次出现」，含当前这一次。
 */
export const REPETITION_LIMIT = 3;

/**
 * 有攻击能力的子力。
 *
 * 将（K）、士（A）、象（B）都过不了河或出不了九宫，单靠它们无法把对方将死，
 * 所以双方都只剩这三种时必和。
 *
 * 注意这是**保守**判定：只剩单马或单炮而对方有士象时其实也多半和棋，但那要
 * 分具体子力组合，属于「理论上无法取胜」的一长串表。这里只收最无争议的那条，
 * 剩下的交给自然限着兜底——晚 60 回合判和，总好过把有杀棋的局面提前判和。
 */
const ATTACKING_TYPES: ReadonlySet<PieceType> = new Set<PieceType>([
  "R",
  "N",
  "C",
  "P",
]);

/**
 * 一手棋在对局层需要留下的痕迹。
 *
 * 只要两样：走之前的局面，以及这一手有没有吃子。
 *
 * 刻意**不**让调用方传「这手是不是将军」——那一项可以从局面推出来（走完之后
 * 轮到对方，对方若被将军，这手就是将），让调用方自己算就多一处能和局面对不上的
 * 地方。凡是能推的都不收，收进来的每一个字段都是一个要维护的不变量。
 */
export interface MatchPly {
  /** 走这一手**之前**的局面。 */
  readonly before: Position;
  /** 这一手是否吃了子。 */
  readonly captured: boolean;
}

/**
 * 对局结果。
 *
 * 和棋那三种**没有 `winner` 字段**，不是「`winner` 为 null」——用可辨识联合把
 * 「和棋却有胜方」这种状态做成写不出来的东西。若定义成 `winner: Side | null`，
 * 每个构造点都得记得填 null，而漏填的表现是和棋界面上显示某方胜，结算时就是
 * 真的把积分发给了一方。类型能挡住的事不要靠约定。
 */
export type MatchOutcome =
  | { readonly kind: "ongoing" }
  | { readonly kind: "checkmate"; readonly winner: Side }
  | { readonly kind: "stalemate"; readonly winner: Side }
  /** 长将判负。`winner` 是**被将的一方**——长将的是输家。 */
  | { readonly kind: "perpetual_check"; readonly winner: Side }
  /** 自然限着：连续 {@link NATURAL_LIMIT_MOVES} 回合无吃子。 */
  | { readonly kind: "draw_natural_limit" }
  /** 双方均无攻击子力。 */
  | { readonly kind: "draw_material" }
  /** 三次重复局面且非长将，双方不变作和。 */
  | { readonly kind: "draw_repetition" };

/** 该结果是否已终局。 */
export function isFinished(outcome: MatchOutcome): boolean {
  return outcome.kind !== "ongoing";
}

/**
 * 局面指纹，用于判重复。
 *
 * 直接用 FEN：它已经含子力分布与走子方，而**走子方必须计入**——同样的子力
 * 摆位轮红走和轮黑走是两个不同局面，混为一谈会把正常的一来一回误判成重复。
 */
export function positionKey(pos: Position): string {
  return toFen(pos);
}

/** 某方是否还有攻击子力（车马炮兵）。 */
export function hasAttackingPiece(pos: Position, side: Side): boolean {
  return pos.board.some(
    (piece) =>
      piece !== null && piece.side === side && ATTACKING_TYPES.has(piece.type),
  );
}

/** 双方都没有攻击子力——谁也杀不死谁。 */
export function bothSidesCannotWin(pos: Position): boolean {
  return !hasAttackingPiece(pos, "red") && !hasAttackingPiece(pos, "black");
}

/**
 * 距上次吃子过了多少半着。开局至今无人吃子时即为已走的全部半着数。
 */
export function pliesSinceCapture(history: readonly MatchPly[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].captured) break;
    count += 1;
  }
  return count;
}

/**
 * 还原每一手走完之后的局面。
 *
 * 第 i 手走完的局面就是第 i+1 手走之前的局面；最后一手走完就是当前局面。
 * 于是整盘棋不需要重新演算一遍着法——历史里已经存了所有中间局面，重演反而
 * 会引入「重演结果与当时不一致」的新错误来源。
 */
function positionAfter(
  history: readonly MatchPly[],
  index: number,
  current: Position,
): Position {
  return index + 1 < history.length ? history[index + 1].before : current;
}

/**
 * 第 index 手是不是「将军」。
 *
 * 走完之后轮到对方；对方此时被将军，这一手就是将。
 */
function gaveCheck(
  history: readonly MatchPly[],
  index: number,
  current: Position,
): boolean {
  const after = positionAfter(history, index, current);
  return isInCheck(after, after.sideToMove);
}

/**
 * 当前局面出现过几次（含当前这一次）。
 */
function repetitionCount(
  history: readonly MatchPly[],
  current: Position,
): number {
  const key = positionKey(current);
  let count = 1;
  for (const ply of history) {
    if (positionKey(ply.before) === key) count += 1;
  }
  return count;
}

/**
 * 重复循环的起点：当前局面**第一次**出现在历史里的下标。
 *
 * 从那一手起到现在的这一段就是循环体，长将与否只看这一段——看整盘会把开局
 * 正常的几步将军也算进来，从而把一个普通的重复局面误判成长将。
 */
function firstOccurrence(
  history: readonly MatchPly[],
  current: Position,
): number {
  const key = positionKey(current);
  return history.findIndex((ply) => positionKey(ply.before) === key);
}

/**
 * 循环段里某一方是不是「每一步都在将军」。
 *
 * 空集返回 true（`every` 的语义）。这里**不加**「至少走过一步」的保护，理由是
 * 那个分支根本走不到：循环段的两端都是同一方走子，段长必为偶数且 ≥2，所以
 * 段里一定有双方各自的着法。加一个进不去的分支，等于加一段没人验证的代码。
 *
 * 万一哪天真的传进来一段只有单方着法的历史，空集为真的结果是双方都算长将，
 * 落到互将判和——不判负。这与本文件「宁可漏判也不错判」的取向一致。
 */
function alwaysChecking(
  history: readonly MatchPly[],
  from: number,
  current: Position,
  side: Side,
): boolean {
  for (let i = from; i < history.length; i += 1) {
    if (history[i].before.sideToMove !== side) continue;
    if (!gaveCheck(history, i, current)) return false;
  }
  return true;
}

/**
 * 长将裁定表：把「谁在长将」这个事实映射成结果。
 *
 * 单独提出来是为了**能测互将**。手工构造一个双方步步照将又能循环的合法局面
 * 是排局级别的难题（双方同时被将是非法局面，只能靠每一手同时解将又照将来
 * 交替实现），造不出来就意味着这条规则明文的分支没人验。把表拆出来之后，
 * 棋盘那一半（谁在长将）由 {@link alwaysChecking} 那侧的用例覆盖，规则那一半
 * 在这里直接枚举四种组合。
 *
 * 互将判和是规则明文，不是图省事的取舍。
 */
export function adjudicatePerpetual(
  redPerpetual: boolean,
  blackPerpetual: boolean,
): MatchOutcome {
  if (redPerpetual && !blackPerpetual) {
    return { kind: "perpetual_check", winner: "black" };
  }
  if (blackPerpetual && !redPerpetual) {
    return { kind: "perpetual_check", winner: "red" };
  }
  return { kind: "draw_repetition" };
}

/** 三次重复之后的裁定：先看棋盘上谁在长将，再查 {@link adjudicatePerpetual}。 */
function adjudicateRepetition(
  history: readonly MatchPly[],
  current: Position,
): MatchOutcome {
  const from = firstOccurrence(history, current);
  // 出现次数 ≥3 才会走到这里，历史里必然找得到，此处不会是 -1。
  return adjudicatePerpetual(
    alwaysChecking(history, from, current, "red"),
    alwaysChecking(history, from, current, "black"),
  );
}

/**
 * 整盘棋现在算什么结果。
 *
 * 判定顺序不是随意的，每一步都有理由：
 *
 * 1. **将死 / 困毙优先。** 它们是"棋已经下完了"，无棋可走的局面不该再去问
 *    重复或限着。反过来先判和会出现「将死的同时正好凑满 60 回合」判成和棋。
 * 2. **长将 / 重复次之。** 长将是判负，必须排在两条和棋前面，否则一个长将
 *    循环走满 60 回合会先撞上自然限着，变成和棋——长将方白赚半分。
 * 3. **自然限着与子力不足最后。** 两条都是兜底。
 *
 * @param history 已走的每一手，按先后。
 * @param current 当前局面，即最后一手走完之后的局面。
 */
export function matchOutcome(
  history: readonly MatchPly[],
  current: Position,
): MatchOutcome {
  const outcome: Outcome = getOutcome(current);
  if (outcome.kind !== "ongoing") return outcome;

  if (repetitionCount(history, current) >= REPETITION_LIMIT) {
    return adjudicateRepetition(history, current);
  }

  if (pliesSinceCapture(history) >= NATURAL_LIMIT_PLIES) {
    return { kind: "draw_natural_limit" };
  }

  if (bothSidesCannotWin(current)) {
    return { kind: "draw_material" };
  }

  return { kind: "ongoing" };
}

/**
 * 距自然限着判和还剩多少回合。已判和时为 0。
 *
 * 给界面用：走到第 50 回合时玩家该看到倒计时，而不是在第 60 回合被一个
 * 突然出现的和棋结果打断。
 */
export function movesUntilNaturalDraw(history: readonly MatchPly[]): number {
  const left = NATURAL_LIMIT_PLIES - pliesSinceCapture(history);
  return left <= 0 ? 0 : Math.ceil(left / 2);
}
