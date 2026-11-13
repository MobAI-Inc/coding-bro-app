/**
 * 斗地主规则引擎对外出口。
 *
 * 规则层只有纯函数：无 DOM、无网络、无随机源、无时钟。服务端与客户端引用
 * 同一份实现，同样的输入必然得出同样的结论——这是「服务端权威 + 客户端预测」
 * 能对得上的唯一保证（core/types.ts 约束 2）。
 */

export type { Card, CardId, Deal, Suit } from "./cards";
export {
  BOTTOM_SIZE,
  DECK_SIZE,
  HAND_SIZE,
  RANK_JOKER_BIG,
  RANK_JOKER_SMALL,
  RANK_MIN,
  RANK_STRAIGHT_MAX,
  RANK_TWO,
  SUITS,
  compareCards,
  containsAll,
  createDeck,
  deal,
  formatCards,
  isJoker,
  parseCards,
  removeCards,
  shuffle,
  sortCards,
} from "./cards";

export type { Pattern, PatternType } from "./patterns";
export { canBeat, identifyPattern, isComparable } from "./patterns";

export type {
  Bid,
  BiddingResult,
  MatchOutcome,
  PlayCheck,
  PlayRejection,
  ScoreFactors,
  Side,
  Spring,
  WinningBid,
} from "./rules";
export {
  SEAT_COUNT,
  addBottomCards,
  canPass,
  checkPlay,
  detectSpring,
  finalScores,
  isValidBid,
  resolveBidding,
  scoreMultiplier,
  settle,
  sideOf,
} from "./rules";
