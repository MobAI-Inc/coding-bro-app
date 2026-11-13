/**
 * 立直麻将：向听数。
 *
 * 用例来自 MahjongRepository/mahjong 语料（MIT，见 fixtures 头注释）。
 *
 * 向听数只服务 AI（§2.3 的启发式打法），不参与结算，所以它错了不会立刻表现为
 * 算错点数 —— 只会表现为 AI 打得很怪。这类「不会红、只会变笨」的模块最需要
 * 用例守着。
 *
 * 特别留意断言异常的那几条：向听函数会被 AI 每回合调用几十次，喂进 14 张以上
 * 或 3n 张牌时必须当场炸掉。返回一个「看着像数字」的垃圾值，会让错误一路飘到
 * 出牌决策里，再也追不回来源。
 */

import { describe, expect, it } from "vitest";
import {
  shanten,
  shantenChiitoitsu,
  shantenKokushi,
  shantenRegular,
} from "@/bro/games/riichi/logic";
import { SHANTEN_CASES } from "./fixtures/shanten";
import type { ShantenCase } from "./fixtures/shanten";

function run(c: ShantenCase, useKokushi: boolean | null): number {
  const counts = [...c.counts];
  switch (c.mode) {
    case "regular":
      return shantenRegular(counts);
    case "chiitoitsu":
      return shantenChiitoitsu(counts);
    case "kokushi":
      return shantenKokushi(counts);
    case "any":
      return useKokushi === null ? shanten(counts) : shanten(counts, { useKokushi });
  }
}

describe("riichi/shanten", () => {
  for (const c of SHANTEN_CASES) {
    if (c.throws !== null) {
      const message = c.throws;
      it(`拒绝非法输入 ${c.notation}（${message}）[${c.source}]`, () => {
        // 断言错误**内容**而不只是「抛了个错」。只断言 toThrow 的话，
        // 一个还没实现、张口就扔 not implemented 的桩函数也能让它变绿 ——
        // 移植用例阶段就踩过这个坑：全套用例里恰好只有这几条是假绿的。
        expect(() => run(c, c.useKokushi)).toThrow(message);
      });
      continue;
    }
    if (c.sameAs !== null) {
      const sameAs = c.sameAs;
      it(`${c.notation}：开关国士路径不改变结论 [${c.source}]`, () => {
        expect(run(c, c.useKokushi)).toBe(run(c, sameAs.useKokushi));
      });
      continue;
    }
    it(`${c.mode} ${c.notation} -> ${c.expected} [${c.source}]`, () => {
      expect(run(c, c.useKokushi)).toBe(c.expected);
    });
  }
});
