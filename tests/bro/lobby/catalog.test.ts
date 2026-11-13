/**
 * 游戏目录。
 *
 * 目录是大厅、路由、扣费三处共同的事实来源，所以它的错误会同时出现在三个
 * 地方，而且看起来像三个不相干的 bug。这里守的是「表本身自洽」。
 */

import { describe, expect, it } from "vitest";
import {
  GAME_CATALOG,
  findGame,
  isEnterable,
  mergeGameEconomy,
} from "@/bro/lobby/catalog";
import type { GameId } from "@/bro/lobby/catalog";

describe("目录完整性", () => {
  it("六款游戏一个不少 — 这是产品承诺的全集", () => {
    expect(GAME_CATALOG.map((g) => g.id)).toEqual([
      "baccarat",
      "slots",
      "holdem",
      "match3",
      "blackjack",
      "gold-miner",
    ]);
  });

  it("id 唯一 — 重复的 id 会让 findGame 静默返回错的那个", () => {
    const ids = GAME_CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每款都有名称与一句话说明，且都不为空", () => {
    for (const g of GAME_CATALOG) {
      expect(g.name.trim(), `${g.id} 缺名称`).not.toBe("");
      expect(g.blurb.trim(), `${g.id} 缺说明`).not.toBe("");
    }
  });

  it("入场费为正整数 — 0 或负数会让入场变成白玩甚至送分", () => {
    for (const g of GAME_CATALOG) {
      expect(g.price, `${g.id} 入场费异常`).toBeGreaterThan(0);
      expect(Number.isInteger(g.price), `${g.id} 入场费非整数`).toBe(true);
    }
  });

  it("三款牌桌各有三个递增场次，且大厅价等于最低门槛", () => {
    for (const id of ["baccarat", "holdem", "blackjack"] as const) {
      const game = findGame(id)!;
      expect(game.rooms).toHaveLength(3);
      const prices = game.rooms!.map((room) => room.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      expect(game.price).toBe(prices[0]);
    }
  });
});

describe("字形", () => {
  it("每款一个字形，且不重复 — TUI 大厅靠它区分行", () => {
    const glyphs = GAME_CATALOG.map((g) => g.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("字形不是 emoji — UI-DESIGN.md §8 禁止 emoji 充当功能图标", () => {
    // 用 Emoji_Presentation 而不是 Emoji：`♠◆●` 都带 Emoji=Yes（它们有
    // emoji 变体），但默认按文字渲染，是可以用的。真正要拦的是 🀄🎱 这类
    // 默认就是彩色图形的字符——它们不吃 currentColor，在 TUI 里会突兀。
    for (const g of GAME_CATALOG) {
      expect(
        /\p{Emoji_Presentation}/u.test(g.glyph),
        `${g.id} 的字形 ${g.glyph} 默认按 emoji 渲染`,
      ).toBe(false);
    }
  });
});

describe("isEnterable", () => {
  it("只有 playable 能进", () => {
    expect(isEnterable({ ...GAME_CATALOG[0], status: "playable" })).toBe(true);
    expect(isEnterable({ ...GAME_CATALOG[0], status: "engine_ready" })).toBe(
      false,
    );
    expect(isEnterable({ ...GAME_CATALOG[0], status: "planned" })).toBe(false);
  });

  it("engine_ready 不算能进 — 引擎好了但没界面，点进去是空白页", () => {
    // 单独列一条是因为这是最容易被放宽的一档：写完引擎的人会觉得「能玩了」。
    // 界面没做完就是不能进，大厅上标「建设中」比放进去更诚实。
    //
    // 不指名哪一款处于这一档：象棋一度是，界面做完后就不是了。指名的话，
    // 每做完一款都要回来改这条，而改测试时最容易顺手把断言一起放宽。这里
    // 要钉的是 isEnterable 对这个 status 的判定，与是谁无关
    const entry = { ...GAME_CATALOG[0], status: "engine_ready" } as const;
    expect(isEnterable(entry)).toBe(false);
  });

  it("目录里没有 engine_ready 的残留 — 界面做完了要改 status", () => {
    // 上一条锁的是判定，这一条锁的是目录本身。engine_ready 是个中间态：
    // 引擎合并了、界面还没接。它长期挂在目录里意味着有人做完界面忘了改，
    // 那款游戏就白做了——GamesRoute.test.ts 从路由那侧盯同一件事
    //
    // 现在是空的：四款做完的都已改成 playable，剩下两款（日麻、台球）连
    // 引擎都还没开工，是 planned。以后再出现 engine_ready 就说明有一款
    // 卡在中间态没收尾
    const stuck = GAME_CATALOG.filter((g) => g.status === "engine_ready");
    expect(stuck.map((g) => g.id)).toEqual([]);
  });

  it("至少有一款能进 — 全都进不去的大厅等于没上线", () => {
    expect(GAME_CATALOG.some(isEnterable)).toBe(true);
  });
});

describe("findGame", () => {
  it("按 id 找得到", () => {
    expect(findGame("baccarat")?.name).toBe("百家乐");
    expect(findGame("gold-miner")?.name).toBe("黄金矿工");
  });

  it("找不到返回 undefined，不抛异常", () => {
    expect(findGame("nope" as GameId)).toBeUndefined();
  });
});

describe("服务端经济目录", () => {
  const serverEconomy = GAME_CATALOG.map((game, gameIndex) => ({
    id: game.id,
    entryPoints: 1_000 + gameIndex,
    rooms: (game.rooms ?? []).map((room, roomIndex) => ({
      id: room.id,
      entryPoints: 2_000 + roomIndex,
    })),
  }));

  it("生产展示价格全部取自服务端目录", () => {
    const merged = mergeGameEconomy(GAME_CATALOG, serverEconomy);
    expect(merged.map((game) => game.price)).toEqual([
      1_000, 1_001, 1_002, 1_003, 1_004, 1_005,
    ]);
    expect(
      findGame("baccarat", merged)?.rooms?.map((room) => room.price),
    ).toEqual([2_000, 2_001, 2_002]);
  });

  it("目录缺项时失败，不回退到客户端旧价格", () => {
    expect(() =>
      mergeGameEconomy(GAME_CATALOG, serverEconomy.slice(1)),
    ).toThrow(/服务端缺少 baccarat/u);
  });
});
