/**
 * 斗地主：牌型识别与大小比较。
 *
 * 识别是**确定性**的：同一组牌永远解析成同一个 {@link Pattern}，不依赖出牌
 * 顺序、不依赖手牌上下文。这条性质是客户端预测能对上服务端的前提。
 *
 * 本文件集中处理三类最容易写错的地方，每处都在对应函数里标了坑：
 *
 * - **顺子类的点数上界**：2 和双王不能进顺子/连对/飞机。统一用
 *   `RANK_STRAIGHT_MAX` 卡住，避免「挡了 2 忘了王」。
 * - **最小长度**：顺子 ≥5 张、连对 ≥3 对、飞机 ≥2 组。少一个判断就会
 *   把「334455 之类的三连对」和「345 三张顺子」放进来。
 * - **炸弹不可拆**：四张同点只能整体作为炸弹或四带二的主体出现，不允许
 *   拆出来去凑三带、飞机或带牌。
 *
 * 比较规则见 {@link canBeat}：非炸弹牌型必须**同类型、同长度**才可比，
 * 炸弹压一切非炸弹，王炸压一切。
 */

import type { Card } from "./cards";
import { RANK_JOKER_BIG, RANK_JOKER_SMALL, RANK_STRAIGHT_MAX } from "./cards";

/** 牌型。 */
export type PatternType =
  | "single"
  | "pair"
  | "triple"
  | "triple_with_single"
  | "triple_with_pair"
  /** 顺子，≥5 张连续单牌 */
  | "straight"
  /** 连对，≥3 组连续对子 */
  | "straight_pair"
  /** 飞机不带牌，≥2 组连续三张 */
  | "plane"
  | "plane_with_singles"
  | "plane_with_pairs"
  | "four_with_two_singles"
  | "four_with_two_pairs"
  | "bomb"
  | "rocket";

/** 识别出的牌型。 */
export interface Pattern {
  readonly type: PatternType;
  /**
   * 比较大小的基准点数。
   *
   * 取的是**主体**的点数，与带牌无关：`333+K` 的 rank 是 3 不是 13，所以
   * 它压不过 `444+3`。顺子/连对/飞机取主体的最小点（起始点）。
   */
  readonly rank: number;
  /**
   * 主体长度：顺子的张数、连对的对数、飞机的三张组数。非连续牌型恒为 1。
   *
   * 单独存在是因为「同类型」不足以判定可比：`34567` 与 `345678` 都是顺子，
   * 但不能互相压。
   */
  readonly length: number;
  /** 总张数。 */
  readonly size: number;
  readonly cards: readonly Card[];
}

/** 按点数聚合后的牌组，按点数升序。 */
interface RankGroup {
  rank: number;
  count: number;
}

function groupByRank(cards: readonly Card[]): RankGroup[] {
  const counts = new Map<number, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => a.rank - b.rank);
}

/** 升序点数序列是否逐个 +1。 */
function isConsecutive(ranks: readonly number[]): boolean {
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

/**
 * 顺子类主体的公共门槛：连续，且最大点不超过 A。
 *
 * 坑就在上界这一句：`A2345` 里的 2（15）和 `JQKA2` 的 2 都靠它挡掉，
 * 双王（16/17）同样被挡。牌力顺序上 2 比 A 大，直觉上「A、2 相邻」，
 * 但斗地主里 2 不接龙——这是最常见的实现错误。
 */
function isStraightBody(ranks: readonly number[]): boolean {
  if (ranks.length === 0) return false;
  if (ranks[ranks.length - 1] > RANK_STRAIGHT_MAX) return false;
  return isConsecutive(ranks);
}

/**
 * 牌型骨架：识别阶段只产出「是什么型、比什么点、多长」，具体牌张由
 * {@link identifyPattern} 统一挂上，省得每个 matcher 都复制一遍。
 */
type Shape = Pick<Pattern, "type" | "rank" | "length">;

function make(type: PatternType, rank: number, length: number): Shape {
  return { type, rank, length };
}

function matchRocket(groups: RankGroup[], size: number): Shape | null {
  if (size !== 2) return null;
  const ranks = groups.map((g) => g.rank);
  if (ranks.length !== 2) return null;
  if (ranks[0] !== RANK_JOKER_SMALL || ranks[1] !== RANK_JOKER_BIG) return null;
  return make("rocket", RANK_JOKER_BIG, 1);
}

function matchBomb(groups: RankGroup[], size: number): Shape | null {
  if (size !== 4 || groups.length !== 1) return null;
  return make("bomb", groups[0].rank, 1);
}

/** 单张、对子、三张。 */
function matchSimple(groups: RankGroup[], size: number): Shape | null {
  if (groups.length !== 1) return null;
  // 注意：双王走不到这里——它们点数不同，groups.length 为 2，因此
  // 「大小王当一对」被结构本身排除，不需要额外判断。
  if (size === 1) return make("single", groups[0].rank, 1);
  if (size === 2) return make("pair", groups[0].rank, 1);
  if (size === 3) return make("triple", groups[0].rank, 1);
  return null;
}

/**
 * 带牌（翅膀）的合法性。
 *
 * 挡两件事，都是「拆不可拆的牌」：
 * - 翅膀里出现四张同点 → 拆炸弹去当带牌；
 * - 翅膀里同时出现大小王 → 拆王炸去当两张单牌。
 *
 * 这两条在各地方言规则里偶有出入，本实现统一禁止：允许拆的话，
 * `333444+5555` 会被识别成飞机带两单，而它明明含一个炸弹。
 */
function wingsAreLegal(wings: readonly RankGroup[]): boolean {
  if (wings.some((g) => g.count >= 4)) return false;
  const hasSmall = wings.some((g) => g.rank === RANK_JOKER_SMALL);
  const hasBig = wings.some((g) => g.rank === RANK_JOKER_BIG);
  return !(hasSmall && hasBig);
}

/** 三带一、三带二。 */
function matchTripleWithWing(groups: RankGroup[], size: number): Shape | null {
  if (size !== 4 && size !== 5) return null;
  const body = groups.find((g) => g.count === 3);
  if (body === undefined) return null;
  const wings = groups.filter((g) => g.rank !== body.rank);
  if (!wingsAreLegal(wings)) return null;
  if (size === 4) {
    // 4 张牌里既然已经有三张同点，剩下的必然正好是 1 张散牌，不必再数一遍
    // ——真正把「只能带一张」定死的是总张数。带什么牌都行，包括王。
    return make("triple_with_single", body.rank, 1);
  }
  // 三带二带的是**一对**，不是随便两张：三带二写成「三张 + 任意两张」是
  // 常见 bug，会让 `333+45` 变成合法牌型。
  return wings.length === 1 && wings[0].count === 2
    ? make("triple_with_pair", body.rank, 1)
    : null;
}

function matchStraight(groups: RankGroup[], size: number): Shape | null {
  // 顺子至少 5 张。写成 >= 3 会把 `345` 放进来。
  if (size < 5) return null;
  if (!groups.every((g) => g.count === 1)) return null;
  const ranks = groups.map((g) => g.rank);
  if (!isStraightBody(ranks)) return null;
  return make("straight", ranks[0], ranks.length);
}

function matchStraightPair(groups: RankGroup[], size: number): Shape | null {
  // 连对至少 3 对。两对（如 `3344`）不成牌型。
  if (size < 6 || size % 2 !== 0) return null;
  if (!groups.every((g) => g.count === 2)) return null;
  const ranks = groups.map((g) => g.rank);
  if (!isStraightBody(ranks)) return null;
  return make("straight_pair", ranks[0], ranks.length);
}

/** 飞机不带牌：≥2 组连续三张。 */
function matchPlane(groups: RankGroup[], size: number): Shape | null {
  if (size < 6 || size % 3 !== 0) return null;
  if (!groups.every((g) => g.count === 3)) return null;
  const ranks = groups.map((g) => g.rank);
  if (!isStraightBody(ranks)) return null;
  return make("plane", ranks[0], ranks.length);
}

/** 扣掉主体三张后剩下的牌组。 */
function wingsAfterBody(
  groups: readonly RankGroup[],
  bodyRanks: readonly number[],
): RankGroup[] {
  const body = new Set(bodyRanks);
  return groups
    .map((g) => (body.has(g.rank) ? { rank: g.rank, count: g.count - 3 } : g))
    .filter((g) => g.count > 0);
}

/**
 * 飞机带牌。
 *
 * 主体候选只取 `count === 3` 的点数：`count === 4` 的点数是炸弹，不允许
 * 拆出三张来当飞机主体（同 {@link wingsAreLegal} 的理由）。
 *
 * **枚举「起点 × 组数」，而不是用总张数反推组数。** 反推的写法（`4k` 张
 * 就取 `k` 组）看着更短，但那样一来「带牌张数 = 三张组数」会退化成恒等式
 * ——主体拿走 `3k` 张，剩下的必然是 `k` 张，那条判断一行都没管用；真正
 * 挡住 `333444+5` 的是「总张数不能被 4 整除」这个副作用。规则藏在算术
 * 巧合里，就没法被测试钉住，也没法被人读懂。先定主体再数带牌，带牌数量
 * 才是真的在被检查。
 *
 * 少数牌组存在多解（12 张的 `333444555666` 既是 4 组纯飞机，也能看成 3 组
 * 带 3 单）。消歧靠两点：纯飞机在 {@link identifyPattern} 里先匹配；到这里
 * 仍多解时取**起点最小、组数最少**的解，保证两端算出同一个答案，而不是
 * 各挑各的。
 */
function matchPlaneWithWings(groups: RankGroup[]): Shape | null {
  const bodyRanks = groups
    .filter((g) => g.count === 3 && g.rank <= RANK_STRAIGHT_MAX)
    .map((g) => g.rank);

  for (let start = 0; start < bodyRanks.length; start += 1) {
    // 飞机至少 2 组连续三张
    for (let planes = 2; start + planes <= bodyRanks.length; planes += 1) {
      const window = bodyRanks.slice(start, start + planes);
      // 从这个起点已经断开，窗口再长也接不上
      if (!isConsecutive(window)) break;

      const wings = wingsAfterBody(groups, window);
      if (!wingsAreLegal(wings)) continue;
      const wingCards = wings.reduce((n, g) => n + g.count, 0);

      // 带单：单牌张数必须等于三张组数
      if (wingCards === planes) {
        return make("plane_with_singles", window[0], planes);
      }
      // 带对：对子数等于三张组数，且每一份都得是完整的对子
      if (wingCards === planes * 2 && wings.every((g) => g.count === 2)) {
        return make("plane_with_pairs", window[0], planes);
      }
    }
  }
  return null;
}

/** 四带二（两单 / 两对）。 */
function matchFourWithTwo(groups: RankGroup[], size: number): Shape | null {
  if (size !== 6 && size !== 8) return null;
  const quads = groups.filter((g) => g.count === 4);
  // 恰好一个四张：`44445555` 是两个炸弹，必须分开出，不是四带两对。
  if (quads.length !== 1) return null;
  const body = quads[0];
  const wings = groups.filter((g) => g.rank !== body.rank);
  if (!wingsAreLegal(wings)) return null;

  if (size === 6) {
    // 带的两张单牌允许同点（`4444+55` 视作带两张 5），这不影响任何比较。
    return make("four_with_two_singles", body.rank, 1);
  }
  // 两个**不同点数**的对子。同点四张已被 wingsAreLegal 挡掉。
  if (wings.length !== 2 || !wings.every((g) => g.count === 2)) return null;
  return make("four_with_two_pairs", body.rank, 1);
}

/**
 * 识别牌型。无法识别返回 `null`——非法牌型是正常流程，不是异常。
 *
 * 匹配顺序即优先级。唯一真正需要顺序来消歧的是飞机：纯飞机排在带牌飞机
 * 之前，于是 `333444555666` 稳定解析为「4 组纯飞机」而不是「3 组带 3 单」。
 *
 * @param cards 待识别的牌，顺序无关
 */
export function identifyPattern(cards: readonly Card[]): Pattern | null {
  const size = cards.length;
  if (size === 0) return null;
  const groups = groupByRank(cards);

  const found =
    matchRocket(groups, size) ??
    matchBomb(groups, size) ??
    matchSimple(groups, size) ??
    matchTripleWithWing(groups, size) ??
    matchStraight(groups, size) ??
    matchStraightPair(groups, size) ??
    matchPlane(groups, size) ??
    matchPlaneWithWings(groups) ??
    matchFourWithTwo(groups, size);

  if (found === null) return null;
  return { ...found, size, cards };
}

/** 炸弹与王炸：唯一可以跨牌型压制的两种。 */
function isBombLike(pattern: Pattern): boolean {
  return pattern.type === "bomb" || pattern.type === "rocket";
}

/**
 * `candidate` 能否压过 `target`。
 *
 * `target` 为 `null` 表示新一轮自由出牌，任何合法牌型都可以打。
 *
 * 规则优先级：
 * 1. 王炸压一切；
 * 2. 炸弹压一切非炸弹，炸弹之间比点数；
 * 3. 其余牌型必须**同类型且同长度**才可比——「五张顺子压不了六张顺子」
 *    出自这里。
 *
 * 只比 `type` 和 `length`、不比 `size`：这两者已经唯一确定张数（顺子
 * `size = length`、连对 `2×length`、飞机 `3×length`……，长度恒为 1 的牌型
 * 则由类型定死）。多加一个 `size` 判断不会更严，只会让三个判断互相兜底，
 * 结果是删掉任意一个测试都照样绿——校验规则的代码自己不该有这种冗余。
 */
export function canBeat(candidate: Pattern, target: Pattern | null): boolean {
  if (target === null) return true;
  if (candidate.type === "rocket") return target.type !== "rocket";
  if (target.type === "rocket") return false;
  if (candidate.type === "bomb") {
    return target.type === "bomb" ? candidate.rank > target.rank : true;
  }
  // 非炸弹打不过炸弹：四带二哪怕点数更大、张数更多也不行。
  //
  // 就结果而言这行与下面的类型检查重叠（炸弹自成一型，类型对不上本就
  // 压不过），保留它是因为规则本身在这里：将来若加入「同型可压」之类的
  // 变体，先失效的会是下面那行，而炸弹的特权必须原地不动。
  if (isBombLike(target)) return false;
  if (candidate.type !== target.type) return false;
  return candidate.length === target.length && candidate.rank > target.rank;
}

/**
 * 两个牌型是否**可比**（同类型同长度，或涉及炸弹/王炸）。
 *
 * 供 UI 用：不可比时应提示「牌型不符」，而不是「你的牌太小」。
 */
export function isComparable(a: Pattern, b: Pattern): boolean {
  if (isBombLike(a) || isBombLike(b)) return true;
  return a.type === b.type && a.length === b.length;
}
