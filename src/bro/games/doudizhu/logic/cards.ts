/**
 * 斗地主：牌的表示、牌序与发牌。
 *
 * 两条约束贯穿本文件：
 *
 * 1. **零随机源。** 这里没有 `Math.random`，也没有 `Date.now`。服务端是权威、
 *    客户端只做预测（见 core/types.ts 约束 2），两边必须从同一份输入算出
 *    完全相同的结果；只要有一处偷偷取了本地随机数或本地时钟，预测就会和
 *    权威状态分叉，而且是那种只在特定牌局复现的分叉。洗牌要么由外部传入
 *    洗好的牌序，要么传入种子走这里的确定性 PRNG。
 *
 * 2. **牌力即整数。** rank 直接编码成可比较的整数（3→3 … A→14、2→15、
 *    小王→16、大王→17），比大小时不查表也不排序映射。花色只用来区分同点
 *    的四张牌，任何比较逻辑都不得读它——斗地主里花色无大小，一旦有代码
 *    读了花色，就等于引入了一条不存在的规则。
 */

/** 花色。只用于区分同点的四张牌，不参与任何大小比较。 */
export type Suit = "S" | "H" | "C" | "D";

/**
 * 牌的唯一标识。
 *
 * 一副牌内 54 个 id 互不相同，因此「从手牌里移除这几张」可以按 id 精确匹配，
 * 不必按点数猜是哪张——按点数移除会在手上有多张同点牌时移错张，进而让
 * 服务端与客户端的手牌残留不一致。
 */
export type CardId = string;

export interface Card {
  readonly id: CardId;
  /** 牌力。数值越大越大，见文件头说明。 */
  readonly rank: number;
  /** 王没有花色。 */
  readonly suit: Suit | null;
}

/** 最小点数 3。 */
export const RANK_MIN = 3;

/** 2 的牌力在 A 之上，但它不参与任何顺子类牌型（顺子/连对/飞机）。 */
export const RANK_TWO = 15;

export const RANK_JOKER_SMALL = 16;
export const RANK_JOKER_BIG = 17;

/**
 * 顺子类牌型的点数上界：A（14）。
 *
 * 这个常量存在的唯一目的，是把「2 和双王不能进顺子」这条最容易写错的规则
 * 收敛到一处。写成 `rank <= RANK_STRAIGHT_MAX` 时，2（15）、小王（16）、
 * 大王（17）被同一个判断一起挡住，不会出现「挡了 2 忘了王」的半截实现。
 */
export const RANK_STRAIGHT_MAX = 14;

/** 花色的固定顺序。仅用于让发牌/排序结果确定，不表示大小。 */
export const SUITS: readonly Suit[] = ["S", "H", "C", "D"];

const SUIT_INDEX: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };

/** 点数 → 显示字符。10 用 "10"，小王 "x"，大王 "X"。 */
const RANK_TOKENS: Record<number, string> = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "2",
  16: "x",
  17: "X",
};

const RANK_BY_TOKEN: Record<string, number> = {
  ...Object.fromEntries(
    Object.entries(RANK_TOKENS).map(([rank, token]) => [token, Number(rank)]),
  ),
  // "10" 打起来碍事，允许 T 作为别名
  T: 10,
};

/** 是否为大小王。 */
export function isJoker(card: Card): boolean {
  return card.rank >= RANK_JOKER_SMALL;
}

/**
 * 生成一副 54 张的新牌，顺序固定。
 *
 * 顺序固定是刻意的：牌堆本身不带随机性，随机性只由 {@link shuffle} 的种子
 * 或外部传入的牌序引入，这样「同一局」在服务端和客户端可以完整复现。
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_TWO; rank += 1) {
      deck.push({ id: `${suit}${rank}`, rank, suit });
    }
  }
  deck.push({ id: "x", rank: RANK_JOKER_SMALL, suit: null });
  deck.push({ id: "X", rank: RANK_JOKER_BIG, suit: null });
  return deck;
}

/**
 * 牌序比较：先比牌力，同点按花色的固定顺序兜底。
 *
 * 花色兜底不是规则，只是为了让排序结果**唯一**——两端各自排序后得到的
 * 数组必须逐张相同，否则「同一手牌」的序列化结果会不一致。
 */
export function compareCards(a: Card, b: Card): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const sa = a.suit === null ? -1 : SUIT_INDEX[a.suit];
  const sb = b.suit === null ? -1 : SUIT_INDEX[b.suit];
  return sa - sb;
}

/** 按牌力升序排序，返回新数组（不修改入参）。 */
export function sortCards(cards: readonly Card[]): Card[] {
  return cards.slice().sort(compareCards);
}

/**
 * 确定性 PRNG（mulberry32）。
 *
 * 自带 PRNG 而不用 `Math.random`：同一个种子必须在服务端与客户端产出同一串
 * 数，`Math.random` 既不接受种子也不保证跨实现一致。
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 用给定种子洗牌（Fisher-Yates），纯函数。
 *
 * 同种子同输入必然得到同结果，因此服务端只需下发种子，客户端就能算出
 * 一模一样的牌序。若上游已经有洗好的牌序，可以跳过本函数直接调
 * {@link deal}。
 *
 * @param cards 待洗的牌（不修改）
 * @param seed 32 位整数种子，由外部提供
 */
export function shuffle(cards: readonly Card[], seed: number): Card[] {
  const out = cards.slice();
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 发牌结果：三家手牌 + 三张底牌。 */
export interface Deal {
  hands: [Card[], Card[], Card[]];
  /** 底牌，归叫到地主的一家。 */
  bottom: Card[];
}

/** 每家起手牌数。 */
export const HAND_SIZE = 17;
/** 底牌张数。 */
export const BOTTOM_SIZE = 3;
/** 一副牌的张数。 */
export const DECK_SIZE = HAND_SIZE * 3 + BOTTOM_SIZE;

/**
 * 发牌。**只接受已经洗好的牌序**，内部不做任何随机。
 *
 * 实盘是三家轮流摸牌，这里按顺序切分 17/17/17 + 末尾 3 张底牌。在牌序已经
 * 随机的前提下两者分布等价，选切分是因为它在两端更难写错——轮流摸牌的
 * 索引步进只要有一边写反，两端手牌就会整体错位。
 *
 * @param deck 洗好的 54 张牌
 * @throws 张数不是 54 时抛错。这是调用方的编程错误，静默容忍会让问题
 *         延后到对局中途才暴露。
 */
export function deal(deck: readonly Card[]): Deal {
  if (deck.length !== DECK_SIZE) {
    throw new Error(`deal 需要 ${DECK_SIZE} 张牌，实际 ${deck.length} 张`);
  }
  return {
    hands: [
      sortCards(deck.slice(0, HAND_SIZE)),
      sortCards(deck.slice(HAND_SIZE, HAND_SIZE * 2)),
      sortCards(deck.slice(HAND_SIZE * 2, HAND_SIZE * 3)),
    ],
    bottom: sortCards(deck.slice(HAND_SIZE * 3)),
  };
}

/** 统计每个 id 的张数。手牌里 id 本应唯一，用计数是为了容忍脏输入。 */
function countById(cards: readonly Card[]): Map<CardId, number> {
  const counts = new Map<CardId, number>();
  for (const card of cards) {
    counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  }
  return counts;
}

/** 手牌是否完整包含这些牌（按 id 的多重集合判断）。 */
export function containsAll(
  hand: readonly Card[],
  cards: readonly Card[],
): boolean {
  return removeCards(hand, cards) !== null;
}

/**
 * 从手牌中移除指定的牌，返回剩余手牌；牌不在手上则返回 `null`。
 *
 * 按 id 而非点数匹配，且同一张牌重复出现会被判为非法——「出两张一样的黑桃 3」
 * 是最典型的客户端伪造手法，按点数匹配的实现挡不住它。
 */
export function removeCards(
  hand: readonly Card[],
  cards: readonly Card[],
): Card[] | null {
  const counts = countById(hand);
  for (const card of cards) {
    const left = counts.get(card.id) ?? 0;
    if (left === 0) return null;
    counts.set(card.id, left - 1);
  }
  const rest: Card[] = [];
  const used = countById(cards);
  for (const card of hand) {
    const drop = used.get(card.id) ?? 0;
    if (drop > 0) {
      used.set(card.id, drop - 1);
      continue;
    }
    rest.push(card);
  }
  return rest;
}

/**
 * 从紧凑记法解析出牌组，便于测试与对局回放。
 *
 * 记法：点数以空格分隔，`3`–`10`（`T` 为 10 的别名）、`J`/`Q`/`K`/`A`/`2`，
 * `x` 小王、`X` 大王。同点重复出现时按 {@link SUITS} 顺序依次分配花色——
 * 因为花色不影响大小，分配哪张都不改变牌型判定。
 *
 * @throws 记法非法、或同一点数超过 4 张时抛错
 */
export function parseCards(notation: string): Card[] {
  const tokens = notation.trim().split(/\s+/).filter(Boolean);
  const used = new Map<number, number>();
  return tokens.map((token) => {
    const rank = RANK_BY_TOKEN[token];
    if (rank === undefined) throw new Error(`无法识别的牌: ${token}`);
    if (rank >= RANK_JOKER_SMALL) {
      const seen = (used.get(rank) ?? 0) + 1;
      if (seen > 1) throw new Error(`${token} 只有一张`);
      used.set(rank, seen);
      return {
        id: rank === RANK_JOKER_BIG ? "X" : "x",
        rank,
        suit: null,
      };
    }
    const index = used.get(rank) ?? 0;
    if (index >= SUITS.length) throw new Error(`${token} 最多四张`);
    used.set(rank, index + 1);
    const suit = SUITS[index];
    return { id: `${suit}${rank}`, rank, suit };
  });
}

/** 反向输出紧凑记法，用于日志与断言信息。 */
export function formatCards(cards: readonly Card[]): string {
  return cards.map((card) => RANK_TOKENS[card.rank]).join(" ");
}
