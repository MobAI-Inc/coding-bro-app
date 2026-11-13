/**
 * 陪练机器人。
 *
 * 会叫分、会跟牌、要不起就过。这不是对手 AI 的最终形态——真正的对手来自
 * 匹配，人机模式将由服务端侧提供。这里只是让牌桌在服务端就绪前能一个人
 * 玩起来。
 *
 * 两条约束值得单独说：
 *
 * 1. **机器人只看得到自己的手牌。** 它吃的是 `server.viewFor(seat)` 裁剪过
 *    的视图，和真人拿到的一模一样。给机器人开透视很省事，但那样练出来的
 *    手感是假的——它会精准地压你每一手，而真人对手做不到。
 * 2. **候选着法一律过一遍 `identifyPattern` / `canBeat`。** 生成逻辑写错了
 *    顶多让它打得笨，不会让它出出非法的牌。
 *
 * RNG 由外部注入而非直接用 `Math.random()`，测试才能固定种子断言着法。
 */

import type { Bid, Card, Pattern } from "../logic";
import {
  RANK_JOKER_BIG,
  RANK_JOKER_SMALL,
  RANK_STRAIGHT_MAX,
  RANK_TWO,
  SEAT_COUNT,
  canBeat,
  canPass,
  identifyPattern,
  isValidBid,
  sideOf,
} from "../logic";
import type { DoudizhuAction, DoudizhuView } from "../view";
import { patternToBeat } from "../render/selection";

/**
 * 选一个动作。
 *
 * @param view **必须是 `viewFor(seat)` 的结果**——`view.hand` 被当作这个座位
 *   自己的手牌。传错座位的视图，机器人会拿着别人的牌思考。
 * @param seat 机器人的座位
 * @param random 返回 [0, 1) 的随机数
 */
export function chooseBotAction(
  view: DoudizhuView,
  seat: number,
  random: () => number,
): DoudizhuAction {
  return chooseBotDecision(view, seat, random).action;
}

export interface DoudizhuBotDecision {
  readonly action: DoudizhuAction;
  readonly explanation: string;
}

/** 与动作一起返回一句玩家能看懂的理由，方便本地陪练而不泄露隐藏手牌。 */
export function chooseBotDecision(
  view: DoudizhuView,
  seat: number,
  random: () => number,
): DoudizhuBotDecision {
  const action =
    view.stage === "bidding"
      ? chooseBid(view, random)
      : choosePlay(view, seat, random);

  if (action.type === "bid") {
    return {
      action,
      explanation:
        action.bid === 0
          ? "大牌和炸弹不足，选择不叫"
          : `牌力达到门槛，选择叫 ${action.bid} 分`,
    };
  }
  if (action.type === "pass") {
    return {
      action,
      explanation: "没有合适的小牌压制，保留大牌选择不出",
    };
  }
  return {
    action,
    explanation: `用 ${action.cardIds.length} 张合法牌推进，优先保留炸弹`,
  };
}

/* ============================================================
   叫分
   ============================================================ */

/** 王与 2 的估值。数值本身不重要，重要的是「大牌越多越敢叫」这个单调性。 */
const CARD_VALUE: Record<number, number> = {
  [RANK_JOKER_BIG]: 3,
  [RANK_JOKER_SMALL]: 2,
  [RANK_TWO]: 1.5,
  14: 0.5,
};

/** 叫到某个分所需的牌力门槛。 */
const BID_THRESHOLD: readonly { bid: Bid; need: number }[] = [
  { bid: 3, need: 7 },
  { bid: 2, need: 5 },
  { bid: 1, need: 3 },
];

/** 手牌强度：大牌 + 炸弹。 */
export function handStrength(hand: readonly Card[]): number {
  const counts = new Map<number, number>();
  let score = 0;
  for (const card of hand) {
    score += CARD_VALUE[card.rank] ?? 0;
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  for (const count of counts.values()) if (count === 4) score += 2;
  return score;
}

function chooseBid(view: DoudizhuView, random: () => number): DoudizhuAction {
  // 加一点抖动，免得同一副牌永远叫同一个分，陪练变成背答案
  const strength = handStrength(view.hand) + random();
  const want =
    BID_THRESHOLD.find((step) => strength >= step.need)?.bid ?? (0 as Bid);

  if (want > 0 && isValidBid(view.bids, want)) {
    return { type: "bid", bid: want };
  }

  // 自己是最后一个叫的、且前面没人叫：再不叫就得重新发牌。这不是为了赢，
  // 是为了让本地对局不至于卡在无限重发里
  const isLast = view.bids.length === SEAT_COUNT - 1;
  const nobodyCalled = view.bids.every((bid) => bid === 0);
  if (isLast && nobodyCalled && isValidBid(view.bids, 1)) {
    return { type: "bid", bid: 1 };
  }
  return { type: "bid", bid: 0 };
}

/* ============================================================
   出牌
   ============================================================ */

/**
 * 对方剩这么多张以内才值得动炸弹。
 *
 * 开局就把炸弹拆出去压一个单张，是新手最常见的亏法：炸弹的价值在于
 * 关键时刻断掉对方的一条龙，而不是赢下某一手。
 */
const BOMB_URGENCY = 5;

function choosePlay(
  view: DoudizhuView,
  seat: number,
  random: () => number,
): DoudizhuAction {
  const toBeat = patternToBeat(view);

  // 队友出的牌不压。农民是共同体，互相压牌等于替地主打自己人
  if (view.toBeat !== null && view.landlord !== null) {
    const mine = sideOf(seat, view.landlord);
    const theirs = sideOf(view.toBeat.seat, view.landlord);
    if (mine === theirs && view.toBeat.seat !== seat && canPass(toBeat)) {
      return { type: "pass" };
    }
  }

  const candidates = enumeratePlays(view.hand).filter((pattern) =>
    canBeat(pattern, toBeat),
  );
  if (candidates.length === 0) {
    return canPass(toBeat) ? { type: "pass" } : leadFallback(view.hand);
  }

  const lead = toBeat === null;
  const best = pick(candidates, lead, random);

  // 只剩炸弹能压，但对方还远没到收官：留着
  if (isBombLike(best) && !lead && !worthBombing(view)) {
    return canPass(toBeat) ? { type: "pass" } : toAction(best);
  }
  return toAction(best);
}

function worthBombing(view: DoudizhuView): boolean {
  return view.seats.some(
    (seat) => seat.cardsLeft > 0 && seat.cardsLeft <= BOMB_URGENCY,
  );
}

/**
 * 从候选里挑一手。
 *
 * 领出与跟牌的取向不同：跟牌要「刚好压过」，所以同类里取点数最小、张数
 * 最少的；领出要「顺手清牌」，所以同点数里取张数最多的（有 34567 就别
 * 单独扔一张 3）。两种情况下炸弹都排在最后。
 */
function pick(
  candidates: readonly Pattern[],
  lead: boolean,
  random: () => number,
): Pattern {
  const sorted = candidates.slice().sort((a, b) => {
    const bomb = Number(isBombLike(a)) - Number(isBombLike(b));
    if (bomb !== 0) return bomb;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return lead ? b.size - a.size : a.size - b.size;
  });

  // 领出时偶尔换第二选择，免得同一副牌每次都走出一模一样的牌路
  if (lead && sorted.length > 1 && random() < 0.15) return sorted[1];
  return sorted[0];
}

function isBombLike(pattern: Pattern): boolean {
  return pattern.type === "bomb" || pattern.type === "rocket";
}

function toAction(pattern: Pattern): DoudizhuAction {
  return { type: "play", cardIds: pattern.cards.map((card) => card.id) };
}

/**
 * 兜底：一张也压不过又不许过（自己领出的一轮），随便扔张最小的。
 *
 * 正常走不到这里——手上只要有牌，单张就一定是候选。留着是因为「不许过
 * 又没得出」会让整局卡死，而卡死比出张烂牌难查得多。
 */
function leadFallback(hand: readonly Card[]): DoudizhuAction {
  if (hand.length === 0) return { type: "pass" };
  return { type: "play", cardIds: [hand[0].id] };
}

/* ============================================================
   候选着法枚举
   ============================================================ */

interface RankGroup {
  readonly rank: number;
  readonly cards: readonly Card[];
}

function groupByRank(hand: readonly Card[]): RankGroup[] {
  const map = new Map<number, Card[]>();
  for (const card of hand) {
    const bucket = map.get(card.rank);
    if (bucket) bucket.push(card);
    else map.set(card.rank, [card]);
  }
  return [...map.entries()]
    .map(([rank, cards]) => ({ rank, cards }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * 枚举可出的牌型。
 *
 * 不求穷尽——飞机带牌只取「主体 + 最小的带牌」这一种配法，四带二整个没做。
 * 陪练少几种打法只是打得笨；漏掉的那些人类可以出，机器人压不过就过牌，
 * 不会卡住。每个候选最后都由 `identifyPattern` 复核，凑错了的直接丢掉。
 */
export function enumeratePlays(hand: readonly Card[]): Pattern[] {
  const groups = groupByRank(hand);
  const out: Card[][] = [];

  for (const group of groups) {
    out.push(group.cards.slice(0, 1));
    if (group.cards.length >= 2) out.push(group.cards.slice(0, 2));
    if (group.cards.length >= 3) {
      const body = group.cards.slice(0, 3);
      out.push(body);
      const single = pickWings(groups, [group.rank], 1, 1);
      if (single) out.push([...body, ...single]);
      const pair = pickWings(groups, [group.rank], 1, 2);
      if (pair) out.push([...body, ...pair]);
    }
    if (group.cards.length === 4) out.push(group.cards.slice(0, 4));
  }

  const jokers = hand.filter((card) => card.rank >= RANK_JOKER_SMALL);
  if (jokers.length === 2) out.push(jokers);

  // 顺子：≥5 张连续单牌
  for (const window of windows(straightRanks(groups, 1), 5, 12)) {
    out.push(window.flatMap((rank) => cardsOf(groups, rank, 1)));
  }
  // 连对：≥3 组连续对子
  for (const window of windows(straightRanks(groups, 2), 3, 10)) {
    out.push(window.flatMap((rank) => cardsOf(groups, rank, 2)));
  }
  // 飞机：≥2 组连续三张，另加带单/带对
  for (const window of windows(straightRanks(groups, 3), 2, 6)) {
    const body = window.flatMap((rank) => cardsOf(groups, rank, 3));
    out.push(body);
    const singles = pickWings(groups, window, window.length, 1);
    if (singles) out.push([...body, ...singles]);
    const pairs = pickWings(groups, window, window.length, 2);
    if (pairs) out.push([...body, ...pairs]);
  }

  const patterns: Pattern[] = [];
  for (const cards of out) {
    const pattern = identifyPattern(cards);
    if (pattern !== null) patterns.push(pattern);
  }
  return patterns;
}

/** 某个点数取前 n 张。 */
function cardsOf(
  groups: readonly RankGroup[],
  rank: number,
  n: number,
): Card[] {
  const group = groups.find((g) => g.rank === rank);
  return group ? group.cards.slice(0, n) : [];
}

/** 能进顺子类牌型的点数：张数够，且不超过 A（2 和双王不接龙）。 */
function straightRanks(groups: readonly RankGroup[], need: number): number[] {
  return groups
    .filter((g) => g.cards.length >= need && g.rank <= RANK_STRAIGHT_MAX)
    .map((g) => g.rank);
}

/** 升序点数里所有长度在 [min, max] 的连续窗口。 */
function windows(
  ranks: readonly number[],
  min: number,
  max: number,
): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < ranks.length; start += 1) {
    for (let len = min; start + len <= ranks.length && len <= max; len += 1) {
      const window = ranks.slice(start, start + len);
      let consecutive = true;
      for (let i = 1; i < window.length; i += 1) {
        if (window[i] !== window[i - 1] + 1) consecutive = false;
      }
      // 这个起点已经断开，窗口再长也接不上
      if (!consecutive) break;
      out.push(window);
    }
  }
  return out;
}

/**
 * 挑带牌。
 *
 * 三条回避规则，前两条是规则要求、第三条是打法：
 * - 不动四张同点的：那是炸弹，拆了当带牌等于白送
 * - 不动王：王是最后的压制手段，当带牌扔掉是纯亏
 * - 优先拆零散的牌：能带单张就不拆对子
 *
 * @param exclude 主体占用的点数
 * @param need 需要几份
 * @param per 每份几张（1 = 带单，2 = 带对）
 */
function pickWings(
  groups: readonly RankGroup[],
  exclude: readonly number[],
  need: number,
  per: 1 | 2,
): Card[] | null {
  const banned = new Set(exclude);
  const usable = groups
    .filter(
      (g) =>
        !banned.has(g.rank) &&
        g.cards.length >= per &&
        g.cards.length < 4 &&
        g.rank < RANK_JOKER_SMALL,
    )
    .sort((a, b) => a.cards.length - b.cards.length || a.rank - b.rank);

  if (usable.length < need) return null;
  return usable.slice(0, need).flatMap((g) => g.cards.slice(0, per));
}
