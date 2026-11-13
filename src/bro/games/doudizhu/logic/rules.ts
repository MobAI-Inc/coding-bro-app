/**
 * 斗地主：叫地主、出牌合法性、胜负与结算。
 *
 * 这里的每个函数都是「给定局面 + 一个动作 → 结果」的纯判定，不持有对局状态。
 * 状态机（谁该行动、连续过牌几次要重开一轮）属于服务端，规则层只回答
 * 「这个动作合不合法」——照 core/types.ts 的约束 3，客户端拿同样的函数做
 * 预测，非法就地拒绝，合法也仍以服务端下发为准。
 */

import type { Card } from "./cards";
import { removeCards, sortCards } from "./cards";
import type { Pattern } from "./patterns";
import { canBeat, identifyPattern } from "./patterns";

/** 斗地主固定三人。 */
export const SEAT_COUNT = 3;

/** 阵营。农民是一方，任一农民出完，两个农民一起赢。 */
export type Side = "landlord" | "farmer";

/** 叫分。0 表示不叫。 */
export type Bid = 0 | 1 | 2 | 3;

/** 有效叫分（成为地主时的底分）。 */
export type WinningBid = 1 | 2 | 3;

export type BiddingResult =
  /** 还没叫完，轮到 `nextSeat`。 */
  | { status: "bidding"; nextSeat: number }
  | { status: "settled"; landlord: number; bid: WinningBid }
  /** 三家都不叫，重新发牌。 */
  | { status: "redeal" };

/** 当前最高叫分。没人叫过时为 0。 */
function highestBid(bids: readonly Bid[]): number {
  return bids.reduce<number>((top, bid) => (bid > top ? bid : top), 0);
}

/**
 * 这一次叫分是否合法。
 *
 * 采用一人一次的叫分制：按座位轮一圈，出价必须**严格高于**当前最高分，
 * 「不叫」（0）任何时候都允许。叫到 3 分即封顶，后面的人不再有叫的机会——
 * 若不显式挡住，UI 上会出现「已经有人叫 3 分了却还能点叫分」的死路。
 *
 * @param bids 已按叫牌顺序记录的叫分
 * @param bid 本次叫分
 */
export function isValidBid(bids: readonly Bid[], bid: Bid): boolean {
  if (bids.length >= SEAT_COUNT) return false;
  if (bids.includes(3)) return false;
  if (bid === 0) return true;
  return bid > highestBid(bids);
}

/**
 * 根据已有叫分推进/结束叫地主阶段。
 *
 * @param firstSeat 首个叫牌的座位。由外部（服务端）决定，不在这里随机。
 * @param bids 按叫牌顺序记录的叫分，`bids[i]` 属于座位 `(firstSeat + i) % 3`
 */
export function resolveBidding(
  firstSeat: number,
  bids: readonly Bid[],
): BiddingResult {
  const top = bids.indexOf(3);
  // 3 分封顶，立刻定地主，剩下的人不用再叫
  if (top !== -1) {
    return {
      status: "settled",
      landlord: (firstSeat + top) % SEAT_COUNT,
      bid: 3,
    };
  }
  if (bids.length < SEAT_COUNT) {
    return {
      status: "bidding",
      nextSeat: (firstSeat + bids.length) % SEAT_COUNT,
    };
  }
  const best = highestBid(bids);
  if (best === 0) return { status: "redeal" };
  return {
    status: "settled",
    landlord: (firstSeat + bids.indexOf(best as Bid)) % SEAT_COUNT,
    bid: best as WinningBid,
  };
}

/** 地主收底牌。返回排好序的新手牌，不修改入参。 */
export function addBottomCards(
  hand: readonly Card[],
  bottom: readonly Card[],
): Card[] {
  return sortCards([...hand, ...bottom]);
}

/** 座位所属阵营。 */
export function sideOf(seat: number, landlord: number): Side {
  return seat === landlord ? "landlord" : "farmer";
}

/** 出牌被拒的原因。拒绝是正常流程，因此用可枚举的原因码而不是抛错。 */
export type PlayRejection =
  /** 一张没出。想放弃这一轮应当过牌，不是出空牌。 */
  | "empty"
  /** 牌不在手上，或同一张牌被重复提交。 */
  | "not_in_hand"
  /** 凑不成任何牌型。 */
  | "unknown_pattern"
  /** 牌型合法但压不过上家。 */
  | "cannot_beat";

export type PlayCheck =
  | { ok: true; pattern: Pattern; rest: Card[] }
  | { ok: false; reason: PlayRejection };

/**
 * 校验一次出牌。
 *
 * 顺序刻意如此：先确认牌真在手上，再谈牌型。反过来写的话，伪造的牌能先被
 * 识别成漂亮牌型，错误信息就会变成「压不过上家」，把「手上根本没这张牌」
 * 这件事盖住了。
 *
 * @param hand 出牌者当前手牌
 * @param cards 想出的牌
 * @param toBeat 需要压过的牌型；`null` 表示新一轮自由出牌
 * @returns 合法时附带识别出的牌型与出牌后的剩余手牌
 */
export function checkPlay(
  hand: readonly Card[],
  cards: readonly Card[],
  toBeat: Pattern | null,
): PlayCheck {
  if (cards.length === 0) return { ok: false, reason: "empty" };
  const rest = removeCards(hand, cards);
  if (rest === null) return { ok: false, reason: "not_in_hand" };
  const pattern = identifyPattern(cards);
  if (pattern === null) return { ok: false, reason: "unknown_pattern" };
  if (!canBeat(pattern, toBeat)) return { ok: false, reason: "cannot_beat" };
  return { ok: true, pattern, rest };
}

/**
 * 能否过牌。
 *
 * 自由出牌（上家没有可压的牌）时必须出牌——允许在自己领出的一轮里过牌，
 * 三家会一直互相等待，这一局就卡死了。
 */
export function canPass(toBeat: Pattern | null): boolean {
  return toBeat !== null;
}

/** 对局结果。 */
export interface MatchOutcome {
  /** 先出完牌的座位。 */
  winnerSeat: number;
  winnerSide: Side;
  /** 获胜的所有座位。农民赢时是两个人。 */
  winners: number[];
}

/**
 * 判定胜负。没人出完返回 `null`（对局继续）。
 *
 * 农民是共同体：任一农民打光手牌，两个农民一起赢——只认「先出完的那个人赢」
 * 会把另一个农民误判成输家。
 *
 * @param hands 三家手牌，下标即座位号
 * @param landlord 地主座位
 */
export function settle(
  hands: readonly (readonly Card[])[],
  landlord: number,
): MatchOutcome | null {
  const winnerSeat = hands.findIndex((hand) => hand.length === 0);
  if (winnerSeat === -1) return null;
  const winnerSide = sideOf(winnerSeat, landlord);
  const winners =
    winnerSide === "landlord"
      ? [landlord]
      : hands.map((_, seat) => seat).filter((seat) => seat !== landlord);
  return { winnerSeat, winnerSide, winners };
}

/** 春天状态。`landlord` 为地主打春天，`farmer` 为农民反春。 */
export type Spring = "none" | "landlord" | "farmer";

/**
 * 春天判定。
 *
 * - 春天：地主赢，且两个农民一手牌都没出过。
 * - 反春：农民赢，且地主只出过第一手（他必然要领出一手，因此门槛是 ≤1）。
 *
 * @param playsBySeat 每个座位实际出牌的手数（过牌不计），下标即座位号
 */
export function detectSpring(
  playsBySeat: readonly number[],
  landlord: number,
  winnerSide: Side,
): Spring {
  if (winnerSide === "landlord") {
    const farmersPlayed = playsBySeat.some(
      (plays, seat) => seat !== landlord && plays > 0,
    );
    return farmersPlayed ? "none" : "landlord";
  }
  return playsBySeat[landlord] <= 1 ? "farmer" : "none";
}

/** 影响最终倍数的因素。 */
export interface ScoreFactors {
  /** 地主的叫分，即底分。 */
  bid: WinningBid;
  /** 本局出过的炸弹数。 */
  bombs: number;
  /** 本局是否出过王炸。 */
  rocket: boolean;
  spring: Spring;
}

/**
 * 本局倍数 = 叫分 × 2^(炸弹数 + 王炸) × 春天翻倍。
 *
 * 王炸单独计一次翻倍而不是并进 `bombs`，是因为调用方通常从出牌记录里分别
 * 统计这两种牌型，混在一起容易漏。
 */
export function scoreMultiplier(factors: ScoreFactors): number {
  const bombFactor = 2 ** (factors.bombs + (factors.rocket ? 1 : 0));
  const springFactor = factors.spring === "none" ? 1 : 2;
  return factors.bid * bombFactor * springFactor;
}

/**
 * 各座位得分，下标即座位号。零和：地主一人对两家，赢就吃两份，输就赔两份。
 */
export function finalScores(
  outcome: MatchOutcome,
  landlord: number,
  factors: ScoreFactors,
): number[] {
  const stake = scoreMultiplier(factors);
  const landlordWon = outcome.winnerSide === "landlord";
  return Array.from({ length: SEAT_COUNT }, (_, seat) =>
    seat === landlord
      ? (landlordWon ? 1 : -1) * stake * 2
      : (landlordWon ? -1 : 1) * stake,
  );
}
