/**
 * 对局层规则测试：和棋与长将。
 *
 * 与 xiangqi.test.ts 的分工：那边测「一个局面算什么」，这边测「一盘棋算什么」。
 * 输入也因此不同——这里每条用例都要先造出一段**着法历史**。
 *
 * 造历史一律走 {@link play}，它逐手调 `playMove`，非法就抛。这一条不是洁癖：
 * `positionFrom` 不校验局面合法性，两个将摆在同一列且中间无子它照样给你，
 * 而从那种局面出发的每一步都是非法的。让 `play` 抛出来，用例写错时会当场炸，
 * 而不是安静地造出一段不可能发生的历史再让断言在假局面上通过。
 */

import { describe, expect, it } from "vitest";
import type { MatchPly, Position, Square } from "@/bro/games/xiangqi/logic";
import {
  ALL_SQUARES,
  NATURAL_LIMIT_MOVES,
  NATURAL_LIMIT_PLIES,
  REPETITION_LIMIT,
  adjudicatePerpetual,
  bothSidesCannotWin,
  formatSquare,
  hasAttackingPiece,
  isFinished,
  matchOutcome,
  movesUntilNaturalDraw,
  parseSquare,
  pieceAt,
  playMove,
  pliesSinceCapture,
  positionFrom,
  positionKey,
} from "@/bro/games/xiangqi/logic";

interface Played {
  readonly history: MatchPly[];
  readonly current: Position;
}

/**
 * 依次走完 `moves`，产出对局层要的历史与终局面。
 *
 * 着法写成 `"e0-e1"`。非法着法直接抛——见文件头。
 */
function play(start: Position, moves: readonly string[]): Played {
  let pos = start;
  const history: MatchPly[] = [];
  for (const text of moves) {
    const [from, to] = text.split("-").map(parseSquare);
    const captured = pieceAt(pos, to) !== null;
    const next = playMove(pos, { from, to });
    if (next === null) throw new Error(`用例里的着法非法: ${text}`);
    history.push({ before: pos, captured });
    pos = next;
  }
  return { history, current: pos };
}

describe("规则常量", () => {
  it("限着 60 回合、重复 3 次 — 写死字面量，不从常量推导", () => {
    // 下面所有用例都拿这些常量去造历史，于是改了常量它们会跟着改，永远绿。
    // 这条用例是唯一能钉住数值本身的地方：60 和 3 出自竞赛规则，不是随手取的，
    // 改小了玩家会莫名其妙提前被判和。
    expect(NATURAL_LIMIT_MOVES).toBe(60);
    expect(NATURAL_LIMIT_PLIES).toBe(120);
    expect(REPETITION_LIMIT).toBe(3);
  });
});

describe("局面指纹", () => {
  it("走子方计入指纹 — 子力相同但轮谁走，是两个局面", () => {
    // 不计走子方的话，一来一回会被当成「回到了原局面」，正常的进退就成了重复。
    const red = positionFrom("red", { e9: "K", e0: "k", e5: "P" });
    const black = positionFrom("black", { e9: "K", e0: "k", e5: "P" });
    expect(positionKey(red)).not.toBe(positionKey(black));
  });

  it("子力摆位相同则指纹相同 — 否则永远判不出重复", () => {
    const a = positionFrom("red", { e9: "K", d0: "k", a5: "R" });
    const b = positionFrom("red", { a5: "R", d0: "k", e9: "K" });
    expect(positionKey(a)).toBe(positionKey(b));
  });
});

describe("子力不足和棋", () => {
  it("双方只剩光杆将 — 谁也杀不死谁，判和", () => {
    // 这一条以前是不存在的：两个将在九宫里互相躲，getOutcome 永远 ongoing，
    // 这盘棋不会结束。而入场费在进场时已经扣了，不结束就等于收了钱不给结果。
    const pos = positionFrom("red", { e9: "K", d0: "k" });
    expect(matchOutcome([], pos)).toEqual({ kind: "draw_material" });
  });

  it("士象不算攻击子力 — 它们出不了九宫也过不了河", () => {
    const pos = positionFrom("red", {
      e9: "K",
      d0: "k",
      d9: "A",
      c0: "a",
      e2: "b",
    });
    expect(hasAttackingPiece(pos, "red")).toBe(false);
    expect(hasAttackingPiece(pos, "black")).toBe(false);
    expect(matchOutcome([], pos)).toEqual({ kind: "draw_material" });
  });

  it.each([
    ["车", "R"],
    ["马", "N"],
    ["炮", "C"],
    ["兵", "P"],
  ])("红方还有%s就不判和 — 还有杀棋的可能", (_name, char) => {
    // 四种逐个列出而不是只测车：ATTACKING_TYPES 漏写一种的表现是「还有马却判了和」，
    // 只测车的话那个漏写会全绿。
    const pos = positionFrom("red", { e9: "K", d0: "k", a5: char });
    expect(hasAttackingPiece(pos, "red")).toBe(true);
    expect(bothSidesCannotWin(pos)).toBe(false);
    expect(matchOutcome([], pos)).toEqual({ kind: "ongoing" });
  });

  it("只要有一方有攻击子力就不判和 — 黑方那侧同样成立", () => {
    // 上一组全是红方持子。判定若写成只看红方，这一条会红。
    const pos = positionFrom("red", { e9: "K", d0: "k", a5: "r" });
    expect(hasAttackingPiece(pos, "red")).toBe(false);
    expect(hasAttackingPiece(pos, "black")).toBe(true);
    expect(matchOutcome([], pos)).toEqual({ kind: "ongoing" });
  });
});

describe("吃子计数", () => {
  /** 红帅 e9、黑将 d0（错开列，否则飞将），红车 a5，黑马 a2 供吃。 */
  const start = positionFrom("red", { e9: "K", d0: "k", a5: "R", a2: "n" });

  it("从真实棋局里数 — 吃子标记确实跟着吃子走", () => {
    // 合成历史测不到这一层：那里的 captured 是我自己填的。这里让 play() 自己
    // 从局面上读「目标格有没有子」，数出来的才是真的。
    const quiet = play(start, ["a5-a3", "a2-c1", "a3-a1"]);
    expect(quiet.history.map((ply) => ply.captured)).toEqual([
      false,
      false,
      false,
    ]);
    expect(pliesSinceCapture(quiet.history)).toBe(3);

    const eaten = play(start, ["a5-a2"]);
    expect(eaten.history[0].captured).toBe(true);
    expect(pliesSinceCapture(eaten.history)).toBe(0);
  });

  it("吃子把计数清零，之后重新累计 — 数的是「连续」不吃子", () => {
    const played = play(start, ["a5-a2", "d0-d1"]);
    expect(played.history.map((ply) => ply.captured)).toEqual([true, false]);
    // 从最近一次吃子起算，不是从开局起算
    expect(pliesSinceCapture(played.history)).toBe(1);
  });

  it("开局无人吃子时就是已走的全部手数", () => {
    expect(pliesSinceCapture([])).toBe(0);
  });
});

/**
 * 供合成历史使用的巡游格：全盘去掉两个将所在的格。
 *
 * 车每一手换一格，于是每一手一个不同的指纹。目的是**避开三次重复**——那一条
 * 排在自然限着前面，撞上了就测不到限着这一支。88 格走完才回头，因此 121 手
 * 以内任何指纹最多出现 2 次，够不到三次的门槛。
 */
const ROAM: readonly Square[] = ALL_SQUARES.filter((sq) => {
  const name = formatSquare(sq);
  return name !== "d9" && name !== "f0";
});

/**
 * 造一段指定长度、全程不吃子的合成历史。
 *
 * 这些"着法"不构成合法棋谱，只有 `before` 的指纹与 `captured` 会被读到。用它
 * 测的是计数边界，不是棋理——手写 120 手不吃子又不三次重复的合法棋谱不现实，
 * 而自然限着这条规则本身就是个计数器。代价是它不验证「吃子标记是否真的跟着
 * 吃子走」，那一条由上面的真棋局用例守着。
 */
function syntheticHistory(plies: number): MatchPly[] {
  const out: MatchPly[] = [];
  for (let i = 0; i < plies; i += 1) {
    out.push({
      before: positionFrom(i % 2 === 0 ? "red" : "black", {
        d9: "K",
        f0: "k",
        [formatSquare(ROAM[i % ROAM.length])]: "R",
      }),
      captured: false,
    });
  }
  return out;
}

describe("自然限着和棋", () => {
  /**
   * 多摆一只黑车，为的是**和合成历史里的任何一个局面都不同指纹**（那些局面
   * 只有一只红车）。否则待判局面可能恰好在历史里出现过两次，凑够三次重复，
   * 于是这几条用例测到的是重复判和，而不是自然限着。
   */
  const ongoing = positionFrom("red", { d9: "K", f0: "k", a5: "R", i0: "r" });

  it("待判局面不在合成历史里出现过 — 上面那段注释的自检", () => {
    const keys = new Set(
      syntheticHistory(NATURAL_LIMIT_PLIES + 6).map((ply) =>
        positionKey(ply.before),
      ),
    );
    expect(keys.has(positionKey(ongoing))).toBe(false);
  });

  it(`满 ${NATURAL_LIMIT_MOVES} 回合无吃子判和`, () => {
    expect(matchOutcome(syntheticHistory(NATURAL_LIMIT_PLIES), ongoing)).toEqual(
      { kind: "draw_natural_limit" },
    );
  });

  it("差一手不判和 — 边界是「满」不是「接近」", () => {
    // 少了这条，把 >= 写成 > 或把 120 写成 119 都不会被发现。
    expect(
      matchOutcome(syntheticHistory(NATURAL_LIMIT_PLIES - 1), ongoing),
    ).toEqual({ kind: "ongoing" });
  });

  it("中途吃过子就重新计数", () => {
    const history = syntheticHistory(NATURAL_LIMIT_PLIES);
    // 把倒数第二手改成吃子，于是距上次吃子只过了 1 手
    const withCapture = history.map((ply, i) =>
      i === history.length - 2 ? { ...ply, captured: true } : ply,
    );
    expect(pliesSinceCapture(withCapture)).toBe(1);
    expect(matchOutcome(withCapture, ongoing)).toEqual({ kind: "ongoing" });
  });

  it("倒计时按回合给，走到头是 0", () => {
    // 界面要在还剩十几个回合时就提示，不能等到第 60 回合突然弹一个和棋出来
    expect(movesUntilNaturalDraw([])).toBe(NATURAL_LIMIT_MOVES);
    expect(movesUntilNaturalDraw(syntheticHistory(2))).toBe(
      NATURAL_LIMIT_MOVES - 1,
    );
    expect(movesUntilNaturalDraw(syntheticHistory(NATURAL_LIMIT_PLIES))).toBe(0);
    // 判和之后不能出现负数
    expect(
      movesUntilNaturalDraw(syntheticHistory(NATURAL_LIMIT_PLIES + 6)),
    ).toBe(0);
  });
});

describe("重复局面", () => {
  /**
   * 两个将在九宫里对着蹭，四手一循环，全程无人将军。
   *
   * e5 的红兵是必需的：没有它，双方的将同在 e 列且中间无子就是飞将，从那种
   * 局面出发的每一步都非法，`play` 会当场抛。
   */
  const shuffle = positionFrom("red", { e9: "K", e0: "k", e5: "P" });
  const cycle = ["e9-e8", "e0-e1", "e8-e9", "e1-e0"];

  it(`第 ${REPETITION_LIMIT} 次出现才判 — 第二次时对局继续`, () => {
    const twice = play(shuffle, cycle);
    expect(matchOutcome(twice.history, twice.current)).toEqual({
      kind: "ongoing",
    });
  });

  it("三次重复且无人长将 — 双方不变作和", () => {
    const thrice = play(shuffle, [...cycle, ...cycle]);
    expect(matchOutcome(thrice.history, thrice.current)).toEqual({
      kind: "draw_repetition",
    });
  });
});

describe("长将判负", () => {
  /**
   * 红车在第 0、1 两行之间来回照将，黑将只能在 e0 / e1 之间躲。
   * 起始即黑方被将：红车每一手都在将军，黑方每一手都只是应将。
   */
  const redChases = positionFrom("black", { e0: "k", f9: "K", a0: "R" });
  const redCycle = ["e0-e1", "a0-a1", "e1-e0", "a1-a0"];

  it("红方长将 — 判红负，胜方是被将的黑方", () => {
    const played = play(redChases, [...redCycle, ...redCycle]);
    expect(matchOutcome(played.history, played.current)).toEqual({
      kind: "perpetual_check",
      winner: "black",
    });
  });

  it("黑方长将同样判负 — 判的是长将的一方，不是写死某一色", () => {
    // 上一例整个红黑对调。胜方若被硬编码成 "black"，这条会红。
    const blackChases = positionFrom("red", { e9: "K", f0: "k", a9: "r" });
    const played = play(blackChases, [
      "e9-e8",
      "a9-a8",
      "e8-e9",
      "a8-a9",
      "e9-e8",
      "a9-a8",
      "e8-e9",
      "a8-a9",
    ]);
    expect(matchOutcome(played.history, played.current)).toEqual({
      kind: "perpetual_check",
      winner: "red",
    });
  });

  it("间歇将军不算长将 — 循环里有一手没将，就是作和", () => {
    // 「每一步都将」与「将过」的分水岭。判定若把 every 写成 some，这条会变成
    // 红方判负——而红方并没有长将，那是错判，罚的还是有兑换价值的积分。
    const roam = positionFrom("red", { e0: "k", f9: "K", a5: "R" });
    // 车 a5→a0 将军，黑将躲到 e1；车 a0→a5 撤回（不将），黑将回 e0
    const played = play(roam, [
      "a5-a0",
      "e0-e1",
      "a0-a5",
      "e1-e0",
      "a5-a0",
      "e0-e1",
      "a0-a5",
      "e1-e0",
    ]);
    expect(matchOutcome(played.history, played.current)).toEqual({
      kind: "draw_repetition",
    });
  });

  describe("裁定表", () => {
    // 上面几条验的是「棋盘上谁在长将」，这里验的是「知道谁在长将之后怎么判」。
    // 拆开测是因为互将（双方都长将）造不出合法局面——双方同时被将是非法的，
    // 真要构造得让每一手同时解将又照将，属于排局。规则明文有这一条，不能因为
    // 造不出局面就让它没人验。
    it("一方长将 — 长将的那方判负", () => {
      expect(adjudicatePerpetual(true, false)).toEqual({
        kind: "perpetual_check",
        winner: "black",
      });
      expect(adjudicatePerpetual(false, true)).toEqual({
        kind: "perpetual_check",
        winner: "red",
      });
    });

    it("互将 — 双方都长将则作和，不是谁先谁赢", () => {
      expect(adjudicatePerpetual(true, true)).toEqual({
        kind: "draw_repetition",
      });
    });

    it("无人长将 — 双方不变作和", () => {
      expect(adjudicatePerpetual(false, false)).toEqual({
        kind: "draw_repetition",
      });
    });
  });
});

describe("判定顺序", () => {
  it("将死压过自然限着 — 磨了 60 回合的最后一手正好将死，算胜不算和", () => {
    const mated = positionFrom("black", { e0: "k", f9: "K", a0: "R", a1: "R" });
    expect(matchOutcome(syntheticHistory(NATURAL_LIMIT_PLIES), mated)).toEqual({
      kind: "checkmate",
      winner: "red",
    });
  });

  it("长将压过自然限着 — 长将拖过 60 回合仍判负，不能拖成和棋", () => {
    // 顺序反了的话，长将方只要把循环拖满 60 回合就能把「判负」变成「和棋」，
    // 白赚半分。这是这个顺序唯一存在的理由。
    const chased = play(positionFrom("black", { e0: "k", f9: "K", a0: "R" }), [
      "e0-e1",
      "a0-a1",
      "e1-e0",
      "a1-a0",
      "e0-e1",
      "a0-a1",
      "e1-e0",
      "a1-a0",
    ]);
    const dragged = [
      ...syntheticHistory(NATURAL_LIMIT_PLIES),
      ...chased.history,
    ];

    expect(pliesSinceCapture(dragged)).toBeGreaterThanOrEqual(
      NATURAL_LIMIT_PLIES,
    );
    expect(matchOutcome(dragged, chased.current)).toEqual({
      kind: "perpetual_check",
      winner: "black",
    });
  });
});

describe("和棋结果不带胜方", () => {
  it("三种和棋都没有 winner 字段 — 结算时没有可发积分的对象", () => {
    // 类型上和棋分支就没有 winner，这里守的是运行时也确实不带：结算读到一个
    // 意外的 winner 就会把积分发给某一方。
    const draws = [
      matchOutcome([], positionFrom("red", { e9: "K", d0: "k" })),
      matchOutcome(
        syntheticHistory(NATURAL_LIMIT_PLIES),
        positionFrom("red", { d9: "K", f0: "k", a5: "R", i0: "r" }),
      ),
      matchOutcome(
        ...(() => {
          const shuffle = positionFrom("red", { e9: "K", e0: "k", e5: "P" });
          const cycle = ["e9-e8", "e0-e1", "e8-e9", "e1-e0"];
          const played = play(shuffle, [...cycle, ...cycle]);
          return [played.history, played.current] as const;
        })(),
      ),
    ];

    expect(draws.map((d) => d.kind)).toEqual([
      "draw_material",
      "draw_natural_limit",
      "draw_repetition",
    ]);
    for (const draw of draws) {
      expect("winner" in draw).toBe(false);
    }
  });
});

describe("isFinished", () => {
  it("只有 ongoing 不算终局", () => {
    expect(isFinished({ kind: "ongoing" })).toBe(false);
    expect(isFinished({ kind: "draw_material" })).toBe(true);
    expect(isFinished({ kind: "draw_repetition" })).toBe(true);
    expect(isFinished({ kind: "draw_natural_limit" })).toBe(true);
    expect(isFinished({ kind: "checkmate", winner: "red" })).toBe(true);
    expect(isFinished({ kind: "stalemate", winner: "red" })).toBe(true);
    expect(isFinished({ kind: "perpetual_check", winner: "red" })).toBe(true);
  });
});
