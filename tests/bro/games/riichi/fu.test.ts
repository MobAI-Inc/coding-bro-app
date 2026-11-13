/**
 * 立直麻将：符计算与点数表。
 *
 * 用例来自 MahjongRepository/mahjong 语料（MIT，见 fixtures 头注释）。
 *
 * 符是日麻里最琐碎、最容易被「差不多就行」糊过去的一块：少算 2 符会让 30 符
 * 变 40 符，点数直接差三分之一，但玩家很难当场看出来。所以这里除了断言总符数，
 * 还逐条断言符的**来源**（`detailsIn`）—— 只对总数会让「多算 2 符 + 少算 2 符」
 * 互相抵消后蒙混过关。
 *
 * 点数表那部分是纯查表 + 乘法，没有牌型，所以它是唯一能用穷举把边界钉死的部分：
 * 满贯线（4 番 30 符 vs 40 符）、跳满/倍满/三倍满/役满的每一档、庄家 1.5 倍、
 * 自摸时闲家与庄家的两种付法、本场棒与立直棒的加法。
 */

import { describe, expect, it } from "vitest";
import { calculateFu, calculateScores } from "@/bro/games/riichi/logic";
import type { FuDetail, WinContext } from "@/bro/games/riichi/logic";
import { FU_CASES } from "./fixtures/fu";
import { SCORE_CASES } from "./fixtures/score";
import { toContext, toMelds } from "./support";

function has(details: readonly FuDetail[], want: { fu: number; reason: string }): boolean {
  return details.some((d) => d.fu === want.fu && d.reason === want.reason);
}

describe("riichi/fu", () => {
  for (const c of FU_CASES) {
    it(`${c.notation} 和 ${c.winTile}（听 ${c.winGroup.join("/")}）-> ${c.expectedFu ?? "?"} 符 [${c.source}]`, () => {
      const context: WinContext = toContext(c.config);
      const result = calculateFu({
        division: c.division,
        winTile: c.winTile,
        winGroup: c.winGroup,
        melds: toMelds(c.melds),
        valuedTiles: c.valuedTiles,
        context,
      });
      if (c.expectedFu !== null) {
        expect(result.fu).toBe(c.expectedFu);
      }
      if (c.expectedDetailCount !== null) {
        expect(result.details).toHaveLength(c.expectedDetailCount);
      }
      for (const want of c.detailsIn) {
        expect(has(result.details, want)).toBe(true);
      }
      for (const want of c.detailsNotIn) {
        expect(has(result.details, want)).toBe(false);
      }
    });
  }
});

describe("riichi/score", () => {
  for (const c of SCORE_CASES) {
    const who = c.config.playerWind === 27 ? "庄" : "闲";
    const how = c.config.isTsumo ? "自摸" : "荣和";
    it(`${who}${how} ${c.han} 番 ${c.fu} 符 -> ${c.field}=${c.expected} [${c.source}]`, () => {
      const result = calculateScores(c.han, c.fu, toContext(c.config), c.isYakuman);
      expect(result[c.field]).toBe(c.expected);
    });
  }
});
