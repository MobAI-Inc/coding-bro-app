/**
 * 立直麻将：和牌判定与手牌拆解。
 *
 * 用例全部来自 MahjongRepository/mahjong 语料（MIT，见 fixtures 头注释）。
 * 这两块是整条链路的地基：拆错一个面子，后面的役、符、番、点全错，而且错得
 * 很像对的 —— 所以先在这里把它钉死。
 *
 * 反例比正例更重要，它们覆盖三类「实现漏一个判断也能跑通大部分对局」的坑：
 *   - 张数凑够但雀头对不上；
 *   - 五张/六张同种牌（牌山里不存在）必须判否而不是崩溃或算出结果；
 *   - 有副露时，暗手面子数 + 副露数必须恰好为 4。
 */

import { describe, expect, it } from "vitest";
import { divideHand, isAgari } from "@/bro/games/riichi/logic";
import type { Division } from "@/bro/games/riichi/logic";
import { AGARI_CASES } from "./fixtures/agari";
import { DIVIDE_CASES } from "./fixtures/divide";

/** 把一种拆法规约成可比较的字符串，用于按集合比较（拆法顺序不参与断言）。 */
function keyOf(division: Division): string {
  return division
    .map((group) => [...group].sort((a, b) => a - b).join("-"))
    .sort()
    .join("|");
}

describe("riichi/agari", () => {
  for (const c of AGARI_CASES) {
    it(`${c.expected ? "和牌" : "非和牌"}：${c.notation}${c.melds.length ? ` +${c.melds.length}副露` : ""} [${c.source}]`, () => {
      expect(isAgari([...c.counts], c.melds)).toBe(c.expected);
    });
  }
});

describe("riichi/divide", () => {
  for (const c of DIVIDE_CASES) {
    it(`拆解 ${c.notation} -> ${c.expectedCount} 种 [${c.source}]`, () => {
      const result = divideHand([...c.counts], c.melds);
      expect(result).toHaveLength(c.expectedCount);
      if (c.divisions.length > 0) {
        expect(new Set(result.map(keyOf))).toEqual(new Set(c.divisions.map(keyOf)));
      }
    });
  }
});
