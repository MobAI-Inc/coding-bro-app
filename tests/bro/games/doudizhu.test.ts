/**
 * 斗地主规则引擎测试。
 *
 * 组织方式：每种牌型都有正例与反例，反例优先覆盖那些「实现漏一个判断也能
 * 跑通大部分对局」的坑——2 进顺子、顺子长度下限、连对对数下限、飞机带牌
 * 数量、四带二压炸弹、不同长度顺子互相比较。这些用例存在的意义是：一旦
 * 有人把对应判断删掉，必须有测试变红。
 *
 * 所有输入都用 `parseCards` 的紧凑记法书写（`x` 小王、`X` 大王），
 * 花色由它按固定顺序分配——花色不影响任何判定，写出来只会碍眼。
 */

import { describe, expect, it } from "vitest";
import type { Card, Pattern } from "@/bro/games/doudizhu/logic";
import {
  DECK_SIZE,
  RANK_JOKER_BIG,
  RANK_JOKER_SMALL,
  addBottomCards,
  canBeat,
  canPass,
  checkPlay,
  compareCards,
  containsAll,
  createDeck,
  deal,
  detectSpring,
  finalScores,
  formatCards,
  identifyPattern,
  isComparable,
  isJoker,
  isValidBid,
  parseCards,
  removeCards,
  resolveBidding,
  scoreMultiplier,
  settle,
  shuffle,
  sideOf,
  sortCards,
} from "@/bro/games/doudizhu/logic";

const p = parseCards;

/** 牌型类型，非法牌型为 null。 */
function typeOf(notation: string): string | null {
  return identifyPattern(p(notation))?.type ?? null;
}

/** 断言是合法牌型并取出。 */
function pat(notation: string): Pattern {
  const found = identifyPattern(p(notation));
  if (found === null) throw new Error(`期望是合法牌型: ${notation}`);
  return found;
}

/** `a` 能否压过 `b`。 */
function beats(a: string, b: string): boolean {
  return canBeat(pat(a), pat(b));
}

/**
 * 牌力是否非降序。
 *
 * 刻意不写成 `expect(hand).toEqual(sortCards(hand))`：那样是拿被测实现自己
 * 当期望值，`compareCards` 若整个反了，两边会一起反、断言照样通过。
 */
function isAscending(cards: readonly Card[]): boolean {
  return cards.every((card, i) => i === 0 || cards[i - 1].rank <= card.rank);
}

describe("牌与牌序", () => {
  it("一副牌 54 张，id 互不相同", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map((c) => c.id)).size).toBe(DECK_SIZE);
  });

  it("3 到 2 各四张，大小王各一张", () => {
    const counts = new Map<number, number>();
    for (const card of createDeck()) {
      counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    }
    for (let rank = 3; rank <= 15; rank += 1) {
      expect(counts.get(rank)).toBe(4);
    }
    expect(counts.get(RANK_JOKER_SMALL)).toBe(1);
    expect(counts.get(RANK_JOKER_BIG)).toBe(1);
  });

  it("牌力顺序：3 < … < A < 2 < 小王 < 大王", () => {
    const ordered = p("3 4 5 6 7 8 9 10 J Q K A 2 x X");
    const sorted = sortCards([...ordered].reverse());
    expect(formatCards(sorted)).toBe("3 4 5 6 7 8 9 10 J Q K A 2 x X");
  });

  it("2 比 A 大，但这不代表它能接在 A 后面组顺子", () => {
    // 牌力与「可否连牌」是两回事，混为一谈就会写出 JQKA2 顺子
    expect(compareCards(p("2")[0], p("A")[0])).toBeGreaterThan(0);
    expect(typeOf("10 J Q K A")).toBe("straight");
    expect(typeOf("J Q K A 2")).toBeNull();
  });

  it("花色不影响大小 — 同点两张互不相压", () => {
    const [spade4, heart4] = p("4 4");
    expect(spade4.suit).not.toBe(heart4.suit);
    expect(compareCards(spade4, heart4)).not.toBe(0);
    // 但排序用的花色兜底不得渗进牌力比较
    expect(canBeat(single(spade4), single(heart4))).toBe(false);
    expect(canBeat(single(heart4), single(spade4))).toBe(false);
  });

  it("紧凑记法可往返，且同点自动换花色", () => {
    const cards = p("3 3 3 3 x X");
    expect(new Set(cards.map((c) => c.id)).size).toBe(6);
    expect(formatCards(cards)).toBe("3 3 3 3 x X");
    expect(p("10 J")).toEqual(p("T J"));
  });

  it("同点超过四张或未知记法直接报错", () => {
    expect(() => p("3 3 3 3 3")).toThrow();
    expect(() => p("x x")).toThrow();
    expect(() => p("1")).toThrow();
  });

  it("sortCards 返回新数组，不动入参", () => {
    // 同一份手牌数组会被渲染、结算、出牌校验轮流拿去用。sortCards 一旦
    // 原地排序，其它持有者手里的顺序就被悄悄改了，而且只在「入参恰好
    // 无序」时才暴露——上面那条「发到手的牌已排好序」永远碰不到这个坑
    const hand = p("5 3 4");
    const before = hand.map((c) => c.id);
    const sorted = sortCards(hand);
    expect(sorted).not.toBe(hand);
    expect(hand.map((c) => c.id)).toEqual(before);
    expect(formatCards(sorted)).toBe("3 4 5");
  });

  it("isJoker 认两张王，2 和 A 都不是", () => {
    // 2 的牌力（15）紧挨着小王（16），边界只差 1。判断写成
    // `>= RANK_JOKER_BIG`（漏掉小王）或 `>= RANK_TWO`（把 2 当王）都能
    // 跑通一堆调用，只有把边界两侧一起断言才钉得住
    const [small, big, two, ace] = p("x X 2 A");
    expect(isJoker(small)).toBe(true);
    expect(isJoker(big)).toBe(true);
    expect(isJoker(two)).toBe(false);
    expect(isJoker(ace)).toBe(false);
  });
});

function single(card: Card): Pattern {
  const found = identifyPattern([card]);
  if (found === null) throw new Error("单张必然合法");
  return found;
}

describe("洗牌与发牌 — 必须可复现", () => {
  it("同种子同结果，不同种子不同结果", () => {
    const deck = createDeck();
    expect(shuffle(deck, 42).map((c) => c.id)).toEqual(
      shuffle(deck, 42).map((c) => c.id),
    );
    expect(shuffle(deck, 42).map((c) => c.id)).not.toEqual(
      shuffle(deck, 43).map((c) => c.id),
    );
  });

  it("洗牌确实改变了牌序，且牌序本身被钉死", () => {
    // 「同种子同结果」对一个原样返回、什么都不洗的 shuffle 也成立，
    // 光靠它挡不住「循环边界写错，只洗了后半段」这类改动。这里直接钉死
    // 具体牌序：服务端只下发种子、客户端自己算牌序，PRNG 或 Fisher-Yates
    // 的任何改动都会让两端分叉，必须在这里就变红
    const deck = createDeck();
    const shuffled = shuffle(deck, 42);
    expect(shuffled.map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
    expect(shuffled.slice(0, 8).map((c) => c.id)).toEqual([
      "D6",
      "S14",
      "D4",
      "H10",
      "C4",
      "C13",
      "C10",
      "x",
    ]);
  });

  it("洗牌是排列，且不修改入参", () => {
    const deck = createDeck();
    const before = deck.map((c) => c.id);
    const shuffled = shuffle(deck, 7);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(before));
    expect(deck.map((c) => c.id)).toEqual(before);
  });

  it("发 17/17/17 + 3 张底牌，一张不多一张不少", () => {
    const { hands, bottom } = deal(shuffle(createDeck(), 2024));
    expect(hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(bottom).toHaveLength(3);
    const all = [...hands.flat(), ...bottom].map((c) => c.id);
    expect(new Set(all).size).toBe(DECK_SIZE);
  });

  it("同一牌序发出同一副牌 — 服务端与客户端据此对齐", () => {
    const deck = shuffle(createDeck(), 99);
    // 注意：对纯函数而言这条几乎恒真，它只挡得住「实现里偷偷取了随机数
    // 或时钟」。真正约束切分位置的是下面那条底牌来源的断言
    expect(deal(deck)).toEqual(deal(deck));
  });

  it("底牌取的是牌序末尾三张，不是开头三张", () => {
    // 底牌从哪一段切，决定了三家手牌各是哪 17 张。切错方向时张数、去重
    // 都还对得上，只有对着牌序本身比才发现得了
    const deck = shuffle(createDeck(), 77);
    const { bottom } = deal(deck);
    expect(bottom.map((c) => c.id).sort()).toEqual(
      deck
        .slice(-3)
        .map((c) => c.id)
        .sort(),
    );
  });

  it("张数不对直接报错，而不是发出半副牌", () => {
    expect(() => deal(createDeck().slice(0, 53))).toThrow();
  });

  it("发到手的牌已排好序", () => {
    const { hands, bottom } = deal(shuffle(createDeck(), 5));
    for (const hand of hands) {
      expect(isAscending(hand)).toBe(true);
    }
    expect(isAscending(bottom)).toBe(true);
  });
});

describe("手牌增删", () => {
  it("按 id 精确移除，不按点数猜", () => {
    const hand = p("3 3 4");
    const rest = removeCards(hand, [hand[0]]);
    expect(formatCards(rest ?? [])).toBe("3 4");
    expect(rest?.[0].id).toBe(hand[1].id);
  });

  it("牌不在手上返回 null", () => {
    expect(removeCards(p("3 4"), p("5"))).toBeNull();
    expect(containsAll(p("3 4"), p("5"))).toBe(false);
  });

  it("同一张牌重复提交视为非法 — 典型的客户端伪造", () => {
    const hand = p("3 4");
    expect(removeCards(hand, [hand[0], hand[0]])).toBeNull();
  });

  it("牌确实在手上时 containsAll 返回 true", () => {
    // 只写反例的话，`containsAll` 恒返回 false 也能全绿——出牌校验就再也
    // 放不出任何一手牌，而测试一声不吭
    expect(containsAll(p("3 4 5"), p("3 5"))).toBe(true);
    const hand = p("3 3 4");
    expect(containsAll(hand, [hand[0], hand[1]])).toBe(true);
    // 手上只有两张 3，要三张就不够 — 按多重集合而不是按「有没有」判断
    expect(containsAll(hand, [hand[0], hand[1], hand[0]])).toBe(false);
  });
});

describe("牌型 — 单张、对子、三张、三带", () => {
  it("单张 / 对子 / 三张", () => {
    expect(typeOf("3")).toBe("single");
    expect(typeOf("3 3")).toBe("pair");
    expect(typeOf("3 3 3")).toBe("triple");
  });

  it("两张不同点不是对子；大小王是王炸不是对子", () => {
    expect(typeOf("3 4")).toBeNull();
    expect(typeOf("x X")).toBe("rocket");
  });

  it("三带一，带牌可以是任意单牌（含王）", () => {
    expect(typeOf("3 3 3 4")).toBe("triple_with_single");
    expect(typeOf("3 3 3 X")).toBe("triple_with_single");
  });

  it("三带一的大小看三张，不看带牌", () => {
    expect(pat("3 3 3 K").rank).toBe(3);
    expect(beats("4 4 4 3", "3 3 3 K")).toBe(true);
    expect(beats("3 3 3 K", "4 4 4 3")).toBe(false);
  });

  it("三带二带的必须是一对", () => {
    expect(typeOf("3 3 3 4 4")).toBe("triple_with_pair");
    expect(typeOf("3 3 3 4 5")).toBeNull();
  });

  it("四张同点加一张不是三带一", () => {
    expect(typeOf("3 3 3 3 4")).toBeNull();
  });
});

describe("牌型 — 顺子", () => {
  it("五张起连续单牌", () => {
    expect(typeOf("3 4 5 6 7")).toBe("straight");
    expect(pat("3 4 5 6 7").length).toBe(5);
    expect(typeOf("10 J Q K A")).toBe("straight");
    expect(typeOf("3 4 5 6 7 8 9 10 J Q K A")).toBe("straight");
  });

  it("三张、四张的连牌都不是顺子 — 顺子至少 5 张", () => {
    expect(typeOf("3 4 5")).toBeNull();
    expect(typeOf("3 4 5 6")).toBeNull();
  });

  it("JQKA2 不是顺子 — 2 牌力最大但不接龙", () => {
    expect(typeOf("J Q K A 2")).toBeNull();
    expect(typeOf("10 J Q K A 2")).toBeNull();
  });

  it("A2345 不是顺子 — A 也不能当 1 用", () => {
    expect(typeOf("A 2 3 4 5")).toBeNull();
    expect(typeOf("2 3 4 5 6")).toBeNull();
  });

  it("王不进顺子", () => {
    expect(typeOf("J Q K A x")).toBeNull();
    expect(typeOf("Q K A x X")).toBeNull();
  });

  it("断点或含重复点数都不是顺子", () => {
    expect(typeOf("3 4 5 6 8")).toBeNull();
    expect(typeOf("3 3 4 5 6 7")).toBeNull();
  });

  it("顺子的大小基准是起始点，不是最大点", () => {
    // 同长度顺子比起始点还是比最大点，结论完全一样（两者差值恒定），
    // 所以「同长度顺子比起始点」那条比较用例钉不住这个字段。而 rank 是
    // 对外的公开字段，日志、UI 提示、复盘都读它，写成最大点就会误导
    expect(pat("3 4 5 6 7").rank).toBe(3);
    expect(pat("10 J Q K A").rank).toBe(10);
  });
});

describe("牌型 — 连对", () => {
  it("三对起连续对子", () => {
    expect(typeOf("3 3 4 4 5 5")).toBe("straight_pair");
    expect(pat("3 3 4 4 5 5").length).toBe(3);
    expect(typeOf("3 3 4 4 5 5 6 6")).toBe("straight_pair");
  });

  it("两对不是连对 — 连对至少 3 对", () => {
    expect(typeOf("3 3 4 4")).toBeNull();
  });

  it("2 不进连对", () => {
    expect(typeOf("K K A A 2 2")).toBeNull();
    expect(typeOf("Q Q K K A A")).toBe("straight_pair");
  });

  it("不连续、落单、王都不成连对", () => {
    expect(typeOf("3 3 4 4 6 6")).toBeNull();
    expect(typeOf("3 3 4 4 5 5 6")).toBeNull();
    expect(typeOf("A A x X")).toBeNull();
  });

  it("连对按起始点比大小，同长度才可比", () => {
    // 连对此前只有「不同长度不可比」的反例，同长度的正例一条也没有：
    // canBeat 最后那句点数比较对连对来说是完全没被走到的
    expect(pat("3 3 4 4 5 5").rank).toBe(3);
    expect(beats("4 4 5 5 6 6", "3 3 4 4 5 5")).toBe(true);
    expect(beats("3 3 4 4 5 5", "4 4 5 5 6 6")).toBe(false);
  });
});

describe("牌型 — 飞机", () => {
  it("两组起连续三张，可以不带牌", () => {
    expect(typeOf("3 3 3 4 4 4")).toBe("plane");
    expect(pat("3 3 3 4 4 4").length).toBe(2);
    expect(typeOf("3 3 3 4 4 4 5 5 5")).toBe("plane");
  });

  it("单组三张不是飞机 — 飞机至少 2 组", () => {
    expect(typeOf("3 3 3")).toBe("triple");
  });

  it("2 和王不进飞机", () => {
    expect(typeOf("A A A 2 2 2")).toBeNull();
    expect(typeOf("K K K A A A")).toBe("plane");
  });

  it("三张必须连续", () => {
    expect(typeOf("3 3 3 5 5 5")).toBeNull();
  });

  it("飞机带单：带牌数必须等于三张组数", () => {
    expect(typeOf("3 3 3 4 4 4 5 6")).toBe("plane_with_singles");
    // 两组三张只带 1 张 → 数量不匹配
    expect(typeOf("3 3 3 4 4 4 5")).toBeNull();
    // 两组三张带 3 张 → 同样不匹配
    expect(typeOf("3 3 3 4 4 4 5 6 7")).toBeNull();
    expect(typeOf("3 3 3 4 4 4 5 5 5 6 7 8")).toBe("plane_with_singles");
  });

  it("飞机带对：带的必须是完整的对子，且对数等于组数", () => {
    expect(typeOf("3 3 3 4 4 4 5 5 6 6")).toBe("plane_with_pairs");
    // 10 张里带的是「一对 + 两张散牌」，不成立
    expect(typeOf("3 3 3 4 4 4 5 5 6 7")).toBeNull();
    // 8 张：两组三张 + 两张 5。带单的判定在前，两张 5 被当作两张单牌，
    // 因此这是「飞机带两单」而不是「带一对」——数量本来也对不上带对
    expect(typeOf("3 3 3 4 4 4 5 5")).toBe("plane_with_singles");
  });

  it("带牌不得拆炸弹或王炸", () => {
    expect(typeOf("3 3 3 4 4 4 5 5 5 5")).toBeNull();
    expect(typeOf("3 3 3 4 4 4 x X")).toBeNull();
    // 16 张：四组连续三张 + 四张同点。带牌张数恰好对得上，唯一拦住它的
    // 就是「翅膀里不许有炸弹」——少了那条判断这手牌会变成合法飞机
    expect(typeOf("3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 7")).toBeNull();
    expect(typeOf("3 3 3 4 4 4 5 5 5 6 6 6 7 8 9 10")).toBe(
      "plane_with_singles",
    );
  });

  it("飞机的大小看三张主体的最小点", () => {
    expect(pat("3 3 3 4 4 4 5 6").rank).toBe(3);
    expect(beats("4 4 4 5 5 5 3 6", "3 3 3 4 4 4 K A")).toBe(true);
  });

  it("纯飞机按起始点比大小，同长度才可比", () => {
    // 纯飞机此前只有「不同长度不可比」的反例，同长度的正例是空白
    expect(pat("3 3 3 4 4 4").rank).toBe(3);
    expect(beats("4 4 4 5 5 5", "3 3 3 4 4 4")).toBe(true);
    expect(beats("3 3 3 4 4 4", "4 4 4 5 5 5")).toBe(false);
  });

  it("飞机带对同样按主体起始点比大小", () => {
    expect(beats("4 4 4 5 5 5 6 6 7 7", "3 3 3 4 4 4 6 6 7 7")).toBe(true);
    expect(beats("3 3 3 4 4 4 6 6 7 7", "4 4 4 5 5 5 6 6 7 7")).toBe(false);
  });

  it("四张同点当不了飞机主体 — 三个连号炸弹不是飞机", () => {
    // 12 张、点数连续、每点张数一致，形状上跟四组飞机只差「每点 3 张还是
    // 4 张」。把 `count === 3` 写成 `>= 3` 就会把三个炸弹放成一手飞机
    expect(typeOf("3 3 3 3 4 4 4 4 5 5 5 5")).toBeNull();
  });

  it("带牌的飞机同样不许 2 进主体", () => {
    // 纯飞机靠 isStraightBody 挡住 2，但飞机带牌走的是另一条路径
    // （bodyRanks 上的 `rank <= A` 过滤）。漏掉那半句，AAA222 带两张散牌
    // 就成了合法飞机，而「2 不接龙」是斗地主最常被写错的一条规则
    expect(typeOf("A A A 2 2 2 3 4")).toBeNull();
    expect(typeOf("A A A 2 2 2 3 3 4 4")).toBeNull();
    // 同样形状但主体不含 2，必须仍然合法 — 否则上面两条可能只是「全都挡了」
    expect(typeOf("K K K A A A 3 4")).toBe("plane_with_singles");
  });

  it("四组连续三张优先解析为纯飞机，而不是三组带三单", () => {
    // 12 张有多解：4 组纯飞机 / 3 组飞机带 3 张单牌。两端必须选同一个解，
    // 否则同一手牌在服务端是 plane(len 4)、在客户端是 plane_with_singles
    // (len 3)，rank 和 length 全对不上，客户端预测当场分叉
    const found = pat("3 3 3 4 4 4 5 5 5 6 6 6");
    expect(found.type).toBe("plane");
    expect(found.length).toBe(4);
  });
});

describe("牌型 — 四带二", () => {
  it("四带两单 / 四带两对", () => {
    expect(typeOf("3 3 3 3 4 5")).toBe("four_with_two_singles");
    expect(typeOf("3 3 3 3 4 4 5 5")).toBe("four_with_two_pairs");
  });

  it("带的两张单牌允许同点", () => {
    expect(typeOf("3 3 3 3 4 4")).toBe("four_with_two_singles");
  });

  it("两个炸弹凑不成四带两对", () => {
    expect(typeOf("3 3 3 3 4 4 4 4")).toBeNull();
  });

  it("带牌张数不对、或拆王炸都非法", () => {
    expect(typeOf("3 3 3 3 4 5 6")).toBeNull();
    expect(typeOf("3 3 3 3 4 4 5")).toBeNull();
    expect(typeOf("3 3 3 3 x X")).toBeNull();
  });

  it("大小看四张主体", () => {
    expect(pat("3 3 3 3 A A").rank).toBe(3);
    expect(beats("4 4 4 4 3 5", "3 3 3 3 A A")).toBe(true);
  });

  it("四带两对带的必须真是两个对子，散牌凑数不算", () => {
    // 八张、恰好一个四张，形状与四带两对一模一样，唯一的差别是带的牌
    // 拆不成两个对子。少了那条判断，这两手都会变成合法牌型
    expect(typeOf("3 3 3 3 4 4 5 6")).toBeNull();
    expect(typeOf("3 3 3 3 4 5 6 7")).toBeNull();
  });

  it("四带两对同型按四张主体比大小", () => {
    // 四带两对此前只有识别用例，一条比较用例都没有
    expect(beats("4 4 4 4 5 5 6 6", "3 3 3 3 5 5 6 6")).toBe(true);
    expect(beats("3 3 3 3 5 5 6 6", "4 4 4 4 5 5 6 6")).toBe(false);
  });
});

describe("牌型 — 炸弹与王炸", () => {
  it("四张同点是炸弹，双王是王炸", () => {
    expect(typeOf("3 3 3 3")).toBe("bomb");
    expect(typeOf("x X")).toBe("rocket");
  });

  it("炸弹之间比点数", () => {
    expect(beats("4 4 4 4", "3 3 3 3")).toBe(true);
    expect(beats("3 3 3 3", "4 4 4 4")).toBe(false);
  });

  it("炸弹压一切非炸弹牌型", () => {
    expect(beats("3 3 3 3", "A")).toBe(true);
    expect(beats("3 3 3 3", "10 J Q K A")).toBe(true);
    expect(beats("3 3 3 3", "A A A 2 2")).toBe(true);
  });

  it("四带二压不过炸弹 — 它张数更多、点数更大也不行", () => {
    expect(beats("A A A A 2 2", "3 3 3 3")).toBe(false);
    expect(beats("A A A A 2 2 K K", "3 3 3 3")).toBe(false);
  });

  it("非炸弹牌型一律压不过炸弹", () => {
    expect(beats("A A A 2 2", "3 3 3 3")).toBe(false);
    expect(beats("10 J Q K A", "3 3 3 3")).toBe(false);
  });

  it("王炸压一切，没有东西压王炸", () => {
    expect(beats("x X", "A A A A")).toBe(true);
    expect(beats("x X", "2")).toBe(true);
    expect(beats("A A A A", "x X")).toBe(false);
    expect(beats("2", "x X")).toBe(false);
  });

  it("同点炸弹互不相压，王炸也压不过王炸", () => {
    // 一副牌里同点只有四张、王只有两张，这两种对局面在牌桌上碰不到。
    // 但 canBeat 是对外的纯函数，`>` 写成 `>=` 正是从这里露头，
    // 而「炸弹之间比点数」的两条现有用例（4444 压 3333）拦不住它
    expect(beats("3 3 3 3", "3 3 3 3")).toBe(false);
    expect(beats("x X", "x X")).toBe(false);
  });
});

describe("大小比较 — 只有同牌型同长度才可比", () => {
  it("单张按牌力，2 大于 A，王更大", () => {
    expect(beats("4", "3")).toBe(true);
    expect(beats("2", "A")).toBe(true);
    expect(beats("x", "2")).toBe(true);
    expect(beats("X", "x")).toBe(true);
    expect(beats("3", "4")).toBe(false);
  });

  it("同长度顺子比起始点", () => {
    expect(beats("4 5 6 7 8", "3 4 5 6 7")).toBe(true);
    expect(beats("3 4 5 6 7", "4 5 6 7 8")).toBe(false);
  });

  it("不同长度的顺子不能互相比较 — 六张压不了五张", () => {
    expect(beats("4 5 6 7 8 9", "3 4 5 6 7")).toBe(false);
    expect(beats("3 4 5 6 7", "4 5 6 7 8 9")).toBe(false);
    expect(isComparable(pat("4 5 6 7 8 9"), pat("3 4 5 6 7"))).toBe(false);
  });

  it("不同长度的连对、飞机同样不可比", () => {
    expect(beats("4 4 5 5 6 6 7 7", "3 3 4 4 5 5")).toBe(false);
    expect(beats("4 4 4 5 5 5 6 6 6", "3 3 3 4 4 4")).toBe(false);
  });

  it("不同牌型不可比", () => {
    // 张数不同的两种牌型，靠张数也能挡住；下面这条是纯粹的类型检查：
    // 对子点数更大，但它压不了单张
    expect(beats("4 4", "3")).toBe(false);
    expect(beats("3 3", "4")).toBe(false);
    expect(beats("4 4 4 5", "3 3 3")).toBe(false);
    expect(beats("4 4 4 5 5", "3 3 3 5")).toBe(false);
    expect(isComparable(pat("4 4 4 5 5"), pat("3 3 3 5"))).toBe(false);
  });

  it("同牌型同长度但点数不大压不过", () => {
    expect(beats("3 3", "3 3")).toBe(false);
  });

  it("自由出牌时任何合法牌型都能出", () => {
    expect(canBeat(pat("3"), null)).toBe(true);
    expect(canBeat(pat("3 3 3 3 4 5"), null)).toBe(true);
  });

  it("每种牌型都有同型相压的正例 — 光有反例证明不了正例", () => {
    // 上面的用例大多是「不可比」的反例，它们只走到 canBeat 的类型/长度
    // 分支就返回了，最后那句 `rank >` 对多数牌型一次都没被执行过。
    // 每型补一条正例，主干才算真的被钉住
    expect(beats("4 4", "3 3")).toBe(true);
    expect(beats("4 4 4", "3 3 3")).toBe(true);
    expect(beats("4 4 4 5 5", "3 3 3 6 6")).toBe(true);
    // 反向必须为假，否则「恒返回 true」也能通过上面几条
    expect(beats("3 3", "4 4")).toBe(false);
    expect(beats("3 3 3", "4 4 4")).toBe(false);
    expect(beats("3 3 3 6 6", "4 4 4 5 5")).toBe(false);
  });

  it("炸弹和王炸与任何牌型都「可比」 — 该提示大小不够，不是牌型不符", () => {
    // isComparable 只被反例用过，涉及炸弹的那一整条分支没有任何断言。
    // 写成 `&&` 时它会告诉 UI「牌型不符」，玩家看到的提示就完全错了
    expect(isComparable(pat("3 3 3 3"), pat("4 5 6 7 8"))).toBe(true);
    expect(isComparable(pat("4 5 6 7 8"), pat("3 3 3 3"))).toBe(true);
    expect(isComparable(pat("x X"), pat("4 4"))).toBe(true);
    expect(isComparable(pat("4 4"), pat("x X"))).toBe(true);
  });

  it("Pattern.size 是总张数，length 是主体长度 — 两者不是一回事", () => {
    // 单张、对子上 size 和 length 恰好都说得通，只有顺子类和带牌牌型
    // 能把它们区分开；不断言 size，把它填成 length 也没人发现
    expect(pat("3 4 5 6 7").size).toBe(5);
    expect(pat("3 3 4 4 5 5").size).toBe(6);
    expect(pat("3 3 4 4 5 5").length).toBe(3);
    expect(pat("3 3 3 4 4 4 5 5 6 6").size).toBe(10);
    expect(pat("3 3 3 4 4 4 5 5 6 6").length).toBe(2);
    expect(pat("3 3 3 3 4 4 5 5").size).toBe(8);
    expect(pat("3 3 3 3 4 4 5 5").length).toBe(1);
  });
});

describe("叫地主", () => {
  it("必须严格高于当前最高分，不叫总是允许", () => {
    expect(isValidBid([], 1)).toBe(true);
    expect(isValidBid([], 0)).toBe(true);
    expect(isValidBid([1], 2)).toBe(true);
    expect(isValidBid([1], 1)).toBe(false);
    expect(isValidBid([2], 1)).toBe(false);
    expect(isValidBid([2], 0)).toBe(true);
  });

  it("已有人叫 3 分或已叫满一圈就不能再叫", () => {
    expect(isValidBid([0, 3], 0)).toBe(false);
    expect(isValidBid([1, 0, 2], 3)).toBe(false);
  });

  it("没叫完就继续，按座位轮转", () => {
    expect(resolveBidding(0, [])).toEqual({ status: "bidding", nextSeat: 0 });
    expect(resolveBidding(1, [0])).toEqual({ status: "bidding", nextSeat: 2 });
    expect(resolveBidding(2, [0, 1])).toEqual({
      status: "bidding",
      nextSeat: 1,
    });
  });

  it("3 分封顶，立刻定地主，后面的人不必再叫", () => {
    expect(resolveBidding(0, [0, 3])).toEqual({
      status: "settled",
      landlord: 1,
      bid: 3,
    });
    expect(resolveBidding(2, [0, 3])).toEqual({
      status: "settled",
      landlord: 0,
      bid: 3,
    });
  });

  it("叫满一圈由最高分者当地主", () => {
    expect(resolveBidding(0, [1, 0, 2])).toEqual({
      status: "settled",
      landlord: 2,
      bid: 2,
    });
  });

  it("三家都不叫则重新发牌", () => {
    expect(resolveBidding(0, [0, 0, 0])).toEqual({ status: "redeal" });
  });

  it("地主收底牌后手牌 20 张且有序", () => {
    const { hands, bottom } = deal(shuffle(createDeck(), 11));
    const landlordHand = addBottomCards(hands[0], bottom);
    expect(landlordHand).toHaveLength(20);
    expect(isAscending(landlordHand)).toBe(true);
    expect(hands[0]).toHaveLength(17);
  });
});

describe("出牌合法性", () => {
  const hand = p("3 3 3 4 5 6 7 8");

  it("合法出牌返回牌型与剩余手牌", () => {
    const result = checkPlay(hand, p("4 5 6 7 8"), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pattern.type).toBe("straight");
    expect(formatCards(result.rest)).toBe("3 3 3");
  });

  it("一张不出应当过牌，不是出空牌", () => {
    expect(checkPlay(hand, [], null)).toEqual({ ok: false, reason: "empty" });
  });

  it("牌不在手上先于牌型判定 — 否则伪造的牌会被当成牌型问题", () => {
    // 关键是这手牌「既不在手上、也凑不成牌型」：若用 AAAA 这种本身就是
    // 合法炸弹的牌，两种判定顺序都会返回 not_in_hand，测试等于没写
    expect(checkPlay(p("3 4"), p("A K"), null)).toEqual({
      ok: false,
      reason: "not_in_hand",
    });
    // 伪造一手本身合法的牌型，同样先被手牌校验挡下
    const fake = checkPlay(p("3 4"), p("A A A A"), null);
    expect(fake).toEqual({ ok: false, reason: "not_in_hand" });
  });

  it("凑不成牌型", () => {
    expect(checkPlay(hand, p("3 4"), null)).toEqual({
      ok: false,
      reason: "unknown_pattern",
    });
  });

  it("压不过上家", () => {
    const result = checkPlay(hand, p("4 5 6 7 8"), pat("5 6 7 8 9"));
    expect(result).toEqual({ ok: false, reason: "cannot_beat" });
  });

  it("自由出牌时不能过牌，否则一轮会无限等待", () => {
    expect(canPass(null)).toBe(false);
    expect(canPass(pat("3"))).toBe(true);
  });
});

describe("胜负与结算", () => {
  it("没人出完则对局继续", () => {
    expect(settle([p("3"), p("4"), p("5")], 0)).toBeNull();
  });

  it("地主出完，地主赢", () => {
    expect(settle([[], p("4"), p("5")], 0)).toEqual({
      winnerSeat: 0,
      winnerSide: "landlord",
      winners: [0],
    });
  });

  it("任一农民出完，两个农民一起赢", () => {
    // 座位 2 手上还有牌，但他和先走的队友同为赢家
    expect(settle([p("3"), [], p("5")], 0)).toEqual({
      winnerSeat: 1,
      winnerSide: "farmer",
      winners: [1, 2],
    });
  });

  it("阵营划分", () => {
    expect(sideOf(1, 1)).toBe("landlord");
    expect(sideOf(0, 1)).toBe("farmer");
  });

  it("春天：地主赢且农民一手未出", () => {
    expect(detectSpring([5, 0, 0], 0, "landlord")).toBe("landlord");
    expect(detectSpring([5, 1, 0], 0, "landlord")).toBe("none");
  });

  it("反春：农民赢且地主只出过领出的那一手", () => {
    expect(detectSpring([1, 4, 3], 0, "farmer")).toBe("farmer");
    expect(detectSpring([2, 4, 3], 0, "farmer")).toBe("none");
  });

  it("倍数 = 叫分 × 2^(炸弹 + 王炸) × 春天", () => {
    expect(
      scoreMultiplier({ bid: 2, bombs: 0, rocket: false, spring: "none" }),
    ).toBe(2);
    expect(
      scoreMultiplier({ bid: 1, bombs: 2, rocket: true, spring: "none" }),
    ).toBe(8);
    expect(
      scoreMultiplier({ bid: 3, bombs: 0, rocket: false, spring: "landlord" }),
    ).toBe(6);
  });

  it("结算零和，地主一人吃两家", () => {
    const outcome = settle([[], p("4"), p("5")], 0);
    expect(outcome).not.toBeNull();
    const scores = finalScores(outcome!, 0, {
      bid: 2,
      bombs: 1,
      rocket: false,
      spring: "none",
    });
    expect(scores).toEqual([8, -4, -4]);
    expect(scores.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("农民赢时地主赔两份", () => {
    const outcome = settle([p("3"), [], p("5")], 0);
    const scores = finalScores(outcome!, 0, {
      bid: 1,
      bombs: 0,
      rocket: false,
      spring: "farmer",
    });
    expect(scores).toEqual([-4, 2, 2]);
  });
});

/**
 * 变异测试留下的空白 —— 这些地方本文件覆盖不到，不要以为测到了。
 *
 * 下面每一条都是变异测试里存活下来的变异体，且经穷举比对（所有 ≤12 张的
 * 手牌形状共 7542 种可识别牌型，外加 210 个代表牌型两两求 canBeat）确认
 * **行为完全等价**——不是测试有洞，是改坏了也没有任何可观察差别。补测试
 * 补不出来，只能记在这里。
 *
 * 每条同时标注了「多点变异」的结果：把遮蔽它的那处判断也一并改坏之后，
 * 行为是否出现差异。出现差异说明这条判断本身有语义、只是被前面的判断挡在
 * 前面（属于防御性冗余，将来重排匹配顺序时会立刻变成必需品）；没有差异
 * 说明它在任何输入下都不起作用。
 *
 * patterns.ts
 * - `matchStraightPair` 的 `size % 2 !== 0`：被 `every(count === 2)` 蕴含
 *   （每点两张 ⇒ 总数必为偶数）。多点变异下有 384 处差异。
 * - `matchPlane` 的 `size % 3 !== 0`：同理被 `every(count === 3)` 蕴含。
 *   多点变异下有 97 处差异。
 * - `matchPlane` 的 `size < 6`：单组三张会被更靠前的 `matchSimple` 解析成
 *   triple，永远走不到这里。多点变异下有 12 处差异。
 * - `matchPlaneWithWings` 里 `planes` 从 2 起步：1 组三张 + 带牌的全部形状
 *   （4 张、5 张）都被更靠前的 `matchTripleWithWing` 截住。312 处差异。
 * - `matchPlaneWithWings` 的 `if (!isConsecutive(window)) break;` 改成
 *   `continue`：窗口是前缀包含关系，断了之后再长也接不上，两者等价。
 * - `matchTripleWithWing` 里 `body` 取 `count === 3` 改成 `count >= 3`：
 *   四张同点 + 总数 4 张就是炸弹，已被更靠前的 `matchBomb` 截住；总数 5 张
 *   时剩下的单张过不了「必须是一对」那关。13 处差异。
 * - `matchTripleWithWing` 结尾的 `wings[0].count === 2`：5 张牌里主体占 3 张，
 *   唯一的翅膀组必然正好 2 张，判断恒真。89 处差异。
 * - `matchFourWithTwo` 的 `quads.length !== 1`：第二个四张会先被
 *   `wingsAreLegal`（翅膀不许含炸弹）挡掉。
 * - `matchFourWithTwo` 的 `wings.length !== 2`：被同一行的
 *   `every(count === 2)` 加总张数蕴含。2860 处差异。
 * - `canBeat` 的 `if (isBombLike(target)) return false;`：实现里已注明它与
 *   下一行的类型检查重叠。多点变异（同时删掉类型检查）下有 86 行差异，
 *   说明它确实是留给「将来加入同型可压变体」的锚点，不是死代码。
 * - `identifyPattern` 的 `if (size === 0) return null;`：所有 matcher 对空
 *   输入本就返回 null。
 *
 * cards.ts
 * - `mulberry32` 里 `seed >>> 0`：对**任何整数种子**都等价（紧随其后的
 *   `(a + K) >>> 0` 已经把结果规约到 uint32）。只有传入负的非整数种子才有
 *   差别，而 `shuffle` 的契约写明种子是 32 位整数。
 */
