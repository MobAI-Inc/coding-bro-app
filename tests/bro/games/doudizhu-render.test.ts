/**
 * 斗地主渲染层测试。
 *
 * 渲染层刻意切成四块：几何换算（layout）、选牌判定（selection）、字符排版
 * （tui-text）、DOM 与事件（canvas / tui）。前三块是纯函数，可以逐像素、逐
 * 字符地断言；只有最后一块需要 DOM。这么切不是洁癖：jsdom 里没有 2D 上下文，
 * 排布逻辑若写在 Canvas 渲染器内部，就一行都测不了。
 *
 * 本文件不测「画得好不好看」，只测会让人出错牌的东西：点击有没有落到该落
 * 的那张牌上、选中的牌抬起后还点不点得中、状态栏列出的键是不是真能按、
 * 花色有没有只靠颜色区分。
 */

import { describe, expect, it, vi } from "vitest";
import {
  CARD_ASPECT,
  cardAtPixel,
  cardRect,
  computeHandLayout,
  computeTableLayout,
} from "@/bro/games/doudizhu/render/layout";
import {
  SELECTION_TEXT,
  cardsByIds,
  checkSelection,
  patternToBeat,
  selectionHint,
} from "@/bro/games/doudizhu/render/selection";
import {
  JOKER_LABEL,
  SUIT_GLYPH,
  TURN_GLYPH,
  availableBids,
  cardLabel,
  cardsLabel,
  renderBottomLine,
  renderResultLine,
  renderSeatLine,
  renderStatusBar,
  renderTrickLine,
} from "@/bro/games/doudizhu/render/tui-text";
import { TuiDoudizhuRenderer } from "@/bro/games/doudizhu/render/tui";
import { CanvasDoudizhuRenderer } from "@/bro/games/doudizhu/render/canvas";
import { GameSession } from "@/bro/games/core/session";
import type { InputIntent } from "@/bro/games/core/types";
import type { Card } from "@/bro/games/doudizhu/logic";
import { identifyPattern, parseCards } from "@/bro/games/doudizhu/logic";
import type {
  DoudizhuSnapshot,
  DoudizhuView,
} from "@/bro/games/doudizhu/view";
import { bidOfSeat, seatOfSlot, slotOfSeat } from "@/bro/games/doudizhu/view";

const AREA = { x: 0, y: 0, width: 600, height: 200 };

/** 造一个视图。默认：出牌阶段、座位 0 是地主、自由出牌。 */
function viewOf(over: Partial<DoudizhuView> = {}): DoudizhuView {
  const hand = over.hand ?? parseCards("3 4 5 6 7");
  return {
    stage: "playing",
    hand,
    seats: [
      { seat: 0, cardsLeft: hand.length, isLandlord: true, lastAction: null },
      { seat: 1, cardsLeft: 17, isLandlord: false, lastAction: null },
      { seat: 2, cardsLeft: 17, isLandlord: false, lastAction: null },
    ],
    landlord: 0,
    bid: 2,
    bottom: { count: 3, cards: parseCards("K K K") },
    toBeat: null,
    bids: [2, 0, 0],
    firstBidder: 0,
    bombs: 0,
    rocket: false,
    multiplier: 2,
    result: null,
    ...over,
  };
}

function snapshotOf(
  view: DoudizhuView,
  over: Partial<DoudizhuSnapshot> = {},
): DoudizhuSnapshot {
  return {
    matchId: "m1",
    gameId: "doudizhu",
    phase: "playing",
    version: 1,
    activeSeat: 0,
    mySeat: 0,
    board: view,
    ...over,
  };
}

/* ============================================================
   几何
   ============================================================ */

describe("手牌排布", () => {
  it("整排不超出给定区域 — 溢出的牌点不到，玩家以为最后几张不能选", () => {
    for (const count of [1, 5, 17, 20]) {
      const layout = computeHandLayout(count, AREA);
      const first = cardRect(layout, 0);
      const last = cardRect(layout, count - 1);
      expect(first.x, `${count} 张的左边缘`).toBeGreaterThanOrEqual(AREA.x);
      expect(last.x + last.width, `${count} 张的右边缘`).toBeLessThanOrEqual(
        AREA.x + AREA.width + 1e-6,
      );
    }
  });

  it("牌多时压缩间距而不是缩牌 — 认牌靠的是露出来的那一条", () => {
    const few = computeHandLayout(5, AREA);
    const many = computeHandLayout(20, AREA);
    expect(many.step).toBeLessThan(few.step);
    expect(many.cardWidth).toBe(few.cardWidth);
  });

  it("给抬起留出空间 — 否则选中的牌被裁掉印点数的那一头", () => {
    const layout = computeHandLayout(5, AREA);
    expect(layout.lift).toBeGreaterThan(0);
    const raised = cardRect(layout, 0, true);
    expect(raised.y).toBeGreaterThanOrEqual(AREA.y);
    expect(layout.baseY + layout.cardHeight).toBeLessThanOrEqual(
      AREA.y + AREA.height + 1e-6,
    );
  });

  it("整排水平居中", () => {
    const layout = computeHandLayout(5, AREA);
    const first = cardRect(layout, 0);
    const last = cardRect(layout, 4);
    const leading = first.x - AREA.x;
    const trailing = AREA.x + AREA.width - (last.x + last.width);
    expect(leading).toBeCloseTo(trailing, 6);
  });

  it("牌面比例接近实体扑克，不会被压扁", () => {
    const layout = computeHandLayout(10, AREA);
    expect(layout.cardHeight / layout.cardWidth).toBeCloseTo(CARD_ASPECT, 6);
  });

  it("零张牌不炸，也不产生负数尺寸", () => {
    const layout = computeHandLayout(0, AREA);
    expect(layout.count).toBe(0);
    expect(layout.cardWidth).toBe(0);
    expect(layout.step).toBe(0);
  });
});

describe("手牌命中测试", () => {
  const layout = computeHandLayout(17, AREA);

  it("每张牌都点得中 — 一张点不中就等于一张不能出", () => {
    for (let i = 0; i < 17; i += 1) {
      const rect = cardRect(layout, i);
      // 牌是重叠的，只有 [x, x+step) 这一条属于这张牌独占；最后一张独占到
      // 右边缘。取独占区的中点
      const x = rect.x + layout.step / 2;
      const y = rect.y + rect.height / 2;
      expect(cardAtPixel(layout, x, y), `第 ${i} 张`).toBe(i);
    }
  });

  it("重叠处取最上面那张 — 从左往右扫会选中被压住的牌", () => {
    // 相邻两张重叠：右边那张压着左边那张。点在重叠区，必须命中右边那张
    expect(layout.step).toBeLessThan(layout.cardWidth);
    const right = cardRect(layout, 5);
    const x = right.x + 1;
    const y = right.y + right.height / 2;
    expect(cardAtPixel(layout, x, y)).toBe(5);
  });

  it("选中的牌抬起后，露出来的那一块也点得中 — 否则选中就取消不掉", () => {
    const selected = (i: number) => i === 3;
    const raised = cardRect(layout, 3, true);
    // 抬起后露在上方的那一条，在未抬起时属于「区域上方的空白」
    const x = raised.x + raised.width - 1;
    const y = raised.y + 1;
    expect(cardAtPixel(layout, x, y, selected)).toBe(3);
    // 不告诉它这张被选中，同一个点就落空了 —— 说明确实用了抬起后的矩形
    expect(cardAtPixel(layout, x, y)).not.toBe(3);
  });

  it("点在牌外返回 null，不会兜底到最近的一张", () => {
    expect(cardAtPixel(layout, -50, 100)).toBeNull();
    expect(cardAtPixel(layout, AREA.width + 50, 100)).toBeNull();
    expect(cardAtPixel(layout, 300, AREA.y + AREA.height + 50)).toBeNull();
  });

  it("右边缘是开区间 — 含进去的话整排最右侧会多出一像素的死角", () => {
    const single = computeHandLayout(1, AREA);
    const rect = cardRect(single, 0);
    expect(cardAtPixel(single, rect.x + rect.width - 0.5, rect.y + 1)).toBe(0);
    // 正好落在右边缘：属于牌外。判成命中的话，相邻两张牌的归属会在边界重叠
    expect(cardAtPixel(single, rect.x + rect.width, rect.y + 1)).toBeNull();
    expect(cardAtPixel(single, rect.x - 0.5, rect.y + 1)).toBeNull();
  });

  it("区域很扁时牌宽收到区域宽以内 — 否则一张牌就比整个区域还宽", () => {
    // 高远大于宽：按高宽比算出的牌宽会超出区域，必须被宽度兜住
    const narrow = computeHandLayout(1, { x: 0, y: 0, width: 40, height: 400 });
    expect(narrow.cardWidth).toBeLessThanOrEqual(40);
    expect(cardRect(narrow, 0).x).toBeGreaterThanOrEqual(0);
    expect(cardRect(narrow, 0).x + narrow.cardWidth).toBeLessThanOrEqual(40);
  });
});

describe("牌桌分区", () => {
  it("三家各占一块且互不重叠 — 重叠了会互相盖住", () => {
    const table = computeTableLayout(800, 600);
    expect(table.left.x + table.left.width).toBeLessThanOrEqual(table.right.x);
    expect(table.left.y + table.left.height).toBeLessThanOrEqual(table.hand.y);
    expect(table.trick.y + table.trick.height).toBeLessThanOrEqual(
      table.hand.y,
    );
  });

  it("本家手牌区在最下方 — 三家位置由 slotOfSeat 定，本家恒在下", () => {
    const table = computeTableLayout(800, 600);
    expect(table.hand.y).toBeGreaterThan(table.trick.y);
    expect(table.hand.y + table.hand.height).toBeCloseTo(600, 6);
  });

  it("上家在左、下家在右", () => {
    const table = computeTableLayout(800, 600);
    expect(table.left.x).toBeLessThan(table.right.x);
  });

  it("零尺寸容器不产生负数矩形", () => {
    const table = computeTableLayout(0, 0);
    for (const rect of [table.hand, table.trick, table.left, table.right]) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ============================================================
   座位映射
   ============================================================ */

describe("座位映射", () => {
  it("位置查座位与座位查位置互为逆运算 — 两处对不上就会画错家", () => {
    for (const anchor of [0, 1, 2, null]) {
      for (const slot of ["self", "left", "right"] as const) {
        expect(slotOfSeat(seatOfSlot(slot, anchor), anchor), `${slot}`).toBe(
          slot,
        );
      }
    }
  });

  it("三个位置对应三个不同的座位 — 撞了就有一家画不出来", () => {
    for (const anchor of [0, 1, 2]) {
      const seats = (["self", "left", "right"] as const).map((slot) =>
        seatOfSlot(slot, anchor),
      );
      expect(new Set(seats).size, `锚点 ${anchor}`).toBe(3);
      expect(seatOfSlot("self", anchor)).toBe(anchor);
    }
  });

  it("叫分归属按叫牌顺序还原到座位 — 错位会把别人叫的分记到你头上", () => {
    // 座位 1 先叫，依次是 1 → 2 → 0
    const view = viewOf({ firstBidder: 1, bids: [1, 0, 3] });
    expect(bidOfSeat(view, 1)).toBe(1);
    expect(bidOfSeat(view, 2)).toBe(0);
    expect(bidOfSeat(view, 0)).toBe(3);
  });

  it("还没轮到的一家没有叫分 — 越界读到 undefined 会显示成「不叫」", () => {
    const view = viewOf({ firstBidder: 2, bids: [2] });
    expect(bidOfSeat(view, 2)).toBe(2);
    expect(bidOfSeat(view, 0)).toBeNull();
    expect(bidOfSeat(view, 1)).toBeNull();
  });
});

/* ============================================================
   选牌判定
   ============================================================ */

describe("选牌判定", () => {
  const pair = (n: string) => identifyPattern(parseCards(n))!;

  it("一张没选时不出提示 — 弹「你没选牌」是在骂用户", () => {
    const verdict = checkSelection([], null);
    expect(verdict.ok).toBe(false);
    expect(selectionHint([], null)).toBeNull();
  });

  it("凑不成牌型说凑不成，不说压不过", () => {
    const cards = parseCards("3 4");
    expect(selectionHint(cards, null)).toBe(SELECTION_TEXT.unknown_pattern);
  });

  it("牌型不符与压不过分开说 — 说错会把玩家往错的方向带", () => {
    // 一对 A 压不了单张 3：不是「太小」，是根本不能比
    const mismatch = checkSelection(parseCards("A A"), pair("3"));
    expect(mismatch.ok).toBe(false);
    expect(mismatch.ok === false && mismatch.problem).toBe("mismatch");
    expect(selectionHint(parseCards("A A"), pair("3"))).toBe(
      SELECTION_TEXT.mismatch,
    );

    // 单张 3 压单张 5：同型同长，确实是太小
    const small = checkSelection(parseCards("3"), pair("5"));
    expect(small.ok === false && small.problem).toBe("too_small");
    expect(selectionHint(parseCards("3"), pair("5"))).toBe(
      SELECTION_TEXT.too_small,
    );
  });

  it("能压过时没有提示", () => {
    expect(selectionHint(parseCards("7"), pair("5"))).toBeNull();
  });

  it("自由出牌时任何合法牌型都能出", () => {
    expect(checkSelection(parseCards("3 3 3"), null).ok).toBe(true);
    expect(checkSelection(parseCards("3 4 5 6 7"), null).ok).toBe(true);
  });

  it("炸弹压得过任何非炸弹牌型", () => {
    expect(checkSelection(parseCards("3 3 3 3"), pair("A A")).ok).toBe(true);
  });

  it("视图里的待压牌型当场从牌算出来 — 不存第二份真相", () => {
    const view = viewOf({ toBeat: { seat: 1, cards: parseCards("9 9") } });
    const pattern = patternToBeat(view);
    expect(pattern?.type).toBe("pair");
    expect(pattern?.rank).toBe(9);
    expect(patternToBeat(viewOf())).toBeNull();
  });

  it("按 id 取牌跟手牌顺序走，不跟点击顺序 — 同一手牌只能有一种写法", () => {
    const hand = parseCards("3 5 7 9");
    const picked = cardsByIds(hand, [hand[3].id, hand[0].id]);
    expect(picked.map((c) => c.id)).toEqual([hand[0].id, hand[3].id]);
  });

  it("已经出掉的牌的 id 被忽略 — 过期的选中状态不该炸", () => {
    const hand = parseCards("3 5");
    expect(cardsByIds(hand, ["S99"])).toEqual([]);
  });
});

/* ============================================================
   TUI 字符排版
   ============================================================ */

describe("TUI 牌面字符", () => {
  it("花色画出符号，不靠颜色区分（UI-DESIGN.md §9）", () => {
    const [spade, heart, club, diamond] = parseCards("3 3 3 3");
    expect(cardLabel(spade)).toContain(SUIT_GLYPH.S);
    expect(cardLabel(heart)).toContain(SUIT_GLYPH.H);
    expect(cardLabel(club)).toContain(SUIT_GLYPH.C);
    expect(cardLabel(diamond)).toContain(SUIT_GLYPH.D);
    // 四个符号互不相同，否则「有符号」等于没有区分
    expect(new Set(Object.values(SUIT_GLYPH)).size).toBe(4);
  });

  it("大小王用汉字直说，不用符号 — 王没有花色", () => {
    const [small, big] = parseCards("x X");
    expect(cardLabel(small)).toBe(JOKER_LABEL.small);
    expect(cardLabel(big)).toBe(JOKER_LABEL.big);
    expect(cardLabel(big)).not.toBe(cardLabel(small));
  });

  it("点数复用规则引擎的记法 — 两张点数表迟早会分叉", () => {
    const cards = parseCards("10 J Q K A 2");
    const labels = cards.map(cardLabel);
    expect(labels[0]).toContain("10");
    expect(labels[1]).toContain("J");
    expect(labels[5]).toContain("2");
  });

  it("牌面里没有补齐用的空格 — 对齐靠 CSS 定宽格子，不靠字符", () => {
    // ♠♥♦♣ 是 East Asian Width Ambiguous、「小王」是全宽，用空格补列宽
    // 只在开发者自己那台机器上是齐的。牌面必须是紧凑的一串
    for (const card of parseCards("3 10 A 2 x X")) {
      expect(cardLabel(card), cardLabel(card)).not.toMatch(/\s/);
    }
  });

  it("多张牌之间用单个空格分隔", () => {
    const cards = parseCards("3 4 5");
    expect(cardsLabel(cards).split(" ")).toHaveLength(3);
    expect(cardsLabel([])).toBe("");
  });
});

describe("TUI 座位行", () => {
  it("行动中的一家有标记，其余没有", () => {
    const view = viewOf();
    expect(renderSeatLine(view, 0, 0, 0)).toContain(TURN_GLYPH.active);
    expect(renderSeatLine(view, 1, 0, 0)).toContain(TURN_GLYPH.idle);
    expect(renderSeatLine(view, 1, 0, 0)).not.toContain(TURN_GLYPH.active);
  });

  it("位置说法随本机座位变 — 写死「座位 0 在下方」只有坐 0 号时才对", () => {
    const view = viewOf();
    expect(renderSeatLine(view, 1, 1, null)).toContain("本家");
    // 座位 2 是座位 1 的下家
    expect(renderSeatLine(view, 2, 1, null)).toContain("下家");
    expect(renderSeatLine(view, 0, 1, null)).toContain("上家");
  });

  it("只显示张数，不显示别人的牌", () => {
    const line = renderSeatLine(viewOf(), 1, 0, 0);
    expect(line).toContain("17 张");
    expect(line).not.toContain(SUIT_GLYPH.S);
  });

  it("叫分阶段说叫了几分，出牌阶段说出了什么 — 两套信息不混在一行", () => {
    const bidding = viewOf({
      stage: "bidding",
      landlord: null,
      bid: null,
      bids: [2],
      firstBidder: 0,
      bottom: { count: 3, cards: null },
      seats: viewOf().seats.map((s) => ({ ...s, isLandlord: false })),
    });
    expect(renderSeatLine(bidding, 0, 0, 0)).toContain("叫 2 分");
    expect(renderSeatLine(bidding, 0, 0, 0)).not.toContain("不要");
    // 还没轮到的一家没有叫分信息
    expect(renderSeatLine(bidding, 1, 0, 0)).not.toContain("叫");

    const playing = viewOf({
      seats: viewOf().seats.map((s, i) =>
        i === 1 ? { ...s, lastAction: { kind: "pass" as const } } : s,
      ),
    });
    expect(renderSeatLine(playing, 1, 0, 0)).toContain("不要");
  });

  it("地主与农民要标出来 — 分不清阵营就打不了配合", () => {
    const view = viewOf();
    expect(renderSeatLine(view, 0, 0, 0)).toContain("地主");
    expect(renderSeatLine(view, 1, 0, 0)).toContain("农民");
  });
});

describe("TUI 底牌与出牌区", () => {
  it("亮牌前只说张数 — 说了张数以外的任何东西都是泄底", () => {
    const view = viewOf({ bottom: { count: 3, cards: null } });
    const line = renderBottomLine(view);
    expect(line).toContain("3 张");
    expect(line).toContain("未亮");
    for (const glyph of Object.values(SUIT_GLYPH)) {
      expect(line).not.toContain(glyph);
    }
  });

  it("亮牌后显示底牌内容", () => {
    expect(renderBottomLine(viewOf())).toContain(SUIT_GLYPH.S);
  });

  it("自由出牌时说清由谁领出 — 不说玩家会一直等上家", () => {
    expect(renderTrickLine(viewOf(), 0)).toContain("新一轮");
  });

  it("待压的牌标出是谁出的，位置随本机座位变", () => {
    const view = viewOf({ toBeat: { seat: 2, cards: parseCards("9 9") } });
    // 本机坐 0：座位 2 是上家
    expect(renderTrickLine(view, 0)).toContain("上家");
    // 本机坐 1：座位 2 是下家。锚点写死成 null 的实现这里会挂
    expect(renderTrickLine(view, 1)).toContain("下家");
  });
});

describe("TUI 状态栏（UI-DESIGN.md §6.3）", () => {
  it("轮不到你时不列出任何操作键 — 列了就是骗人", () => {
    const bar = renderStatusBar(viewOf(), false, []);
    expect(bar).not.toContain("Enter");
    expect(bar).not.toContain("不出");
    expect(bar).toContain("等待其他玩家");
  });

  it("自由出牌时不列出「不出」 — 按了没反应玩家只会以为卡了", () => {
    const bar = renderStatusBar(viewOf(), true, []);
    expect(bar).not.toContain("p 不出");
  });

  it("要跟牌时才列出「不出」", () => {
    const view = viewOf({ toBeat: { seat: 1, cards: parseCards("9 9") } });
    expect(renderStatusBar(view, true, [])).toContain("p 不出");
  });

  it("选的牌出不去就不列 Enter，并给出原因", () => {
    const view = viewOf({
      hand: parseCards("3 4 5 6 7"),
      toBeat: { seat: 1, cards: parseCards("9 9") },
    });
    // 选一张 3 去压一对 9
    const bar = renderStatusBar(view, true, [view.hand[0].id]);
    expect(bar).not.toContain("Enter");
    expect(bar).toContain(SELECTION_TEXT.mismatch);
  });

  it("选的牌能出就列 Enter，且不带任何原因", () => {
    const view = viewOf({ hand: parseCards("3 4 5 6 7") });
    const bar = renderStatusBar(view, true, [view.hand[0].id]);
    expect(bar).toContain("Enter");
    expect(bar).not.toContain(SELECTION_TEXT.mismatch);
    expect(bar).not.toContain(SELECTION_TEXT.too_small);
  });

  it("叫分阶段只列出真正能叫的分 — 别人叫了 2，就只剩 3 能叫", () => {
    const view = viewOf({ stage: "bidding", bids: [2], landlord: null });
    const bar = renderStatusBar(view, true, []);
    expect(bar).toContain("3");
    expect(bar).toContain("不叫");
    // 已经有人叫 2 了，1 和 2 都不能再叫
    expect(availableBids(view)).toEqual([0, 3]);
  });

  it("3 分封顶后没有可叫的分", () => {
    expect(availableBids(viewOf({ stage: "bidding", bids: [3] }))).toEqual([]);
  });

  it("终局显示胜负与倍数，不再列出对局操作", () => {
    const view = viewOf({
      stage: "over",
      result: {
        winnerSeat: 0,
        winnerSide: "landlord",
        winners: [0],
        spring: "landlord",
        multiplier: 8,
        scores: [16, -8, -8],
      },
    });
    const bar = renderStatusBar(view, false, []);
    expect(bar).toContain("地主胜");
    expect(bar).toContain("8 倍");
    expect(bar).toContain("春天");
    expect(bar).not.toContain("Enter");
  });

  it("没有结果时终局行返回空串", () => {
    expect(renderResultLine(viewOf())).toBe("");
  });
});

/* ============================================================
   TUI 渲染器
   ============================================================ */

describe("TUI 渲染器", () => {
  function mountTui(snapshot = snapshotOf(viewOf())) {
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiDoudizhuRenderer();
    const intents: InputIntent[] = [];
    const selections: (readonly string[])[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.onSelectionChange((ids) => selections.push(ids));
    renderer.render(snapshot);
    const root = host.firstElementChild as HTMLElement;
    const press = (key: string) =>
      root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return { host, root, renderer, intents, selections, press };
  }

  const cards = (host: HTMLElement) =>
    [...host.querySelectorAll(".bro-doudizhu-tui__card")] as HTMLElement[];

  it("挂载后复用共享 TUI 外观类，不另起一套", () => {
    const { host, root } = mountTui();
    expect(root.classList.contains("tui")).toBe(true);
    expect(host.querySelector("pre")?.classList.contains("tui-grid")).toBe(
      true,
    );
  });

  it("一张牌一个定宽格子，不是一整块 pre — 字符宽度不一致会让光标对错牌", () => {
    const hand = parseCards("3 10 A x X");
    const { host } = mountTui(snapshotOf(viewOf({ hand })));
    const cells = cards(host);
    expect(cells).toHaveLength(hand.length);
    expect(cells.map((c) => c.textContent)).toEqual(hand.map(cardLabel));
  });

  it("光标默认在第一张，hl 移动，撞边界就停", () => {
    const { host, press } = mountTui();
    const cursorAt = () =>
      cards(host).findIndex((c) => c.classList.contains("is-cursor"));

    expect(cursorAt()).toBe(0);
    press("l");
    expect(cursorAt()).toBe(1);
    press("ArrowLeft");
    expect(cursorAt()).toBe(0);
    // 回绕在一排 17 张牌上极易误操作：按到头再按一下就跳到另一端
    for (let i = 0; i < 5; i += 1) press("h");
    expect(cursorAt()).toBe(0);
    for (let i = 0; i < 20; i += 1) press("l");
    expect(cursorAt()).toBe(4);
  });

  it("空格切换选中，可以多选", () => {
    const { host, press, selections } = mountTui();
    press(" ");
    press("l");
    press(" ");
    const selected = cards(host).filter((c) =>
      c.classList.contains("is-selected"),
    );
    expect(selected).toHaveLength(2);
    expect(selections.at(-1)).toHaveLength(2);

    press(" ");
    expect(selections.at(-1)).toHaveLength(1);
  });

  it("选中项按手牌顺序回报，不按选中顺序 — 同一手牌只能有一种写法", () => {
    const hand = parseCards("3 4 5 6 7");
    const { press, renderer, selections } = mountTui(
      snapshotOf(viewOf({ hand })),
    );
    // 先选第 4 张，再回头选第 2 张
    for (let i = 0; i < 3; i += 1) press("l");
    press(" ");
    for (let i = 0; i < 2; i += 1) press("h");
    press(" ");

    expect(renderer.selection()).toEqual([hand[1].id, hand[3].id]);
    expect(selections.at(-1)).toEqual([hand[1].id, hand[3].id]);
  });

  it("Enter 出牌，只带 id 不带牌面 — 客户端说了不算", () => {
    const view = viewOf({ hand: parseCards("3 4 5 6 7") });
    const { press, intents } = mountTui(snapshotOf(view));
    press(" ");
    press("Enter");

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      matchId: "m1",
      basedOnVersion: 1,
      type: "doudizhu/play",
      payload: { cardIds: [view.hand[0].id] },
    });
    // 载荷里不能出现完整的 Card 对象
    const payload = intents[0].payload as { cardIds: unknown[] };
    expect(payload.cardIds.every((id) => typeof id === "string")).toBe(true);
  });

  it("一张没选按 Enter 不上报 — 空意图不该惊动服务端", () => {
    const { press, intents } = mountTui();
    press("Enter");
    expect(intents).toEqual([]);
  });

  it("选的牌压不过上家时按 Enter 不上报", () => {
    const view = viewOf({
      hand: parseCards("3 4 5 6 7"),
      toBeat: { seat: 1, cards: parseCards("9") },
    });
    const { press, intents } = mountTui(snapshotOf(view));
    press(" ");
    press("Enter");
    expect(intents).toEqual([]);
  });

  it("自己领出的一轮按 p 不上报 — 允许过会让三家互相等待，局面卡死", () => {
    const { press, intents } = mountTui();
    press("p");
    expect(intents).toEqual([]);
  });

  it("要跟牌时按 p 上报过牌", () => {
    const view = viewOf({ toBeat: { seat: 1, cards: parseCards("9 9") } });
    const { press, intents } = mountTui(snapshotOf(view));
    press("p");
    expect(intents).toHaveLength(1);
    expect(intents[0].type).toBe("doudizhu/pass");
  });

  it("Esc 清空选中", () => {
    const { host, press } = mountTui();
    press(" ");
    expect(
      cards(host).some((c) => c.classList.contains("is-selected")),
    ).toBe(true);
    press("Escape");
    expect(
      cards(host).some((c) => c.classList.contains("is-selected")),
    ).toBe(false);
  });

  it("叫分阶段按数字键叫分", () => {
    const view = viewOf({ stage: "bidding", bids: [], landlord: null });
    const { press, intents } = mountTui(snapshotOf(view));
    press("2");
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "doudizhu/bid",
      payload: { bid: 2 },
    });
  });

  it("叫分阶段不认状态栏没列出的键 — 别人叫了 2，按 1 不能有反应", () => {
    const view = viewOf({ stage: "bidding", bids: [2], landlord: null });
    const { press, intents } = mountTui(snapshotOf(view));
    press("1");
    press("2");
    expect(intents).toEqual([]);
    press("3");
    expect(intents).toHaveLength(1);
  });

  it("叫分阶段按空格不叫分 — 出牌阶段的习惯手势不该白送地主", () => {
    // Number(" ") === 0，直接转数字的实现会把空格当成「不叫」
    const view = viewOf({ stage: "bidding", bids: [], landlord: null });
    const { press, intents } = mountTui(snapshotOf(view));
    press(" ");
    expect(intents).toEqual([]);
  });

  it("叫分阶段按 Enter/空格不出牌 — 两个阶段是两套交互", () => {
    const view = viewOf({ stage: "bidding", bids: [], landlord: null });
    const { press, intents } = mountTui(snapshotOf(view));
    press("Enter");
    press("p");
    expect(intents).toEqual([]);
  });

  it("叫分阶段的按键不会顺带落到出牌那一套上", () => {
    // 叫分分支处理完必须返回。漏掉 return 的话，按 3 会先叫 3 分，
    // 再被出牌分支当成未知键——更糟的是 h/l/空格 会在叫分阶段改选中状态
    const view = viewOf({ stage: "bidding", bids: [], landlord: null });
    const { host, press, selections } = mountTui(snapshotOf(view));
    press(" ");
    press("l");
    press(" ");
    expect(selections).toEqual([]);
    expect(
      cards(host).some((c) => c.classList.contains("is-selected")),
      "叫分阶段不该有选中的牌",
    ).toBe(false);
  });

  it("轮不到本人时不上报任何意图", () => {
    const { press, intents } = mountTui(
      snapshotOf(viewOf({ toBeat: { seat: 1, cards: parseCards("9") } }), {
        activeSeat: 1,
      }),
    );
    press(" ");
    press("Enter");
    press("p");
    expect(intents).toEqual([]);
  });

  it("观战者不上报意图", () => {
    const { press, intents } = mountTui(
      snapshotOf(viewOf(), { mySeat: null, activeSeat: 0 }),
    );
    press(" ");
    press("Enter");
    expect(intents).toEqual([]);
  });

  it("出牌后清掉已经不在手上的选中项 — 否则出牌键会亮着却永远出不去", () => {
    const hand = parseCards("3 4 5 6 7");
    const { renderer, press, selections } = mountTui(
      snapshotOf(viewOf({ hand })),
    );
    press(" ");
    expect(selections.at(-1)).toHaveLength(1);

    renderer.render(
      snapshotOf(viewOf({ hand: hand.slice(1) }), { version: 2 }),
    );
    expect(renderer.selection()).toEqual([]);
    expect(selections.at(-1)).toEqual([]);
  });

  it("手牌变短后光标不会指到数组外", () => {
    const hand = parseCards("3 4 5 6 7");
    const { host, renderer, press } = mountTui(snapshotOf(viewOf({ hand })));
    for (let i = 0; i < 4; i += 1) press("l");
    renderer.render(
      snapshotOf(viewOf({ hand: hand.slice(0, 2) }), { version: 2 }),
    );
    const cursors = cards(host).filter((c) =>
      c.classList.contains("is-cursor"),
    );
    expect(cursors).toHaveLength(1);
  });

  it("状态栏跟随行动权变化", () => {
    const view = viewOf();
    const { host, renderer } = mountTui(snapshotOf(view));
    const status = host.querySelector(".bro-doudizhu-tui__status");
    expect(status?.textContent).toContain("h/l 选牌");

    renderer.render(snapshotOf(view, { version: 2, activeSeat: 1 }));
    expect(status?.textContent).toContain("等待其他玩家");
  });

  it("卸载后移除节点并停止响应键盘", () => {
    const { host, root, renderer, intents } = mountTui();
    renderer.unmount();
    expect(host.children).toHaveLength(0);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
  });

  it("卸载时把键盘监听摘干净 — 挂在脱离文档的节点上的监听会拖住整个渲染器", () => {
    // 光看「卸载后不再上报意图」是看不出监听有没有摘的：卸载顺带清空了
    // handler，监听留着也不会上报。但留着的监听会让渲染器连同它手上的
    // 最后一帧快照（里头有手牌）一直可达，一局一个泄漏
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiDoudizhuRenderer();
    renderer.mount(host);
    const root = host.firstElementChild as HTMLElement;
    const removed = vi.spyOn(root, "removeEventListener");
    renderer.render(snapshotOf(viewOf()));
    renderer.unmount();

    expect(removed).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});

/* ============================================================
   Canvas 渲染器
   ============================================================ */

/**
 * 最小 2D 上下文替身。
 *
 * jsdom 不实现 `getContext`，于是 `draw()` 整段在测试里一次都没执行过——
 * 渲染器里写错一个方法名也发现不了。这个替身把绘制调用记下来，让「到底画
 * 了什么」变成能断言的东西。
 *
 * 记文字与填充：扑克牌上有意义的信息全是字（点数、花色符号、张数），
 * 圆角边框画歪了肉眼一望即知，不值得在这里断言。
 */
function fakeContext() {
  const texts: { value: string; x: number; y: number; color: string }[] = [];
  const fills: string[] = [];

  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    arc: () => {},
    fill: () => fills.push(ctx.fillStyle),
    stroke: () => {},
    fillText: (value: string, x: number, y: number) => {
      texts.push({ value, x, y, color: ctx.fillStyle });
    },
    save: () => {},
    restore: () => {},
    setTransform: () => {},
  };

  return { ctx, texts, fills };
}

describe("Canvas 渲染器", () => {
  const WIDTH = 800;
  const HEIGHT = 600;
  const table = computeTableLayout(WIDTH, HEIGHT);

  function mountCanvas(snapshot = snapshotOf(viewOf())) {
    const host = document.createElement("div");
    // jsdom 不给元素真实尺寸，布局会因为 0×0 直接跳过绘制
    Object.defineProperty(host, "clientWidth", {
      value: WIDTH,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: HEIGHT,
      configurable: true,
    });
    document.body.append(host);

    const gfx = fakeContext();
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(gfx.ctx as unknown as CanvasRenderingContext2D);

    const renderer = new CanvasDoudizhuRenderer();
    const intents: InputIntent[] = [];
    const selections: (readonly string[])[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.onSelectionChange((ids) => selections.push(ids));
    renderer.render(snapshot);
    spy.mockRestore();

    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    return { host, canvas, renderer, intents, selections, ...gfx };
  }

  /** 本机手牌区里第 index 张牌的排布。命中测试要和渲染器算得一样。 */
  function handLayout(count: number) {
    return computeHandLayout(count, {
      x: table.hand.x + table.hand.width * 0.05,
      y: table.hand.y,
      width: table.hand.width * 0.9,
      height: table.hand.height * 0.9,
    });
  }

  /** 落在第 index 张牌上的鼠标坐标。jsdom 里 getBoundingClientRect 全零。 */
  function atCard(count: number, index: number, selected = false) {
    const layout = handLayout(count);
    const rect = cardRect(layout, index, selected);
    // 取牌的左侧一条：牌是重叠的，右侧那块被后面两三张压着，点上去命中的
    // 是别的牌。只有 [x, x+step) 这一条是这张牌独占的
    const inset = (layout.step > 0 ? layout.step : rect.width) / 2;
    return {
      clientX: rect.x + inset,
      clientY: rect.y + rect.height / 2,
    };
  }

  it("画得出东西 — 画不出来是这个文件最可能的故障", () => {
    const { texts } = mountCanvas();
    expect(texts.length).toBeGreaterThan(0);
  });

  it("每张手牌都画出花色符号 — 花色不能只靠颜色区分（UI-DESIGN.md §9）", () => {
    const hand = parseCards("3 3 3 3");
    const { texts } = mountCanvas(snapshotOf(viewOf({ hand })));
    for (const suit of ["S", "H", "C", "D"] as const) {
      expect(
        texts.some((t) => t.value === SUIT_GLYPH[suit]),
        `缺少 ${suit} 的符号`,
      ).toBe(true);
    }
  });

  it("红桃与黑桃的符号不同，不是只有颜色不同", () => {
    const hand = parseCards("3 3");
    const { texts } = mountCanvas(snapshotOf(viewOf({ hand })));
    const spade = texts.find((t) => t.value === SUIT_GLYPH.S);
    const heart = texts.find((t) => t.value === SUIT_GLYPH.H);
    expect(spade).toBeDefined();
    expect(heart).toBeDefined();
    expect(spade!.value).not.toBe(heart!.value);
  });

  it("对家只画张数，画面上翻不出他们的牌", () => {
    const hand = parseCards("3 4 5");
    const { texts } = mountCanvas(snapshotOf(viewOf({ hand })));
    // 视图里本来就没有别人的牌，能画出来的只有张数
    expect(texts.some((t) => t.value.includes("17 张"))).toBe(true);
  });

  it("对家那块区域里一个牌面字符都没有 — 画的是背面", () => {
    const hand = parseCards("3 4 5");
    const { texts } = mountCanvas(snapshotOf(viewOf({ hand })));
    // 上家区在左上、下家区在右上（seatOfSlot 定的），手牌区在最下方。
    // 两块座位区里出现任何点数或花色，就说明有人的牌被画了出来
    const inSeatBand = texts.filter((t) => t.y < table.trick.y);
    const glyphs = Object.values(SUIT_GLYPH) as string[];
    for (const text of inSeatBand) {
      expect(glyphs, `座位区画出了花色 ${text.value}`).not.toContain(
        text.value,
      );
    }
  });

  it("上家画在左、下家画在右，位置随本机座位走 — 写死座位号只有坐 0 号时才对", () => {
    const hand = parseCards("3 4 5");
    // 本机坐 2 号：上家是座位 1（画左），下家是座位 0（画右）。
    // 特意不让上家等于 0 号——否则「写死 0 号」的实现也能蒙对
    const view = viewOf({
      hand,
      seats: [
        { seat: 0, cardsLeft: 13, isLandlord: true, lastAction: null },
        { seat: 1, cardsLeft: 11, isLandlord: false, lastAction: null },
        { seat: 2, cardsLeft: hand.length, isLandlord: false, lastAction: null },
      ],
    });
    const { texts } = mountCanvas(snapshotOf(view, { mySeat: 2 }));
    const find = (needle: string) =>
      texts.find((t) => t.value.includes(needle));

    const upstream = find("11 张");
    const downstream = find("13 张");
    expect(upstream, "上家（座位 1）的张数没画出来").toBeDefined();
    expect(downstream, "下家（座位 0）的张数没画出来").toBeDefined();
    expect(upstream!.x).toBeLessThan(WIDTH / 2);
    expect(downstream!.x).toBeGreaterThan(WIDTH / 2);
  });

  it("底牌未亮时画背面，不画牌面", () => {
    const view = viewOf({ bottom: { count: 3, cards: null } });
    const dark = mountCanvas(snapshotOf(view));
    const open = mountCanvas(snapshotOf(viewOf()));
    // 亮牌后多出三张牌的点数与花色（每张两段文字）
    expect(open.texts.length).toBeGreaterThan(dark.texts.length);
  });

  it("点击手牌切换选中，只改本地状态不上报意图", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, selections, intents } = mountCanvas(
      snapshotOf(viewOf({ hand })),
    );
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 2)));
    expect(selections.at(-1)).toEqual([hand[2].id]);
    expect(intents).toEqual([]);

    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 2, true)));
    expect(selections.at(-1)).toEqual([]);
  });

  it("多选按手牌顺序回报，不按点击顺序", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, selections } = mountCanvas(snapshotOf(viewOf({ hand })));
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 3)));
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 1)));
    expect(selections.at(-1)).toEqual([hand[1].id, hand[3].id]);
  });

  it("点在手牌外不改选中", () => {
    const { canvas, selections } = mountCanvas();
    canvas.dispatchEvent(
      new MouseEvent("click", { clientX: 5, clientY: 5 }),
    );
    expect(selections).toEqual([]);
  });

  it("双击把选中的牌打出去", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, intents } = mountCanvas(snapshotOf(viewOf({ hand })));
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 0)));
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 0, true), detail: 2 }),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "doudizhu/play",
      payload: { cardIds: [hand[0].id] },
    });
  });

  it("单击只选中不出牌 — 一点就出会让人连牌都来不及看清", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, intents, selections } = mountCanvas(
      snapshotOf(viewOf({ hand })),
    );
    // detail 为 1 的普通单击。连点三张不同的牌，一个意图都不该发出去
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 0), detail: 1 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 1), detail: 1 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 2), detail: 1 }),
    );
    expect(intents).toEqual([]);
    expect(selections.at(-1)).toHaveLength(3);
  });

  it("选的牌出不去时双击不上报 — 空意图不该惊动服务端", () => {
    // 上家是一对 9，选一张 3 压不过；双击也不该发出去
    const hand = parseCards("3 4 5 6 7");
    const view = viewOf({ hand, toBeat: { seat: 1, cards: parseCards("9 9") } });
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 0)));
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 0, true), detail: 2 }),
    );
    expect(intents).toEqual([]);
  });

  it("一张没选时双击不上报", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, intents } = mountCanvas(snapshotOf(viewOf({ hand })));
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 0), detail: 2 }),
    );
    expect(intents).toEqual([]);
  });

  it("选中的牌抬起后，露出来的那一条也点得掉 — 否则选错了取消不了", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, selections } = mountCanvas(snapshotOf(viewOf({ hand })));
    const layout = handLayout(hand.length);
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 2)));
    expect(selections.at(-1)).toEqual([hand[2].id]);

    // 抬起后露在上方的那一条，在未抬起时属于牌上方的空白。命中测试若不看
    // 抬起状态，这一下就落空，选中的牌永远取消不掉
    const raised = cardRect(layout, 2, true);
    canvas.dispatchEvent(
      new MouseEvent("click", {
        clientX: raised.x + layout.step / 2,
        clientY: raised.y + 1,
      }),
    );
    expect(selections.at(-1)).toEqual([]);
  });

  it("轮不到本人时双击不上报", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, intents } = mountCanvas(
      snapshotOf(viewOf({ hand }), { activeSeat: 1 }),
    );
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 0)));
    canvas.dispatchEvent(
      new MouseEvent("click", { ...atCard(5, 0, true), detail: 2 }),
    );
    expect(intents).toEqual([]);
  });

  it("叫分阶段点手牌不选中 — 那时候选牌毫无意义", () => {
    const hand = parseCards("3 4 5 6 7");
    const view = viewOf({ hand, stage: "bidding", landlord: null });
    const { canvas, selections } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 0)));
    expect(selections).toEqual([]);
  });

  it("出牌后清掉已经不在手上的选中项", () => {
    const hand = parseCards("3 4 5 6 7");
    const { canvas, renderer, selections } = mountCanvas(
      snapshotOf(viewOf({ hand })),
    );
    canvas.dispatchEvent(new MouseEvent("click", atCard(5, 0)));
    expect(selections.at(-1)).toHaveLength(1);

    renderer.render(
      snapshotOf(viewOf({ hand: hand.slice(1) }), { version: 2 }),
    );
    expect(renderer.selection()).toEqual([]);
    expect(selections.at(-1)).toEqual([]);
  });

  it("按设备像素比放大位图，再用 CSS 缩回去 — 否则高分屏上牌面发虚", () => {
    // jsdom 的 devicePixelRatio 恒为 1，不改这个值的话「读了 DPR」与
    // 「写死 1」两种实现完全等价，测了等于没测
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    try {
      const { canvas } = mountCanvas();
      expect(canvas.width).toBe(WIDTH * 2);
      expect(canvas.style.width).toBe(`${WIDTH}px`);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", {
        value: original,
        configurable: true,
      });
    }
  });

  it("卸载时断开 ResizeObserver — 漏掉就是每局一个泄漏", () => {
    const disconnect = vi.fn();
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;

    try {
      const { host, renderer } = mountCanvas();
      renderer.unmount();
      expect(disconnect).toHaveBeenCalled();
      expect(host.querySelector("canvas")).toBeNull();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

/* ============================================================
   反作弊：渲染层看不到别人的牌
   ============================================================ */

describe("渲染层拿不到别家的手牌", () => {
  it("视图类型里根本没有别人手牌的字段 — 想画也画不出来", () => {
    const view = viewOf();
    // seats 只有张数
    for (const seat of view.seats) {
      expect(seat).not.toHaveProperty("hand");
      expect(seat).not.toHaveProperty("cards");
      expect(typeof seat.cardsLeft).toBe("number");
    }
    // hand 只有一份，就是本机的
    expect(Array.isArray(view.hand)).toBe(true);
    expect(view).not.toHaveProperty("hands");
  });

  it("TUI 画面上只出现本机手牌的牌面", () => {
    const hand = parseCards("3 4 5");
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiDoudizhuRenderer();
    renderer.mount(host);
    renderer.render(snapshotOf(viewOf({ hand })));

    const text = host.textContent ?? "";
    const shown = countCardTokens(text);
    // 本机 3 张 + 底牌 3 张（已亮），别家的一张都不该出现
    expect(shown).toBe(hand.length + 3);
  });
});

/** 数一段文本里出现了几个牌面（花色符号或王）。 */
function countCardTokens(text: string): number {
  const glyphs = [...Object.values(SUIT_GLYPH), ...Object.values(JOKER_LABEL)];
  let count = 0;
  for (const glyph of glyphs) {
    count += text.split(glyph).length - 1;
  }
  return count;
}

/* ============================================================
   切主题不重开局
   ============================================================ */

describe("切主题不重开局（真渲染器）", () => {
  it("Canvas 换成 TUI 后牌局原样保留", () => {
    const hand = parseCards("3 4 5 6 7");
    const snapshot = snapshotOf(viewOf({ hand }), { version: 7 });

    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<DoudizhuView>(() => {});
    session.applySnapshot(snapshot);

    session.attachRenderer(new CanvasDoudizhuRenderer(), host);
    expect(host.querySelector("canvas")).not.toBeNull();

    session.attachRenderer(new TuiDoudizhuRenderer(), host);
    // 旧渲染器的节点必须被清掉，否则两套画面会叠在一起
    expect(host.querySelector("canvas")).toBeNull();
    expect(host.querySelectorAll(".bro-doudizhu-tui__card")).toHaveLength(
      hand.length,
    );
    expect(session.currentState()?.version).toBe(7);
  });

  it("换渲染器后新渲染器的意图仍能送达", () => {
    const sent: InputIntent[] = [];
    const hand = parseCards("3 4 5 6 7");
    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<DoudizhuView>((i) => sent.push(i));
    session.applySnapshot(snapshotOf(viewOf({ hand })));

    session.attachRenderer(new CanvasDoudizhuRenderer(), host);
    session.attachRenderer(new TuiDoudizhuRenderer(), host);

    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({ cardIds: [hand[0].id] });
  });
});

/** 类型层面的守卫：视图里不该有任何「全桌手牌」的入口。 */
const _typeGuard: Card[] = viewOf().hand as Card[];
void _typeGuard;
