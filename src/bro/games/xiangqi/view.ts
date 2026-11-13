/**
 * 中国象棋的传输层视图。
 *
 * 服务端下发的是这个结构，不是 `Position`。两者刻意不同，取舍与围棋一致：
 *
 * - `Position.sideToMove` 被删掉了。轮到谁由 `GameState.activeSeat` 表达，
 *   座位号才是内核认识的概念。两处都存「该谁走」必然有一天对不上。
 * - 多了 `checkSquare` 与 `legalMoves`。规则引擎不需要它们，渲染层需要——
 *   将军提示要知道高亮哪一格，可走点提示要知道哪些格能落。
 *
 * `legalMoves` 由服务端算好下发，是这一层最要紧的一个决定：渲染层要高亮
 * 可走点，若让它自己调 `legalMoves(pos)`，规则就爬进了渲染器，违反内核
 * 约束 1（见 core/types.ts）。改由服务端把它当数据发下来，渲染器只是读一张
 * 表，切主题换渲染器时这张表原样跟着走。象棋是完全信息博弈，下发轮走方的
 * 着法不构成泄密；顺带一提，服务端本来就要算它来判将死，不是额外开销。
 *
 * 坐标一律用一维下标（`row * 9 + col`）而不是 `Square`。`Square` 是值对象，
 * 比较得走 `sameSquare`；而渲染层要反复做「这一格是不是选中点 / 是不是可走
 * 点」这类判断，用下标可以直接 `===` 和 `Set<number>`。转换只在本文件这个
 * 边界上做一次。
 *
 * 座位与颜色的映射固定：0 号座执红先行，1 号座执黑。
 */

import type { Move, Piece, Side, Square } from "./logic";
import { FILES, squareIndex } from "./logic";
import type { GameState } from "../core/types";

/** 红方的座位号。象棋只有两个座位，红先。 */
export const SEAT_RED = 0;
/** 黑方的座位号。 */
export const SEAT_BLACK = 1;

/** 一步着法的传输形式。起点终点都是一维下标。 */
export interface ViewMove {
  readonly from: number;
  readonly to: number;
}

/**
 * 终局方式。
 *
 * 与规则引擎的 `MatchOutcome` 刻意不同：多了 `resign`。认输是对局层的事，
 * 规则引擎只看局面与历史，压根不知道有人可以中途放弃。
 *
 * 结构与 `MatchOutcome` 一样是可辨识联合，**和棋分支不带 `winner`**。定义成
 * `winner: Side | null` 的话，每个构造点都得记得填 null，漏填一处的表现就是
 * 和棋界面显示某方胜、结算时真把积分发给了那一方。类型能挡的不靠约定。
 *
 * 这也意味着读 `result.winner` 前必须先收窄 `kind`——渲染层与结算层因此都被
 * 编译器逼着处理和棋，不会像以前那样把和棋悄悄渲染成「黑方胜」。
 */
export type XiangqiResult =
  | { readonly kind: "checkmate"; readonly winner: Side }
  | { readonly kind: "stalemate"; readonly winner: Side }
  | { readonly kind: "resign"; readonly winner: Side }
  /** 长将判负。`winner` 是被将的一方——长将的是输家。 */
  | { readonly kind: "perpetual_check"; readonly winner: Side }
  | { readonly kind: "draw_natural_limit" }
  | { readonly kind: "draw_material" }
  | { readonly kind: "draw_repetition" };

/** 终局方式的判别标签。 */
export type XiangqiResultKind = XiangqiResult["kind"];

/** 该结果是不是和棋（无胜方）。 */
export function isDraw(result: XiangqiResult): boolean {
  return !("winner" in result);
}

export interface XiangqiView {
  /** 按行主序排列的 90 格。row 0 是黑方底线，与规则层同序。 */
  readonly board: readonly (Piece | null)[];
  /** 最后一手。开局为 `null`。只用于标记，不参与裁定。 */
  readonly lastMove: ViewMove | null;
  /**
   * 被将军一方的将/帅所在格，无人被将军为 `null`。
   *
   * 存格子而不是存 `Side`：渲染层要在那一格上画醒目提示，存边还得自己
   * 找将——找将是遍历棋盘，属于规则层的活。
   */
  readonly checkSquare: number | null;
  /** 轮走方的全部合法着法。渲染层据此高亮可走点，自身不含任何规则。 */
  readonly legalMoves: readonly ViewMove[];
  /** 已被吃掉的子，按被吃先后。规则层不留历史，这是纯展示信息。 */
  readonly captured: readonly Piece[];
  /** 终局结果。未终局为 `null`。 */
  readonly result: XiangqiResult | null;
  /** 已走手数。界面据此决定「悔棋」是否可用。 */
  readonly ply: number;
  /**
   * 距自然限着判和还剩多少回合。
   *
   * 由服务端算好下发，理由和 `legalMoves` 一样：渲染层自己算就得持有历史和
   * 规则，那是内核约束 1 禁止的。产品上这个数不能省——不提示的话，玩家会在
   * 第 60 回合被一个突然冒出来的和棋打断，而那盘棋的入场费已经扣了。
   */
  readonly movesUntilDraw: number;
  /**
   * 待答复的悔棋请求，无则 `null`。
   *
   * 双方都看得见同一个请求（只是站在各自角度一个是"等答复"、一个是"要答复"），
   * 所以它属于服务端权威状态，不是渲染器本地状态——本地状态在切主题换渲染器时
   * 会丢，而一个丢掉的悔棋请求会让发起方永远等下去。
   */
  readonly undoRequest: UndoRequest | null;
  /** 各座位已发起过几次悔棋请求，按座位号索引。 */
  readonly undoRequestsUsed: readonly number[];
}

export type XiangqiSnapshot = GameState<XiangqiView>;

/** 座位号转棋色。 */
export function sideOfSeat(seat: number): Side {
  return seat === SEAT_RED ? "red" : "black";
}

/** 棋色转座位号。 */
export function seatOfSide(side: Side): number {
  return side === "red" ? SEAT_RED : SEAT_BLACK;
}

/**
 * 一维下标转坐标。
 *
 * 不做越界校验：越界下标算出的行列自然落在盘外，由规则层的 `isOnBoard`
 * 挡下。在这里抛错会让「客户端发来一个坏下标」从正常的拒绝流程变成崩溃。
 */
export function toSquare(index: number): Square {
  return { col: index % FILES, row: Math.floor(index / FILES) };
}

/** 坐标转一维下标。 */
export function toIndex(sq: Square): number {
  return squareIndex(sq);
}

/** 规则层着法转传输形式。 */
export function toViewMove(move: Move): ViewMove {
  return { from: squareIndex(move.from), to: squareIndex(move.to) };
}

/** 传输形式转规则层着法。 */
export function toMove(vm: ViewMove): Move {
  return { from: toSquare(vm.from), to: toSquare(vm.to) };
}

/** 走子意图的载荷。与 {@link ViewMove} 同形，单列一个名字是为了让意图签名自解释。 */
export interface MovePayload {
  readonly from: number;
  readonly to: number;
}

/**
 * 悔棋一次回退的手数。
 *
 * 回退两手（对手的应招 + 自己那一手），退完仍是自己的回合。只退一手会把行动
 * 权交给对手，那不叫悔棋，叫让子。服务端与界面共用这一个常量，否则会出现
 * 「按钮亮着但一按就被拒」。
 */
export const UNDO_PLIES = 2;

/**
 * 每人每局最多能**发起**几次悔棋请求。
 *
 * 消耗时机是发起，不是被同意——这是这个数字唯一要紧的性质。若按同意计数，
 * 一个人可以无限次发起、让对手无限次被弹窗打断，拒绝多少次都不扣他的额度。
 * 匹配制下对手是陌生人，没有拉黑也没有举报，骚扰的成本必须由发起方付。
 *
 * 3 次是「真手滑够用、当骚扰工具不够用」的量。
 *
 * 这个数**可以随手调**，测试也刻意不钉死它——所有用例都写成 `UNDO_REQUESTS_PER_MATCH`
 * 而不是字面量 3。要紧的是上面那条「按发起计数」的性质，以及用满之后确实发不
 * 出去；具体是 3 还是 5 是手感，与 `DRAW_WARN_MOVES` 同类。钉住字面量只会让
 * 日后调手感的人删掉一条什么也没验证的用例。
 */
export const UNDO_REQUESTS_PER_MATCH = 3;

/** 一个待对方答复的悔棋请求。 */
export interface UndoRequest {
  /** 发起方座位。答复只能由**另一个**座位给出。 */
  readonly bySeat: number;
}

/** 现在能不能发起悔棋请求。界面据此决定按钮与状态栏，服务端据此裁定。 */
export function canRequestUndo(
  view: XiangqiView,
  seat: number | null,
): boolean {
  if (seat === null) return false;
  if (view.ply < UNDO_PLIES) return false;
  // 已有请求悬着时不能再发一个：两个请求同时存在，答复该落到哪个上就没有
  // 确定答案了。对方的请求也一样挡住——那时该做的是答复，不是反手再提一个。
  if (view.undoRequest !== null) return false;
  return undoRequestsLeft(view, seat) > 0;
}

/** 指定座位还剩几次悔棋请求。 */
export function undoRequestsLeft(view: XiangqiView, seat: number): number {
  const used = view.undoRequestsUsed[seat] ?? 0;
  return Math.max(0, UNDO_REQUESTS_PER_MATCH - used);
}

/** 该请求是否在等**我**答复。等我答复的是别人发起的那个。 */
export function awaitingMyReply(
  view: XiangqiView,
  seat: number | null,
): boolean {
  return (
    seat !== null &&
    view.undoRequest !== null &&
    view.undoRequest.bySeat !== seat
  );
}

/** 象棋的意图类型。 */
export const XIANGQI_INTENT = {
  move: "xiangqi/move",
  /**
   * 发起悔棋请求。
   *
   * 从前这个意图叫「悔棋」并且**直接回退局面**。单机打机器人时无所谓，接入
   * 匹配之后那就是作弊：走错一步，单方面把局面退回去重走。现在它只是请求，
   * 退不退由对方决定。
   */
  undoRequest: "xiangqi/undo-request",
  undoAccept: "xiangqi/undo-accept",
  undoDecline: "xiangqi/undo-decline",
  resign: "xiangqi/resign",
} as const;
