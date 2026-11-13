/**
 * 立直麻将渲染层与服务端测试。
 *
 * 分工同其余五款：规则本身在 riichi-round.test.ts，这里测的是
 * **传输与呈现的约定**。
 *
 * 但麻将比另外五款多一条只有它才有的约束：**下发要按座位裁剪**。围棋、象棋、
 * 台球是完全信息博弈，把整个棋盘发给所有人没有任何损失；麻将不是。三家手牌、
 * 整条牌山、里宝牌指示牌一旦下发，抓个包就能看见所有人的底牌。所以本文件里
 * 「快照里不能出现什么」的断言，和「快照里应该有什么」一样重要。
 */

import { describe, expect, it, vi } from "vitest";
import {
  computeTableLayout,
  handTileRect,
  hitTestHand,
  labelOf,
  pondTileRect,
  tileGlyph,
  tileLabel,
} from "@/bro/games/riichi/render/layout";
import {
  renderHand,
  renderPond,
  renderResult,
  renderScores,
  renderStatusBar,
  renderTable,
  renderWaits,
} from "@/bro/games/riichi/render/tui-text";
import { TuiRiichiRenderer } from "@/bro/games/riichi/render/tui";
import { CanvasRiichiRenderer } from "@/bro/games/riichi/render/canvas";
import { REJECT_TEXT } from "@/bro/games/riichi/RiichiGame";
import { LocalRiichiServer } from "@/bro/games/riichi/server/local";
import type { Rejection } from "@/bro/games/riichi/server/local";
import { GameSession } from "@/bro/games/core/session";
import { canAct } from "@/bro/games/core/types";
import type { InputIntent } from "@/bro/games/core/types";
import { CHUN, EAST, HAKU, HATSU, toTile34 } from "@/bro/games/riichi/logic";
import type { RiichiSnapshot, RiichiView } from "@/bro/games/riichi/view";
import { RIICHI_INTENT } from "@/bro/games/riichi/view";

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

/** 起一个本地服务端，记录全部下发与拒绝。 */
function serve(options: { seed?: number } = {}) {
  const snapshots: RiichiSnapshot[] = [];
  const rejections: Rejection[] = [];
  const server = new LocalRiichiServer({
    seed: options.seed ?? 7,
    matchId: "m1",
    mySeat: 0,
    onSnapshot: (s) => snapshots.push(s),
    onReject: (r) => rejections.push(r),
  });
  server.start();
  return { server, snapshots, rejections, latest: () => snapshots.at(-1)! };
}

/** 按当前快照构造一条打牌意图。缺省打手上最后一张。 */
function discardIntent(
  latest: RiichiSnapshot,
  tile?: number,
  riichi = false,
): InputIntent {
  const hand = latest.board.self.hand;
  return {
    matchId: latest.matchId,
    basedOnVersion: latest.version,
    type: RIICHI_INTENT.discard,
    payload: { tile: tile ?? hand[hand.length - 1], riichi },
  };
}

/**
 * 一路打到某个条件成立为止。返回停下时的快照。
 *
 * 每步都打手上最后一张 —— 不求打得好，只求把对局推进到需要的局面。
 */
function playUntil(
  ctx: ReturnType<typeof serve>,
  done: (s: RiichiSnapshot) => boolean,
  maxSteps = 60,
): RiichiSnapshot | null {
  for (let i = 0; i < maxSteps; i += 1) {
    const cur = ctx.latest();
    if (done(cur)) return cur;
    if (cur.phase === "finished") return null;
    if (!canAct(cur)) return null;
    ctx.server.submit(discardIntent(cur));
  }
  return null;
}

/** 造一份最小可用视图。只填断言要用的字段，其余取无害默认。 */
function viewOf(over: Partial<RiichiView> = {}): RiichiView {
  return {
    self: {
      seat: 0,
      hand: [0, 4, 8],
      melds: [],
      discards: [],
      points: 25000,
      riichi: false,
      drawn: null,
      canTsumo: false,
      canRon: false,
      canRiichi: false,
      tenpaiDiscards: [],
      waits: [],
      furiten: false,
      ...over.self,
    },
    opponents: over.opponents ?? [
      { seat: 1, handCount: 13, melds: [], discards: [], points: 25000, riichi: false },
      { seat: 2, handCount: 13, melds: [], discards: [], points: 25000, riichi: false },
      { seat: 3, handCount: 13, melds: [], discards: [], points: 25000, riichi: false },
    ],
    doraIndicators: over.doraIndicators ?? [0],
    wallRemaining: over.wallRemaining ?? 70,
    roundWind: over.roundWind ?? EAST,
    dealer: over.dealer ?? 0,
    honba: over.honba ?? 0,
    riichiSticks: over.riichiSticks ?? 0,
    lastDiscard: over.lastDiscard ?? null,
    result: over.result ?? null,
    uraDoraIndicators: over.uraDoraIndicators ?? [],
  };
}

function snapshotOf(view: RiichiView, over: Partial<RiichiSnapshot> = {}): RiichiSnapshot {
  return {
    matchId: "m1",
    gameId: "riichi",
    phase: "playing",
    version: 1,
    activeSeat: 0,
    mySeat: 0,
    board: view,
    ...over,
  };
}

/**
 * 一帧快照里出现的全部**牌号**。
 *
 * 只收真正装牌的字段，不做全 JSON 文本搜索 —— 牌号是 0..135 的小整数，
 * `honba`、`points`、`version` 里的数字都能撞上，文本搜法会把无关字段
 * 误报成泄漏，那种测试红了也没人信。
 */
function tilesIn(snapshot: RiichiSnapshot): Set<number> {
  const v = snapshot.board;
  const out = new Set<number>([
    ...v.self.hand,
    ...v.self.discards,
    ...v.self.melds.flatMap((m) => m.tiles),
    ...v.doraIndicators,
    ...v.uraDoraIndicators,
    ...(v.lastDiscard ? [v.lastDiscard.tile] : []),
    ...(v.self.drawn !== null ? [v.self.drawn] : []),
  ]);
  for (const o of v.opponents) {
    for (const t of o.discards) out.add(t);
    for (const m of o.melds) for (const t of m.tiles) out.add(t);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 裁剪 —— 这一节是本文件存在的首要理由
 * ------------------------------------------------------------------ */

describe("按座位裁剪", () => {
  it("对手视图只给张数，不给牌", () => {
    const { latest } = serve();
    for (const o of latest().board.opponents) {
      expect(o).not.toHaveProperty("hand");
      expect(o.handCount).toBe(13);
    }
  });

  it("整局下发的任何一帧里都不含对手的牌 —— 抓包看不到别人底牌", () => {
    // 逐帧扫全部下发内容，而不是只看首帧：裁剪漏在某个分支上（比如终局那帧
    // 把权威状态整个塞进去）是最典型的写法，只测首帧抓不到。
    //
    // 按字段收集而不是在 JSON 里搜数字：牌号是 0..135 的小整数，`honba: 0`、
    // `points` 里的位数都能撞上，字符串搜法会把一堆无关字段报成泄漏。
    const ctx = serve();
    playUntil(ctx, (s) => s.phase === "finished");

    const authoritative = ctx.server.authoritativeState();
    for (const [i, snapshot] of ctx.snapshots.entries()) {
      const shown = tilesIn(snapshot);
      for (const seat of [1, 2, 3] as const) {
        const p = authoritative.players[seat];
        // 打出去的牌在牌河里是正常的，副露也是明的。只有仍在手上的才是秘密
        const open = new Set<number>([...p.discards, ...p.melds.flatMap((m) => m.tiles)]);
        for (const tile of p.hand) {
          if (open.has(tile)) continue;
          expect(shown.has(tile), `第 ${i} 帧泄漏了 seat${seat} 的手牌 ${tile}`).toBe(false);
        }
      }
    }
  });

  it("牌山不下发，只给剩余张数", () => {
    const { latest, server } = serve();
    expect(latest().board).not.toHaveProperty("wall");
    expect(latest().board.wallRemaining).toBe(server.authoritativeState().wall.length);
  });

  it("对局中不给里宝牌 —— 提前给出去，立直的人就能提前算出打点", () => {
    const { latest } = serve();
    expect(latest().board.uraDoraIndicators).toHaveLength(0);
  });

  it("终局才给里宝牌", () => {
    const ctx = serve();
    const end = playUntil(ctx, (s) => s.phase === "finished");
    expect(end).not.toBeNull();
    expect(end!.board.uraDoraIndicators.length).toBeGreaterThan(0);
  });

  it("宝牌指示牌按已翻开的张数给，不是整条王牌", () => {
    const { latest, server } = serve();
    const state = server.authoritativeState();
    expect(latest().board.doraIndicators).toHaveLength(state.doraRevealed);
    expect(latest().board.doraIndicators.length).toBeLessThan(state.deadWall.length);
  });
});

/* ------------------------------------------------------------------ *
 * 服务端约定
 * ------------------------------------------------------------------ */

describe("开局快照", () => {
  it("start 下发首帧：14 张手牌、版本 0、轮到自己", () => {
    const { snapshots } = serve();
    expect(snapshots).toHaveLength(1);
    const first = snapshots[0];
    expect(first.version).toBe(0);
    expect(first.gameId).toBe("riichi");
    expect(first.phase).toBe("playing");
    expect(first.mySeat).toBe(0);
    // 座位 0 是庄家，开局就该他打
    expect(first.activeSeat).toBe(0);
    expect(first.board.self.hand).toHaveLength(14);
  });

  it("首帧就带上刚摸的那张 —— 界面靠它把摸牌单独挪开", () => {
    const { snapshots } = serve();
    expect(snapshots[0].board.self.drawn).not.toBeNull();
    expect(snapshots[0].board.self.hand).toContain(snapshots[0].board.self.drawn!);
  });

  it("非庄家开局时先把机器人推到自己该动为止", () => {
    const snapshots: RiichiSnapshot[] = [];
    const server = new LocalRiichiServer({
      seed: 7,
      matchId: "m1",
      mySeat: 2,
      dealer: 0,
      onSnapshot: (s) => snapshots.push(s),
    });
    server.start();
    // 只下发一帧：机器人那几步是同一个「开局」的后果，分开发会像卡顿
    expect(snapshots).toHaveLength(1);
    const first = snapshots[0];
    expect(first.mySeat).toBe(2);
    expect(canAct(first) || first.board.self.canRon).toBe(true);
  });
});

describe("打牌", () => {
  it("合法打牌推进版本并下发新快照", () => {
    const ctx = serve();
    const before = ctx.latest();
    const tile = before.board.self.hand[0];
    ctx.server.submit(discardIntent(before, tile));

    expect(ctx.snapshots.length).toBeGreaterThan(1);
    expect(ctx.latest().version).toBe(1);
    expect(ctx.latest().board.self.discards).toContain(tile);
  });

  it("一次 submit 只加一个版本，机器人那几步不各发一帧", () => {
    const ctx = serve();
    const before = ctx.snapshots.length;
    ctx.server.submit(discardIntent(ctx.latest()));
    expect(ctx.snapshots).toHaveLength(before + 1);
    expect(ctx.latest().version).toBe(1);
  });

  it("打完一轮回到自己时手上又是 14 张", () => {
    const ctx = serve();
    ctx.server.submit(discardIntent(ctx.latest()));
    const cur = ctx.latest();
    if (cur.phase !== "finished" && canAct(cur) && !cur.board.self.canRon) {
      expect(cur.board.self.hand).toHaveLength(14);
    }
  });
});

describe("拒绝路径 —— 每条都不得推进版本", () => {
  function expectRejected(
    ctx: ReturnType<typeof serve>,
    before: { count: number; version: number },
    reason: string,
  ) {
    expect(ctx.rejections.at(-1)?.reason).toBe(reason);
    expect(ctx.snapshots).toHaveLength(before.count);
    expect(ctx.latest().version).toBe(before.version);
  }

  function mark(ctx: ReturnType<typeof serve>) {
    return { count: ctx.snapshots.length, version: ctx.latest().version };
  }

  it("被拒之后客户端仍与服务端同步 —— 版本悄悄前进会让此后每一手都被误判为过期", () => {
    // 这是「拒绝不推进版本」唯一能被观测到的后果。少了这条，往拒绝分支里
    // 偷偷加一句 version += 1 没有任何测试会发现
    const ctx = serve();
    const synced = ctx.latest();
    // 打一张不在手上的牌
    const absent = [...Array(136).keys()].find((t) => !synced.board.self.hand.includes(t))!;
    ctx.server.submit(discardIntent(synced, absent));
    expect(ctx.rejections.at(-1)?.reason).toBe("tile_not_in_hand");

    // 仍用被拒前那份快照的版本号继续打，必须被接受
    const tile = synced.board.self.hand[0];
    ctx.server.submit(discardIntent(synced, tile));
    expect(ctx.latest().board.self.discards).toContain(tile);
    expect(ctx.latest().version).toBe(synced.version + 1);
  });

  it("过期版本被拒", () => {
    const ctx = serve();
    const stale = discardIntent(ctx.latest());
    ctx.server.submit(discardIntent(ctx.latest(), ctx.latest().board.self.hand[0]));
    const before = mark(ctx);
    ctx.server.submit(stale);
    expectRejected(ctx, before, "stale_version");
  });

  it("超前版本同样被拒 —— 不能只挡「旧」，伪造新版本也要挡", () => {
    const ctx = serve();
    const before = mark(ctx);
    ctx.server.submit({ ...discardIntent(ctx.latest()), basedOnVersion: 99 });
    expectRejected(ctx, before, "stale_version");
  });

  it("别局的意图被拒 —— 快照串台比打错牌更难查", () => {
    const ctx = serve();
    const before = mark(ctx);
    ctx.server.submit({ ...discardIntent(ctx.latest()), matchId: "other" });
    expectRejected(ctx, before, "wrong_match");
  });

  it("未知意图被拒，而不是被当成打牌", () => {
    const ctx = serve();
    const before = mark(ctx);
    const hand = [...ctx.latest().board.self.hand];
    ctx.server.submit({ ...discardIntent(ctx.latest()), type: "riichi/chi" });
    expectRejected(ctx, before, "unknown_intent");
    expect(ctx.latest().board.self.hand).toEqual(hand);
  });

  it("打不在手上的牌被拒", () => {
    const ctx = serve();
    const before = mark(ctx);
    const absent = [...Array(136).keys()].find(
      (t) => !ctx.latest().board.self.hand.includes(t),
    )!;
    ctx.server.submit(discardIntent(ctx.latest(), absent));
    expectRejected(ctx, before, "tile_not_in_hand");
  });

  it("没听牌却宣立直被拒，且不扣立直棒", () => {
    const ctx = serve();
    const before = mark(ctx);
    const points = ctx.latest().board.self.points;
    // 开局手牌基本不可能一打就听，直接拿第一张宣立直
    ctx.server.submit(discardIntent(ctx.latest(), ctx.latest().board.self.hand[0], true));
    expectRejected(ctx, before, "not_tenpai");
    expect(ctx.latest().board.self.points).toBe(points);
  });

  it("没牌可荣时宣荣被拒", () => {
    const ctx = serve();
    const before = mark(ctx);
    ctx.server.submit({
      ...discardIntent(ctx.latest()),
      type: RIICHI_INTENT.ron,
      payload: {},
    });
    // 开局阶段是 awaiting_discard，荣和只在 awaiting_call 有效
    expectRejected(ctx, before, "wrong_phase");
  });

  it("手牌没和却宣自摸被拒", () => {
    const ctx = serve();
    const before = mark(ctx);
    ctx.server.submit({
      ...discardIntent(ctx.latest()),
      type: RIICHI_INTENT.tsumo,
      payload: {},
    });
    expectRejected(ctx, before, "not_winning_hand");
  });

  it("终局后再提交被拒", () => {
    const ctx = serve();
    const end = playUntil(ctx, (s) => s.phase === "finished");
    expect(end).not.toBeNull();
    const before = mark(ctx);
    ctx.server.submit({
      matchId: "m1",
      basedOnVersion: end!.version,
      type: RIICHI_INTENT.discard,
      payload: { tile: 0 },
    });
    expectRejected(ctx, before, "round_over");
  });

  it("界面文案表覆盖服务端会回的全部标识", () => {
    // 漏一条的表现是界面上蹦出一句英文 riichi_no_points
    for (const reason of [
      "wrong_match",
      "stale_version",
      "unknown_intent",
      "not_your_turn",
      "wrong_phase",
      "tile_not_in_hand",
      "round_over",
      "riichi_not_closed",
      "riichi_already",
      "riichi_no_points",
      "not_tenpai",
      "furiten",
      "no_yaku",
      "not_winning_hand",
      "nothing_to_call",
    ]) {
      expect(REJECT_TEXT[reason], `缺 ${reason} 的中文文案`).toBeTruthy();
    }
  });
});

describe("荣和时的可操作性", () => {
  // 探针实测：seed 30 在第 16 手时人类能荣
  const RON_SEED = 30;

  it("轮到别人打牌但自己能荣时，activeSeat 指向自己 —— 否则「荣」按钮会被灰掉", () => {
    const ctx = serve({ seed: RON_SEED });
    const at = playUntil(ctx, (s) => s.board.self.canRon, 40);
    expect(at, `seed ${RON_SEED} 没走到能荣的局面`).not.toBeNull();
    expect(at!.activeSeat).toBe(0);
    expect(canAct(at!)).toBe(true);
  });

  it("荣和成功后终局，结算里自己是和了者", () => {
    const ctx = serve({ seed: RON_SEED });
    const at = playUntil(ctx, (s) => s.board.self.canRon, 40);
    expect(at).not.toBeNull();
    ctx.server.submit({
      matchId: "m1",
      basedOnVersion: at!.version,
      type: RIICHI_INTENT.ron,
      payload: {},
    });
    const end = ctx.latest();
    expect(end.phase).toBe("finished");
    expect(end.activeSeat).toBeNull();
    expect(end.board.result?.winner).toBe(0);
    expect(end.board.result?.reason).toBe("ron");
    expect(canAct(end)).toBe(false);
  });

  it("放弃响应不会误判成和了，对局继续往下走", () => {
    // 「放过一次能和的牌就吃同巡振听」这条规则本身在 riichi-round.test.ts 里测。
    // 这里测不了它：`passCall` 会立刻给下家摸牌，而摸牌解除同巡振听，等
    // advanceBots 把控制权还回来时人类早已摸过一轮，标记必然是清的。硬去断言
    // 那个标记只会写出一条永远为假的期望
    const ctx = serve({ seed: RON_SEED });
    const at = playUntil(ctx, (s) => s.board.self.canRon, 40);
    expect(at).not.toBeNull();
    ctx.server.submit({
      matchId: "m1",
      basedOnVersion: at!.version,
      type: RIICHI_INTENT.pass,
      payload: {},
    });
    const after = ctx.latest();
    expect(after.version).toBe(at!.version + 1);
    expect(after.board.result?.winner).not.toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 布局几何
 * ------------------------------------------------------------------ */

describe("布局几何", () => {
  it("容器非正方时取短边 —— 拉伸的牌桌会让上下家牌河一个挤一个空", () => {
    const wide = computeTableLayout(800, 400);
    const tall = computeTableLayout(400, 800);
    expect(wide.size).toBe(400);
    expect(tall.size).toBe(400);
    expect(wide.tileW).toBe(tall.tileW);
  });

  it("零尺寸容器不产生 NaN —— 首帧挂载时容器常常还没量出尺寸", () => {
    const layout = computeTableLayout(0, 0);
    for (const value of Object.values(layout)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    const rect = handTileRect(layout, 0, 14, true);
    expect(Number.isFinite(rect.x) && Number.isFinite(rect.w)).toBe(true);
  });

  it("14 张手牌加摸牌间隔仍在台面内 —— 排不下就会有牌被裁掉", () => {
    const layout = computeTableLayout(600, 600);
    const first = handTileRect(layout, 0, 14, true);
    const last = handTileRect(layout, 13, 14, true);
    expect(first.x).toBeGreaterThanOrEqual(layout.originX);
    expect(last.x + last.w).toBeLessThanOrEqual(layout.originX + layout.size + 0.001);
  });

  it("摸到的那张单独挪开 —— 玩家靠这个一眼分辨哪张是刚摸的", () => {
    const layout = computeTableLayout(600, 600);
    const withDraw = handTileRect(layout, 13, 14, true);
    const without = handTileRect(layout, 13, 14, false);
    expect(withDraw.x - without.x).toBeGreaterThan(0);
  });

  it("hitTest 是 handTileRect 的严格反函数 —— 逐张逐张数验证", () => {
    // 「点 3 万打出去 4 万」只在特定张数下复现，所以张数与摸牌状态全遍历
    const layout = computeTableLayout(600, 600);
    for (const count of [1, 2, 7, 13, 14]) {
      for (const hasDrawn of [false, true]) {
        for (let i = 0; i < count; i += 1) {
          const r = handTileRect(layout, i, count, hasDrawn);
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          expect(
            hitTestHand(layout, cx, cy, count, hasDrawn),
            `count=${count} drawn=${hasDrawn} i=${i}`,
          ).toBe(i);
        }
      }
    }
  });

  it("点在手牌行外面返回 null，不吞掉点击", () => {
    const layout = computeTableLayout(600, 600);
    expect(hitTestHand(layout, 300, 10, 14, true)).toBeNull();
    expect(hitTestHand(layout, -50, layout.handY + 5, 14, true)).toBeNull();
  });

  it("四家牌河互不重叠 —— 叠在一起就分不清谁打的", () => {
    const layout = computeTableLayout(600, 600);
    const rects = [0, 1, 2, 3].flatMap((rel) =>
      Array.from({ length: 12 }, (_, i) => pondTileRect(layout, rel, i)),
    );
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const overlap =
          rects[a].x < rects[b].x + rects[b].w - 0.001 &&
          rects[b].x < rects[a].x + rects[a].w - 0.001 &&
          rects[a].y < rects[b].y + rects[b].h - 0.001 &&
          rects[b].y < rects[a].y + rects[a].h - 0.001;
        expect(overlap, `第 ${a} 与第 ${b} 张重叠`).toBe(false);
      }
    }
  });

  it("自己的牌河在下、对家在上 —— 位置搞反等于把牌河张冠李戴", () => {
    const layout = computeTableLayout(600, 600);
    const cy = layout.originY + layout.size / 2;
    expect(pondTileRect(layout, 0, 0).y).toBeGreaterThan(cy);
    expect(pondTileRect(layout, 2, 0).y).toBeLessThan(cy);
    const cx = layout.originX + layout.size / 2;
    expect(pondTileRect(layout, 1, 0).x).toBeGreaterThan(cx);
    expect(pondTileRect(layout, 3, 0).x).toBeLessThan(cx);
  });
});

/* ------------------------------------------------------------------ *
 * 牌面文字
 * ------------------------------------------------------------------ */

describe("牌面文字", () => {
  it("数牌从 1 起算 —— 用 rankOf 原值会把 1 万写成 0m，而 0m 是赤 5 万", () => {
    expect(tileLabel(0)).toBe("1m");
    expect(tileLabel(8)).toBe("9m");
    expect(tileLabel(9)).toBe("1p");
    expect(tileLabel(18)).toBe("1s");
    expect(tileLabel(26)).toBe("9s");
  });

  it("字牌用汉字，顺序是东南西北白发中", () => {
    expect(tileLabel(27)).toBe("东");
    expect(tileLabel(30)).toBe("北");
    expect(tileLabel(HAKU)).toBe("白");
    expect(tileLabel(HATSU)).toBe("发");
    expect(tileLabel(CHUN)).toBe("中");
  });

  it("34 种牌的短记法互不相同 —— 撞车就等于两种牌长得一样", () => {
    const labels = Array.from({ length: 34 }, (_, i) => tileLabel(i));
    expect(new Set(labels).size).toBe(34);
  });

  it("赤 5 写成 0m/0p/0s —— 它多算一番，看不出来等于少算打点", () => {
    for (const [tile, text] of [
      [16, "0m"],
      [52, "0p"],
      [88, "0s"],
    ] as const) {
      expect(labelOf(tile)).toBe(text);
    }
    // 同一种牌的非赤那三张仍是普通记法
    expect(labelOf(17)).toBe("5m");
  });

  it("labelOf 与 tileLabel 对非赤牌一致", () => {
    for (let t = 0; t < 136; t += 1) {
      if ([16, 52, 88].includes(t)) continue;
      expect(labelOf(t)).toBe(tileLabel(toTile34(t)));
    }
  });

  it("Unicode 麻将字符里三元牌顺序是反的 —— 顺着加会把白板画成红中", () => {
    expect(tileGlyph(CHUN)).toBe("\u{1F004}");
    expect(tileGlyph(HATSU)).toBe("\u{1F005}");
    expect(tileGlyph(HAKU)).toBe("\u{1F006}");
  });

  it("34 种牌的 Unicode 字符互不相同", () => {
    const glyphs = Array.from({ length: 34 }, (_, i) => tileGlyph(i));
    expect(new Set(glyphs).size).toBe(34);
  });
});

/* ------------------------------------------------------------------ *
 * TUI 字符排版
 * ------------------------------------------------------------------ */

describe("TUI 字符排版", () => {
  it("牌河按 6 张一行折行", () => {
    const discards = Array.from({ length: 13 }, (_, i) => i * 4);
    const lines = renderPond(discards).split("\n");
    expect(lines).toHaveLength(3);
  });

  it("牌河每行宽度一致 —— 长短不齐会让整个牌河错位", () => {
    // 混数牌与字牌：汉字是全角，宽度补偿写错的话这里就会露馅
    const discards = [0, 4, 108, 112, 116, 120, 8, 12, 124, 128, 132, 16];
    const lines = renderPond(discards).split("\n");
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  it("空牌河渲染成空串，让调用方能整块省掉", () => {
    expect(renderPond([])).toBe("");
  });

  it("立直宣告牌标出来 —— 字符界面转不了 90°，但这条信息不能省", () => {
    const discards = [0, 4, 8];
    expect(renderPond(discards, 1)).toContain("*");
    expect(renderPond(discards)).not.toContain("*");
  });

  it("选中的那张用方括号框住", () => {
    const hand = [0, 4, 8]; // 实体牌号 /4 得牌种：0→1m、4→2m、8→3m
    expect(renderHand(hand, { selected: 1 })).toContain("[2m]");
    expect(renderHand(hand)).not.toContain("[");
  });

  it("没听牌时听牌提示是空串，不留一行「听：」", () => {
    expect(renderWaits([])).toBe("");
    expect(renderWaits([0, 9])).toContain("1m");
  });

  it("四家点数各一行，庄家标出来", () => {
    const lines = renderScores(viewOf({ dealer: 0 })).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("(庄)");
    expect(lines[1]).not.toContain("(庄)");
  });

  it("立直的人后面标 R", () => {
    const view = viewOf({
      opponents: [
        { seat: 1, handCount: 13, melds: [], discards: [], points: 24000, riichi: true },
        { seat: 2, handCount: 13, melds: [], discards: [], points: 25000, riichi: false },
        { seat: 3, handCount: 13, melds: [], discards: [], points: 25000, riichi: false },
      ],
    });
    const lines = renderScores(view).split("\n");
    expect(lines[1]).toContain("R");
    expect(lines[2]).not.toContain("R");
  });
});

describe("TUI 状态栏", () => {
  it("轮不到你时不列出打牌快捷键 —— 列了就是骗人", () => {
    const bar = renderStatusBar(viewOf(), false);
    expect(bar).not.toContain("Enter");
    expect(bar).toContain("等待");
  });

  it("轮到你时列出选牌与打出", () => {
    const bar = renderStatusBar(viewOf(), true);
    expect(bar).toContain("Enter");
    expect(bar).toContain("h/l");
  });

  it("不能立直时不列 R —— 列了按下去只会得到一句拒绝", () => {
    expect(renderStatusBar(viewOf(), true)).not.toContain("R 立直");
    const can = viewOf({ self: { ...viewOf().self, canRiichi: true } });
    expect(renderStatusBar(can, true)).toContain("R 立直");
  });

  it("能荣时列出荣与放弃，且不列打牌 —— 此刻轮的不是你的打牌权", () => {
    const view = viewOf({ self: { ...viewOf().self, canRon: true } });
    const bar = renderStatusBar(view, true);
    expect(bar).toContain("r 荣和");
    expect(bar).toContain("p 放弃");
    expect(bar).not.toContain("Enter");
  });

  it("振听要显式标出来 —— 玩家不知道自己振听时会以为程序坏了", () => {
    const view = viewOf({ self: { ...viewOf().self, furiten: true } });
    expect(renderStatusBar(view, true)).toContain("振听");
    expect(renderStatusBar(viewOf(), true)).not.toContain("振听");
  });

  it("终局只显示结果，不再列对局操作", () => {
    const view = viewOf({
      result: {
        reason: "exhaustive_draw",
        winner: null,
        loser: null,
        han: 0,
        fu: 0,
        yaku: [],
        deltas: [0, 0, 0, 0],
      },
    });
    const bar = renderStatusBar(view, false);
    expect(bar).toContain("荒牌流局");
    expect(bar).not.toContain("Enter");
  });
});

describe("TUI 结算", () => {
  const WIN = viewOf({
    self: { ...viewOf().self, riichi: true },
    uraDoraIndicators: [0],
    result: {
      reason: "ron",
      winner: 0,
      loser: 2,
      han: 3,
      fu: 40,
      yaku: [
        { id: "riichi", han: 1 },
        { id: "pinfu", han: 1 },
      ],
      deltas: [5200, 0, -5200, 0],
    },
  });

  it("正数点数变动显式带 +：`3000` 与 `-3000` 只差一个字符，看错方向很致命", () => {
    const text = renderResult(WIN);
    expect(text).toContain("+5200");
    expect(text).toContain("-5200");
  });

  it("列出每个役与总番符", () => {
    const text = renderResult(WIN);
    expect(text).toContain("riichi");
    expect(text).toContain("pinfu");
    expect(text).toContain("3番 40符");
  });

  it("立直和了才显示里宝牌", () => {
    expect(renderResult(WIN)).toContain("里宝牌");
    const noUra = { ...WIN, uraDoraIndicators: [] };
    expect(renderResult(noUra)).not.toContain("里宝牌");
  });

  it("未终局时结算是空串", () => {
    expect(renderResult(viewOf())).toBe("");
  });
});

/* ------------------------------------------------------------------ *
 * TUI 渲染器
 * ------------------------------------------------------------------ */

describe("TUI 渲染器", () => {
  function mountTui(snapshot = snapshotOf(viewOf())) {
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiRiichiRenderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    return { host, renderer, intents };
  }

  function press(host: HTMLElement, key: string) {
    host
      .querySelector(".bro-riichi-tui")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }

  it("挂载后画出整张牌桌", () => {
    const { host } = mountTui();
    const text = host.querySelector("pre")!.textContent!;
    expect(text).toContain("余牌");
    expect(text).toContain("我的牌河");
  });

  it("h/l 移动光标，Enter 打出光标那张", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8] } });
    const { host, intents } = mountTui(snapshotOf(view));
    press(host, "l");
    press(host, "Enter");
    expect(intents).toHaveLength(1);
    expect(intents[0].type).toBe(RIICHI_INTENT.discard);
    expect((intents[0].payload as { tile: number }).tile).toBe(4);
  });

  it("光标夹在手牌范围内 —— 越界后按 Enter 会打出一张不存在的牌", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8] } });
    const { host, intents } = mountTui(snapshotOf(view));
    for (let i = 0; i < 10; i += 1) press(host, "l");
    press(host, "Enter");
    expect((intents.at(-1)!.payload as { tile: number }).tile).toBe(8);

    for (let i = 0; i < 10; i += 1) press(host, "h");
    press(host, "Enter");
    expect((intents.at(-1)!.payload as { tile: number }).tile).toBe(0);
  });

  it("手牌变短后光标跟着夹回来 —— 14 张变 13 张时原光标会悬空", () => {
    const long = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8, 12, 16] } });
    const { host, renderer, intents } = mountTui(snapshotOf(long));
    for (let i = 0; i < 4; i += 1) press(host, "l"); // 光标到第 5 张

    const short = viewOf({ self: { ...viewOf().self, hand: [0, 4] } });
    renderer.render(snapshotOf(short, { version: 2 }));
    press(host, "Enter");
    expect((intents.at(-1)!.payload as { tile: number }).tile).toBe(4);
  });

  it("大写 R 才是立直 —— 小写 r 是荣和，立直不可撤销不能共用一个键", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8] } });
    const { host, intents } = mountTui(snapshotOf(view));

    press(host, "R");
    expect(intents.at(-1)!.type).toBe(RIICHI_INTENT.discard);
    expect((intents.at(-1)!.payload as { riichi: boolean }).riichi).toBe(true);

    press(host, "r");
    expect(intents.at(-1)!.type).toBe(RIICHI_INTENT.ron);
  });

  it("t 自摸、p 放弃", () => {
    const { host, intents } = mountTui();
    press(host, "t");
    expect(intents.at(-1)!.type).toBe(RIICHI_INTENT.tsumo);
    press(host, "p");
    expect(intents.at(-1)!.type).toBe(RIICHI_INTENT.pass);
  });

  it("轮不到自己时按键不上报 —— 客户端先挡一道，服务端仍然会再挡一道", () => {
    const { host, intents } = mountTui(snapshotOf(viewOf(), { activeSeat: 1 }));
    press(host, "Enter");
    press(host, "t");
    press(host, "R");
    expect(intents).toHaveLength(0);
  });

  it("意图带当前版本号 —— 不带的话服务端无从判断是否过期", () => {
    const { host, intents } = mountTui(snapshotOf(viewOf(), { version: 7 }));
    press(host, "Enter");
    expect(intents[0].basedOnVersion).toBe(7);
    expect(intents[0].matchId).toBe("m1");
  });

  it("卸载后移除 DOM 且不再上报", () => {
    const { host, renderer, intents } = mountTui();
    const root = host.querySelector(".bro-riichi-tui")!;
    renderer.unmount();
    expect(host.querySelector(".bro-riichi-tui")).toBeNull();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Canvas 渲染器
 * ------------------------------------------------------------------ */

/** 记录画了哪些牌面文字与矩形的假 2D 上下文。jsdom 不提供真的。 */
function fakeContext() {
  const texts: { text: string; x: number; y: number; color: string }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];

  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "" as CanvasTextAlign,
    textBaseline: "" as CanvasTextBaseline,
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    roundRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    fillText: (text: string, x: number, y: number) => {
      texts.push({ text, x, y, color: String(ctx.fillStyle) });
    },
  };

  return { ctx, texts, rects };
}

describe("Canvas 渲染器", () => {
  const SIDE = 600;
  const layout = computeTableLayout(SIDE, SIDE);

  function mountCanvas(snapshot = snapshotOf(viewOf())) {
    const host = document.createElement("div");
    // jsdom 不给元素真实尺寸，布局会因为 0×0 直接跳过绘制
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(host, prop, { value: SIDE, configurable: true });
    }
    document.body.append(host);

    const gfx = fakeContext();
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(gfx.ctx as unknown as CanvasRenderingContext2D);

    const renderer = new CanvasRiichiRenderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    spy.mockRestore();

    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    return { host, canvas, renderer, intents, ...gfx };
  }

  it("每张手牌都画出来 —— 画不出东西是这个文件最可能的故障", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8, 12] } });
    const { texts } = mountCanvas(snapshotOf(view));
    for (const label of ["1m", "2m", "3m", "4m"]) {
      expect(texts.some((t) => t.text === label), `没画出 ${label}`).toBe(true);
    }
  });

  it("赤 5 用红字 —— 它多算一番，看不出来等于少算打点", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [16, 17] } });
    const { texts } = mountCanvas(snapshotOf(view));
    const red = texts.find((t) => t.text === "0m");
    const plain = texts.find((t) => t.text === "5m");
    expect(red).toBeDefined();
    expect(plain).toBeDefined();
    expect(red!.color).not.toBe(plain!.color);
  });

  it("牌河也画出来，且与手牌位置不同", () => {
    const view = viewOf({
      self: { ...viewOf().self, hand: [0], discards: [72] },
    });
    const { texts } = mountCanvas(snapshotOf(view));
    const hand = texts.find((t) => t.text === "1m")!;
    const pond = texts.find((t) => t.text === "1s")!; // 72/4 = 18 = 索子第一张
    expect(pond).toBeDefined();
    expect(pond.y).toBeLessThan(hand.y);
  });

  it("点手牌上报打牌意图，牌是点中的那张", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8] } });
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    const r = handTileRect(layout, 1, 3, false);
    canvas.dispatchEvent(
      new MouseEvent("click", {
        clientX: r.x + r.w / 2,
        clientY: r.y + r.h / 2,
        bubbles: true,
      }),
    );
    expect(intents).toHaveLength(1);
    expect((intents[0].payload as { tile: number }).tile).toBe(4);
    expect(intents[0].basedOnVersion).toBe(1);
  });

  it("点空白处不上报 —— 误触打出一张牌是不可撤销的", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8] } });
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 5, clientY: 5, bubbles: true }));
    expect(intents).toHaveLength(0);
  });

  it("轮不到自己时点击不上报", () => {
    const view = viewOf({ self: { ...viewOf().self, hand: [0, 4, 8] } });
    const { canvas, intents } = mountCanvas(snapshotOf(view, { activeSeat: 1 }));
    const r = handTileRect(layout, 1, 3, false);
    canvas.dispatchEvent(
      new MouseEvent("click", {
        clientX: r.x + r.w / 2,
        clientY: r.y + r.h / 2,
        bubbles: true,
      }),
    );
    expect(intents).toHaveLength(0);
  });

  it("卸载后移除画布且不再上报", () => {
    const { host, canvas, renderer, intents } = mountCanvas();
    renderer.unmount();
    expect(host.querySelector("canvas")).toBeNull();
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 100 }));
    expect(intents).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * 整条链路
 * ------------------------------------------------------------------ */

describe("整条链路 —— 意图上报到画面更新", () => {
  it("渲染器上报 → 服务端裁定 → 会话收快照 → 渲染器重绘", () => {
    const snapshots: RiichiSnapshot[] = [];
    const server = new LocalRiichiServer({
      seed: 7,
      matchId: "m1",
      mySeat: 0,
      onSnapshot: (s) => {
        snapshots.push(s);
        session.applySnapshot(s);
      },
    });
    const session = new GameSession<RiichiView>((intent) => server.submit(intent));
    server.start();

    const state = session.currentState()!;
    const tile = state.board.self.hand[0];
    server.submit(discardIntent(state, tile));

    expect(session.currentState()!.board.self.discards).toContain(tile);
    expect(session.currentState()!.version).toBe(1);
  });

  it("被拒的意图不改变会话状态 —— 界面不因非法操作而变化", () => {
    const rejections: Rejection[] = [];
    const server = new LocalRiichiServer({
      seed: 7,
      matchId: "m1",
      mySeat: 0,
      onSnapshot: (s) => session.applySnapshot(s),
      onReject: (r) => rejections.push(r),
    });
    const session = new GameSession<RiichiView>((intent) => server.submit(intent));
    server.start();

    const before = session.currentState()!;
    server.submit({ ...discardIntent(before), basedOnVersion: 42 });

    expect(rejections).toHaveLength(1);
    expect(session.currentState()).toBe(before);
  });

  it("Canvas 换成 TUI 后牌局原样保留 —— 切主题不能重开一局", () => {
    const host = document.createElement("div");
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(host, prop, { value: 600, configurable: true });
    }
    document.body.append(host);

    const server = new LocalRiichiServer({
      seed: 7,
      matchId: "m1",
      mySeat: 0,
      onSnapshot: (s) => session.applySnapshot(s),
    });
    const session = new GameSession<RiichiView>((intent) => server.submit(intent));

    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(fakeContext().ctx as unknown as CanvasRenderingContext2D);
    session.attachRenderer(new CanvasRiichiRenderer(), host);
    server.start();

    const tile = session.currentState()!.board.self.hand[0];
    server.submit(discardIntent(session.currentState()!, tile));
    const mid = session.currentState()!;
    spy.mockRestore();

    session.attachRenderer(new TuiRiichiRenderer(), host);
    // 同一份状态，换了副皮肤
    expect(session.currentState()).toBe(mid);
    expect(host.querySelector("canvas")).toBeNull();
    expect(host.querySelector(".bro-riichi-tui")).not.toBeNull();
    expect(host.querySelector("pre")!.textContent).toContain("余牌");
  });
});

describe("整局跑通", () => {
  it("多个种子都能打到终局，不卡死也不抛错", () => {
    // 状态机一旦在某个分支上停住，界面就是永久转圈。固定种子而非随机，
    // 失败时能原样重跑
    for (const seed of [7, 30, 40, 99]) {
      const ctx = serve({ seed });
      const end = playUntil(ctx, (s) => s.phase === "finished", 80);
      const stopped = end ?? ctx.latest();
      // 要么终局，要么停在「等玩家决定荣不荣」——两者都不是卡死
      expect(
        stopped.phase === "finished" || stopped.board.self.canRon,
        `seed ${seed} 卡在 ${stopped.phase}`,
      ).toBe(true);
    }
  });

  it("终局时四家点数与场上立直棒之和恒为 10 万 —— 点棒不能凭空产生", () => {
    // 不是「增减之和为零」：立直宣告时那 1000 点先离手落到场上，没人和就
    // 留到下一局。守恒量是「四家点数 + 场上立直棒」，实测三个种子分别是
    // 100000+0、98000+2 根、99000+1 根，合计都是 10 万
    for (const seed of [7, 40, 99]) {
      const ctx = serve({ seed });
      playUntil(ctx, (s) => s.phase === "finished", 80);
      const state = ctx.server.authoritativeState();
      const points = state.players.reduce((a, p) => a + p.points, 0);
      expect(points + state.riichiSticks * 1000, `seed ${seed}`).toBe(100000);
    }
  });
});

describe("整屏渲染", () => {
  it("四家牌河与自己的手牌都出现在屏上", () => {
    const view = viewOf({
      self: { ...viewOf().self, hand: [0, 4], discards: [8] },
      opponents: [
        { seat: 1, handCount: 13, melds: [], discards: [12], points: 25000, riichi: false },
        { seat: 2, handCount: 13, melds: [], discards: [16], points: 25000, riichi: false },
        { seat: 3, handCount: 13, melds: [], discards: [20], points: 25000, riichi: false },
      ],
    });
    const text = renderTable(view, true, 0);
    expect(text).toContain("下家");
    expect(text).toContain("对家");
    expect(text).toContain("上家");
    expect(text).toContain("我的牌河");
    expect(text).toContain("[1m]");
  });

  it("对手只显示张数，不显示牌 —— TUI 那侧同样不能泄漏", () => {
    const view = viewOf();
    const text = renderTable(view, true, null);
    expect(text).toContain("(13张)");
  });
});
