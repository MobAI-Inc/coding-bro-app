/**
 * 立直麻将：变异测试暴露出的边界。
 *
 * 与同目录其它测试文件的分工是刻意的：那些用例逐条来自 MahjongRepository/mahjong
 * 语料，夹具由脚本生成、头部写着「请勿手工编辑」。本文件里的用例**不在语料里**，
 * 是手写的，所以单独放一个文件 —— 混进夹具会让下次重新生成时被覆盖掉，而且会
 * 让人误以为它们也有语料背书。
 *
 * 每一条都对应一个**逃逸的变异体**：把实现里某个判断删掉或放宽之后，454 条语料
 * 用例全绿。语料覆盖不到这些边界不是语料的错 —— 它测的是「这手牌值多少番」，
 * 而下面这些问的是「这手牌根本不该被判成和牌」。前者是产品功能，后者是防线。
 *
 * 这些防线守的是同一件事：**牌山里不存在的牌型不能算出分来**。日麻的番数直接
 * 换算成点数，而点数在我们这里要扣积分、要结算 —— 一个五张 1 万的手牌被判成和牌，
 * 意味着有人能凭空构造出役满。
 */

import { describe, expect, it } from "vitest";
import { divideHand, isAgari, isYakuPresent } from "@/bro/games/riichi/logic";
import type { DetectInput, TileCounts } from "@/bro/games/riichi/logic";

/**
 * 由「牌种 -> 张数」构造 34 位数组。
 *
 * 语料夹具里是逐位写死的 34 个数字，手写时那样太容易数错一位，而数错一位得到的
 * 是另一手合法牌 —— 测试照样绿，只是测的东西变了。
 */
function counts(spec: Readonly<Record<number, number>>): TileCounts {
  const out = new Array(34).fill(0);
  for (const [tile, n] of Object.entries(spec)) {
    out[Number(tile)] = n;
  }
  return out;
}

/** 万子 1-9 是 0-8，饼子 1-9 是 9-17，索子 1-9 是 18-26，字牌 27-33。 */
const M = (n: number) => n - 1;
const P = (n: number) => 8 + n;
const S = (n: number) => 17 + n;
const EAST = 27;
const SOUTH = 28;
const WEST = 29;

describe("riichi/agari 边界：牌山里不存在的牌型", () => {
  /**
   * 五张同种牌。
   *
   * 一副麻将每种牌只有 4 张，5 张 1 万这手牌在物理上不存在。但「4 面子 + 1 雀头」
   * 的拆解算法本身不关心这个 —— 5 张 1 万可以拆成「111m 刻子 + 11m 雀头」，凑上
   * 123456789p 正好是 4 面子 1 雀头，算法会开开心心地判成和牌。
   *
   * 语料的反例里有五张、六张同牌的用例，但那些走的是 `divideHand`；`isAgari`
   * 这一侧的上限检查删掉之后 454 条全绿。
   */
  it("五张 1 万凑不成和牌 —— 张数上限删掉后这手牌会被判成和了", () => {
    const hand = counts({
      [M(1)]: 5,
      [P(1)]: 1, [P(2)]: 1, [P(3)]: 1, [P(4)]: 1, [P(5)]: 1,
      [P(6)]: 1, [P(7)]: 1, [P(8)]: 1, [P(9)]: 1,
    });
    expect(isAgari(hand)).toBe(false);
    expect(divideHand(hand)).toEqual([]);
  });

  it("六张同牌同样不成立", () => {
    const hand = counts({
      [M(1)]: 6,
      [P(1)]: 1, [P(2)]: 1, [P(3)]: 1, [P(4)]: 1, [P(5)]: 1,
      [P(6)]: 1, [P(7)]: 1, [P(8)]: 1,
    });
    expect(isAgari(hand)).toBe(false);
  });

  it("负数张数不成立 —— 副露扣减出错时会走到这里", () => {
    const hand = counts({ [M(1)]: -1, [M(2)]: 3, [M(3)]: 3, [P(1)]: 3, [P(2)]: 3, [P(3)]: 2 });
    expect(isAgari(hand)).toBe(false);
  });
});

describe("riichi/agari 边界：国士无双", () => {
  /**
   * 国士要求 13 种幺九各至少一张、其中**恰好一种**是两张（那一对是雀头）。
   *
   * 去掉「恰好一对」之后，13 张全单张（只有 13 张牌，还差一张才和牌）会被判成
   * 国士。这不是学术问题：国士是役满，役满在我们的积分体系里是最大的一笔结算。
   */
  it("13 种幺九各一张不算国士 —— 还差一张才和牌", () => {
    const thirteen = counts({
      [M(1)]: 1, [M(9)]: 1, [P(1)]: 1, [P(9)]: 1, [S(1)]: 1, [S(9)]: 1,
      27: 1, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1, 33: 1,
    });
    expect(isAgari(thirteen)).toBe(false);
    expect(isYakuPresent("kokushi", detectOf(thirteen))).toBe(false);
  });

  it("两种幺九各两张也不算 —— 雀头只能有一个", () => {
    const twoPairs = counts({
      [M(1)]: 2, [M(9)]: 2, [P(1)]: 1, [P(9)]: 1, [S(1)]: 1, [S(9)]: 1,
      27: 1, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1,
    });
    expect(isAgari(twoPairs)).toBe(false);
  });
});

describe("riichi/agari 边界：字牌不成顺子", () => {
  /**
   * 字牌只能成刻或成雀头，永远不能成顺。「东南西」不是顺子。
   *
   * 顺子的拆解按花色分段进行，字牌段若没被挡住，`1z2z3z` 会被当成一个面子，于是
   * `11m234m567m999m + 东南西` 被判成和牌。这手牌在任何规则下都不是和牌。
   */
  it("东南西不是顺子", () => {
    const hand = counts({
      [M(1)]: 2, [M(2)]: 1, [M(3)]: 1, [M(4)]: 1,
      [M(5)]: 1, [M(6)]: 1, [M(7)]: 1, [M(9)]: 3,
      [EAST]: 1, [SOUTH]: 1, [WEST]: 1,
    });
    expect(isAgari(hand)).toBe(false);
  });

  it("字牌散张不成面子 —— 单张东剩在手上就不是和牌", () => {
    const hand = counts({
      [M(1)]: 3, [M(2)]: 3, [M(3)]: 3, [P(1)]: 3, [EAST]: 1, [SOUTH]: 1,
    });
    expect(isAgari(hand)).toBe(false);
  });
});

describe("riichi/agari 边界：顺子不跨花色", () => {
  /**
   * `8m9m1p` 看着像连着的三个数，但花色一换就不是顺子。拆解按花色分段传入区间，
   * 区间上界写错（`i + 2 < end` 松成 `i + 2 < TILE_KINDS`）就会让顺子从万子尾部
   * 伸进饼子。
   *
   * 下面这手牌是**特意构造**的，不能"简化"成更直观的 `8m9m1p + 三个刻子 + 雀头`。
   * 那种手牌检测不到这个 bug，原因藏在 consumeSuit 的回溯里：它在 `return true`
   * 之前会把牌**还回去**，所以万/饼/索三段是各自独立跑的 —— 跨花色偷走的那张 1p，
   * 轮到饼子段时又完好无损地在那儿。于是约束变成纯粹的数量同余：
   *
   *   - 一个跨花色顺（起点 i=7，吃掉 8m 9m + 1 张饼）只消耗 **2** 张万子，
   *     万子段剩余 ≡ 2 (mod 3)，剩下的一张万子无论如何凑不成面子 —— 段内自己
   *     就先失败了，压根走不到"骗过判定"那一步。
   *   - 要让万子段平账，必须**两个**跨花色顺：i=7 吃 8m9m，i=8 再吃 9m，
   *     合计 2 + 1 = 3 张，万子清零。
   *
   * 所以是 `8m 9m9m`：一张 8 万配两张 9 万。饼子那边要能被借两次又还得回来，
   * 于是 1p2p3p 各两张（自身正好拆成两副 123p）。
   *
   * 我最初写的是 `8m9m1p + 444p 777p 222s 55s`，跑起来两边都是 false —— 用例是
   * 绿的，但绿得毫无意义：它连那行被改坏的代码都没执行到。变异测试才把这件事
   * 揭出来。
   */
  it("顺子不能从万子尾伸进饼子 —— 区间上界放宽后这手牌会被判成和了", () => {
    // 8m 9m9m | 1p1p 2p2p 3p3p | 5s5s5s | 東東
    const hand = counts({
      [M(8)]: 1, [M(9)]: 2,
      [P(1)]: 2, [P(2)]: 2, [P(3)]: 2,
      [S(5)]: 3,
      [EAST]: 2,
    });
    expect(isAgari(hand)).toBe(false);
  });
});

describe("riichi/detect 边界：役的判定不能放宽", () => {
  /**
   * 三暗刻要求**恰好**三个暗刻。放宽成「至少三个」之后，四暗刻的手牌会同时被判成
   * 三暗刻。
   *
   * 整手估值那一层有 `SUPERSEDES` 表挡着（四暗刻覆盖三暗刻），所以番数看不出差别 ——
   * 这正是它逃逸的原因。但 `isYakuPresent` 是导出函数，状态机与界面会直接拿它问
   * 「这手牌有没有某个役」，那一层没有覆盖表兜底。防线不能只有一道，何况这道还
   * 隔了一层。
   */
  it("四暗刻的手牌不同时算三暗刻", () => {
    const hand = counts({
      [M(1)]: 3, [M(5)]: 3, [P(3)]: 3, [P(7)]: 3, [S(2)]: 2,
    });
    const input: DetectInput = {
      ...detectOf(hand),
      division: [
        [M(1), M(1), M(1)],
        [M(5), M(5), M(5)],
        [P(3), P(3), P(3)],
        [P(7), P(7), P(7)],
        [S(2), S(2)],
      ],
      isTsumo: true,
    };
    expect(isYakuPresent("suuankou", input)).toBe(true);
    expect(isYakuPresent("sanankou", input)).toBe(false);
  });

  /**
   * 混全带幺九要求**至少一张字牌**，一张字牌都没有的那是纯全带幺九（番数更高）。
   * 去掉字牌检查之后，纯全的手牌会同时被判成混全 —— 同样被 `SUPERSEDES` 挡住了
   * 番数，同样在 `isYakuPresent` 这一层是错的。
   */
  it("纯全带幺九的手牌不同时算混全带幺九", () => {
    const hand = counts({
      [M(1)]: 1, [M(2)]: 1, [M(3)]: 1,
      [M(7)]: 1, [M(8)]: 1, [M(9)]: 1,
      [P(1)]: 1, [P(2)]: 1, [P(3)]: 1,
      [S(7)]: 1, [S(8)]: 1, [S(9)]: 1,
      [S(1)]: 2,
    });
    const input: DetectInput = {
      ...detectOf(hand),
      division: [
        [M(1), M(2), M(3)],
        [M(7), M(8), M(9)],
        [P(1), P(2), P(3)],
        [S(7), S(8), S(9)],
        [S(1), S(1)],
      ],
    };
    expect(isYakuPresent("junchan", input)).toBe(true);
    expect(isYakuPresent("chantai", input)).toBe(false);
  });
});

/** 最简 DetectInput。只关心 counts 的用例用它，不必每次写全字段。 */
function detectOf(hand: TileCounts): DetectInput {
  return {
    division: [],
    counts: hand,
    melds: [],
    winTile: null,
    isTsumo: false,
    playerWind: null,
    roundWind: null,
    isClosed: true,
  };
}
