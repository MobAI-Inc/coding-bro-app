/**
 * 立直麻将：役的判定。
 *
 * 用例来自 MahjongRepository/mahjong 语料（MIT，见 fixtures 头注释）。
 *
 * 分两层：
 *
 * 1. `PREDICATE_CASES` —— 逐个役的正例与反例，是语料里**唯一直接点名役种**的部分。
 *    反例尤其值钱：混全带幺九与纯全带幺九共用同一批反例（`111999m11p111999s`
 *    两者都不成立），少写一个判断就会有一个变红。
 *
 * 2. `HAND_VALUE_CASES` —— 端到端估值。这里断言的役名是**我们补的**：语料只说
 *    「找到了 N 个役」，不说是哪 N 个。补役名的方式与语料的数量断言双向对齐
 *    （生成时强制校验），所以它既比语料强，又不可能悄悄与语料分家。
 */

import { describe, expect, it } from "vitest";
import { estimateHandValue, isYakuPresent } from "@/bro/games/riichi/logic";
import { divideHand } from "@/bro/games/riichi/logic";
import { PREDICATE_CASES } from "./fixtures/predicate";
import { HAND_VALUE_CASES } from "./fixtures/handValue";
import { toContext, toMelds } from "./support";

describe("riichi/yaku 单役判定", () => {
  for (const c of PREDICATE_CASES) {
    it(`${c.yaku} ${c.expected ? "成立" : "不成立"}：${c.notation} [${c.source}]`, () => {
      const melds = toMelds(c.melds);
      const meldGroups = melds.map((m) => m.tiles.map((t) => t >> 2));
      // 语义是「存在一种拆法满足该役」/「不存在任何拆法满足该役」。
      // 语料原文按拆法下标断言，那是上游实现的迭代顺序，不是规则（见 fixtures/predicate.ts）。
      const divisions = c.counts === null ? [[]] : divideHand([...c.counts], meldGroups);
      const found = divisions.some((division) =>
        isYakuPresent(c.yaku, {
          division,
          counts: c.counts === null ? [] : [...c.counts],
          melds,
          winTile: c.winTile,
          isTsumo: c.isTsumo ?? false,
          playerWind: c.playerWind,
          roundWind: null,
          isClosed: melds.every((m) => !m.opened),
        }),
      );
      expect(found).toBe(c.expected);
    });
  }
});

describe("riichi/yaku 整手估值", () => {
  for (const c of HAND_VALUE_CASES) {
    it(`${c.notation} -> ${c.expectedHan ?? "?"} 番 ${c.expectedFu ?? "?"} 符 [${c.source}]`, () => {
      const result = estimateHandValue({
        tiles: c.tiles,
        winTile: c.winTile,
        melds: toMelds(c.melds),
        doraIndicators: c.doraIndicators,
        uraDoraIndicators: c.uraDoraIndicators,
        context: toContext(c.config),
      });

      if (c.expectedError === true) {
        expect(result.error).not.toBeNull();
      } else if (c.expectedError === false) {
        expect(result.error).toBeNull();
      }
      if (c.expectedErrorCode !== null) {
        expect(result.error).toBe(c.expectedErrorCode);
      }
      if (c.expectedHan !== null) {
        expect(result.han).toBe(c.expectedHan);
      }
      if (c.expectedHanNot !== null) {
        expect(result.han).not.toBe(c.expectedHanNot);
      }
      if (c.expectedFu !== null) {
        expect(result.fu).toBe(c.expectedFu);
      }
      if (c.expectedYakuCount !== null) {
        expect(result.yaku).toHaveLength(c.expectedYakuCount);
      }
      if (c.expectedYaku !== null) {
        expect(new Set(result.yaku.map((y) => y.id))).toEqual(new Set(c.expectedYaku));
      }
      if (c.expectedFuDetailCount !== null) {
        expect(result.fuDetails).toHaveLength(c.expectedFuDetailCount);
      }
      for (const want of c.fuDetailsIn) {
        expect(result.fuDetails.some((d) => d.fu === want.fu && d.reason === want.reason)).toBe(true);
      }
      const ids = new Set(result.yaku.map((y) => y.id));
      for (const id of c.yakuIn) {
        expect(ids.has(id)).toBe(true);
      }
      for (const id of c.yakuNotIn) {
        expect(ids.has(id)).toBe(false);
      }
      if (c.expectedMain !== null) {
        expect(result.cost?.main).toBe(c.expectedMain);
      }
      if (c.expectedAdditional !== null) {
        expect(result.cost?.additional).toBe(c.expectedAdditional);
      }
    });
  }
});
