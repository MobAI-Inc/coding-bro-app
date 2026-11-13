/**
 * 斗地主的传输层视图。
 *
 * 这是本游戏与围棋最大的差别所在，值得先说清楚：**围棋的局面是公开的，
 * 斗地主不是**。围棋可以把整块棋盘原样下发给两边；斗地主下发给某一家的
 * 视图里，另外两家的手牌**只能有张数，不能有牌**。
 *
 * 「渲染层不显示就行」是错的。数据只要下发到了客户端，改个前端就全看见了
 * ——匹配制下对手是陌生人，那等于把作弊入口敞开（core/types.ts 约束 2）。
 * 所以裁剪必须发生在服务端构造视图的那一刻，本文件的类型就是那道闸门：
 * {@link DoudizhuView} 里根本没有「另外两家的手牌」这个字段，写不进去。
 * 底牌在亮牌前同理。
 *
 * 其余几处刻意的取舍：
 *
 * - **没有 `turn` 字段。** 轮到谁由 `GameState.activeSeat` 表达，座位号才是
 *   内核认识的概念。两处都存「该谁行动」必然有一天对不上（同 go/view.ts）。
 * - **有 `stage`。** 叫分与出牌是两套交互，而内核的 `MatchPhase` 只认
 *   「对局进行中」，它不该理解斗地主。所以子阶段放在视图里，不是重复。
 * - **`toBeat` 只带牌，不带牌型。** 牌都在这儿，谁需要牌型谁自己调
 *   `identifyPattern`——牌型字段是可以和牌本身对不上的第二份真相。
 */

import type { GameState, InputIntent } from "../core/types";
import type { Bid, Card, CardId, Side, Spring, WinningBid } from "./logic";
import { SEAT_COUNT } from "./logic";

/**
 * 斗地主自己的阶段。
 *
 * `over` 与 `GameState.phase === "finished"` 同时成立，看似重复，实则一个是
 * 内核的对局生命周期、一个是牌局阶段：将来一桌打多局时，牌局会回到
 * `bidding`，而对局仍未结束。
 */
export type DoudizhuStage = "bidding" | "playing" | "over";

/** 一家在本轮里做过的事。出的牌是公开信息——已经打在桌上了。 */
export type SeatAction =
  | { readonly kind: "play"; readonly cards: readonly Card[] }
  /** 要不起。 */
  | { readonly kind: "pass" };

/**
 * 一家的公开信息。
 *
 * 字段少得刻意：**这里放什么，就等于向全桌公开什么**。`cardsLeft` 是张数，
 * 不是牌——想加字段前先问一句「这件事对手该不该知道」。
 */
export interface SeatView {
  readonly seat: number;
  /** 剩余张数。只有张数。 */
  readonly cardsLeft: number;
  readonly isLandlord: boolean;
  /** 本轮最近一次动作。新一轮开始时清空。 */
  readonly lastAction: SeatAction | null;
}

/** 桌面上待压的一手牌。 */
export interface TrickView {
  /** 出牌的座位。农民据此判断「这是队友出的，不用压」。 */
  readonly seat: number;
  readonly cards: readonly Card[];
}

/** 底牌。亮牌前只有张数。 */
export interface BottomView {
  readonly count: number;
  /** 地主确定前为 `null`——底牌是三家都还看不到的信息。 */
  readonly cards: readonly Card[] | null;
}

/** 终局结算。 */
export interface ResultView {
  readonly winnerSeat: number;
  readonly winnerSide: Side;
  readonly winners: readonly number[];
  readonly spring: Spring;
  /** 本局倍数（叫分 × 炸弹 × 春天）。 */
  readonly multiplier: number;
  /** 各座位得分，下标即座位号。零和。 */
  readonly scores: readonly number[];
}

export interface DoudizhuView {
  readonly stage: DoudizhuStage;
  /**
   * **本机玩家的手牌，而且只有本机玩家的。**
   *
   * 观战（`mySeat === null`）时为空数组。这个字段是整个视图里唯一带具体
   * 牌张的手牌来源，服务端每次构造视图都要按收件人重新裁一遍。
   */
  readonly hand: readonly Card[];
  /** 三家的公开信息，下标即座位号。 */
  readonly seats: readonly SeatView[];
  readonly landlord: number | null;
  /** 地主的叫分，即底分。未定为 `null`。 */
  readonly bid: WinningBid | null;
  readonly bottom: BottomView;
  /** 待压的牌。`null` 表示本轮自由出牌（谁行动谁领出）。 */
  readonly toBeat: TrickView | null;
  /** 已叫过的分，按叫牌顺序。配合 {@link firstBidder} 能还原是谁叫的。 */
  readonly bids: readonly Bid[];
  readonly firstBidder: number;
  /** 已出现的炸弹数与王炸，用于显示当前倍数的构成。 */
  readonly bombs: number;
  readonly rocket: boolean;
  /** 当前倍数。叫分未定时为 `null`——底分还不存在，算不出倍数。 */
  readonly multiplier: number | null;
  readonly result: ResultView | null;
}

export type DoudizhuSnapshot = GameState<DoudizhuView>;

/* ============================================================
   座位
   ============================================================ */

/** 下家：我之后行动的那一家。出牌顺序沿座位号递增。 */
export function nextSeat(seat: number): number {
  return (seat + 1) % SEAT_COUNT;
}

/** 上家：我之前行动的那一家。 */
export function prevSeat(seat: number): number {
  return (seat + SEAT_COUNT - 1) % SEAT_COUNT;
}

/**
 * 画面位置。
 *
 * 本家恒在下方，上家在左上、下家在右上。三个位置由 `anchor`（本机座位）
 * 推出，**渲染层因此永远不会把座位号当成固定位置**——座位 0 不一定画在
 * 哪儿，取决于本机是谁。写死「座位 0 在下方」的实现只有本机恰好坐 0 号
 * 时才对，而这在匹配制下不成立。
 */
export type SeatSlot = "self" | "left" | "right";

/**
 * 座位号 → 画面位置。
 *
 * 观战时 `anchor` 传 `null`，退化为以 0 号座为本家——观战者没有「自己」，
 * 但版面仍需要一个稳定的锚点，否则三家的位置会随快照乱跳。
 */
export function slotOfSeat(seat: number, anchor: number | null): SeatSlot {
  const base = anchor ?? 0;
  if (seat === base) return "self";
  return seat === nextSeat(base) ? "right" : "left";
}

/** 画面位置 → 座位号。与 {@link slotOfSeat} 互逆。 */
export function seatOfSlot(slot: SeatSlot, anchor: number | null): number {
  const base = anchor ?? 0;
  if (slot === "self") return base;
  return slot === "right" ? nextSeat(base) : prevSeat(base);
}

/**
 * 某座位叫过的分。还没轮到他叫时为 `null`。
 *
 * `bids` 按叫牌顺序存、不按座位存，因为 `isValidBid` 要的就是这个顺序。
 * 座位视角是显示需要，这里换算，不额外存一份。
 */
export function bidOfSeat(view: DoudizhuView, seat: number): Bid | null {
  const offset = (seat - view.firstBidder + SEAT_COUNT) % SEAT_COUNT;
  return offset < view.bids.length ? view.bids[offset] : null;
}

/* ============================================================
   意图
   ============================================================ */

/** 三种意图类型。 */
export const DOUDIZHU_INTENT = {
  bid: "doudizhu/bid",
  play: "doudizhu/play",
  pass: "doudizhu/pass",
} as const;

export interface BidPayload {
  readonly bid: Bid;
}

/**
 * 出牌意图。
 *
 * **只带 id，不带牌本身。** 客户端说「我要出这几张」，由服务端从它自己
 * 持有的那份手牌里按 id 取出真牌——客户端递过来的 `Card` 对象是不可信的，
 * 它可以把 `{id:"S3", rank:17}` 递过来，一张黑桃 3 就成了大王。id 是索引，
 * 牌面永远由服务端说了算。
 */
export interface PlayPayload {
  readonly cardIds: readonly CardId[];
}

/** 玩家（或陪练机器人）想做的事。转成意图前它还只是个念头。 */
export type DoudizhuAction =
  | { readonly type: "bid"; readonly bid: Bid }
  | { readonly type: "play"; readonly cardIds: readonly CardId[] }
  | { readonly type: "pass" };

/**
 * 动作 → 意图。
 *
 * 集中在这里，是为了让「基于哪一版局面」这件事只有一处写法。散落各处时，
 * 总有一个调用点会忘了带 `basedOnVersion`，而那条路径平时全都能跑通，只在
 * 网络抖动补发时才出错。
 */
export function toIntent(
  action: DoudizhuAction,
  matchId: string,
  basedOnVersion: number,
): InputIntent {
  const base = { matchId, basedOnVersion };
  switch (action.type) {
    case "bid":
      return {
        ...base,
        type: DOUDIZHU_INTENT.bid,
        payload: { bid: action.bid } satisfies BidPayload,
      };
    case "play":
      return {
        ...base,
        type: DOUDIZHU_INTENT.play,
        payload: { cardIds: action.cardIds } satisfies PlayPayload,
      };
    case "pass":
      return { ...base, type: DOUDIZHU_INTENT.pass, payload: {} };
  }
}
