/**
 * 中国象棋渲染层测试。
 *
 * 渲染层被切成四块纯函数 + 两块 DOM：几何（layout）、字形表（glyphs）、
 * 交互状态机（selection）、字符排版（tui-text），外加 TUI 与 Canvas 两个
 * 渲染器。前四块能逐值断言；后两块要 DOM，其中 Canvas 还得自备 2D 上下文
 * 替身——jsdom 不实现 `getContext`，不给替身的话 `draw()` 整段一次都不会
 * 执行，里面写错方法名都发现不了。
 *
 * 本文件不测「好不好看」，只测会让人走错棋的东西：棋盘比例、点击落到哪个
 * 交叉点、红黑分不分得清、两步走子的状态机、状态栏说的话算不算数。
 */

import { describe, expect, it, vi } from "vitest";
import {
  BOARD_ASPECT,
  RIVER_TOP_ROW,
  computeLayout,
  isEdgeFile,
  palaceDiagonals,
  palacePoints,
  pixelToPoint,
  pointToPixel,
  riverBand,
} from "@/bro/games/xiangqi/render/layout";
import {
  BLACK_GLYPH,
  RED_GLYPH,
  glyphOf,
  glyphTable,
  pieceLabel,
} from "@/bro/games/xiangqi/render/glyphs";
import {
  defaultCursor,
  resolveTap,
  targetsFrom,
} from "@/bro/games/xiangqi/render/selection";
import {
  GLYPH,
  GRID_COLS,
  GRID_ROWS,
  RIVER_TEXT_ROW,
  DRAW_WARN_MOVES,
  capturedText,
  renderBoardCells,
  renderStatusBar,
  verdictText,
} from "@/bro/games/xiangqi/render/tui-text";
import { TuiXiangqiRenderer } from "@/bro/games/xiangqi/render/tui";
import { CanvasXiangqiRenderer } from "@/bro/games/xiangqi/render/canvas";
import { GameSession } from "@/bro/games/core/session";
import type { InputIntent } from "@/bro/games/core/types";
import type { PieceType, Position } from "@/bro/games/xiangqi/logic";
import {
  BOARD_SIZE,
  FILES,
  NATURAL_LIMIT_MOVES,
  RANKS,
  initialPosition,
  isInPalace,
  legalMoves,
  parseSquare,
  positionFrom,
  squareIndex,
} from "@/bro/games/xiangqi/logic";
import type { XiangqiSnapshot, XiangqiView } from "@/bro/games/xiangqi/view";
import {
  SEAT_BLACK,
  SEAT_RED,
  UNDO_REQUESTS_PER_MATCH,
  toViewMove,
} from "@/bro/games/xiangqi/view";

/** 坐标串转下标，如 `at("e9")` 是红帅的原位。 */
function at(text: string): number {
  return squareIndex(parseSquare(text));
}

/** 由局面造视图。`legalMoves` 照服务端的做法算好塞进去，渲染层只是读它。 */
function viewOf(
  pos: Position = initialPosition(),
  over: Partial<XiangqiView> = {},
): XiangqiView {
  return {
    board: pos.board,
    lastMove: null,
    checkSquare: null,
    legalMoves: legalMoves(pos).map(toViewMove),
    captured: [],
    result: null,
    ply: 0,
    movesUntilDraw: NATURAL_LIMIT_MOVES,
    undoRequest: null,
    undoRequestsUsed: [0, 0],
    ...over,
  };
}

function snapshotOf(
  view: XiangqiView = viewOf(),
  over: Partial<XiangqiSnapshot> = {},
): XiangqiSnapshot {
  return {
    matchId: "m1",
    gameId: "xiangqi",
    phase: "playing",
    version: 1,
    activeSeat: 0,
    mySeat: 0,
    board: view,
    ...over,
  };
}

const ALL_TYPES: PieceType[] = ["K", "A", "B", "N", "R", "C", "P"];

describe("布局几何", () => {
  it("棋盘不是正方形 — 照抄围棋的 aspect-ratio:1 会把棋盘压扁", () => {
    expect(BOARD_ASPECT).toBeCloseTo(10 / 11, 10);
    expect(BOARD_ASPECT).not.toBe(1);
  });

  it("格子本身是正方形 — 拉成长方形后马的日字象的田字就看不出形状", () => {
    for (const [w, h] of [
      [500, 550],
      [900, 550],
      [500, 900],
    ]) {
      const layout = computeLayout(w, h);
      const a = pointToPixel(layout, at("a0"));
      const right = pointToPixel(layout, at("b0"));
      const down = pointToPixel(layout, at("a1"));
      expect(right.x - a.x, `${w}x${h} 横向格宽`).toBeCloseTo(layout.step, 10);
      expect(down.y - a.y, `${w}x${h} 纵向格宽`).toBeCloseTo(layout.step, 10);
    }
  });

  it("容器比例不符时取较紧的一边，棋盘整体缩小而不变形", () => {
    // 高度富余：受宽度约束，step = 900/10
    expect(computeLayout(900, 2000).step).toBeCloseTo(90, 10);
    // 宽度富余：受高度约束，step = 2200/11
    expect(computeLayout(2000, 2200).step).toBeCloseTo(200, 10);
  });

  it("四周留白等于一格，边线上的子不会被裁掉半个", () => {
    const layout = computeLayout(500, 550);
    const first = pointToPixel(layout, at("a0"));
    const last = pointToPixel(layout, at("i9"));
    expect(first.x).toBeCloseTo(layout.width - last.x, 10);
    expect(first.y).toBeCloseTo(layout.height - last.y, 10);
    // 留白要够半颗子，否则边上的子压在画布边缘
    expect(first.x).toBeGreaterThan(layout.radius);
  });

  it("棋子直径小于线距 — 两个带字的圆盘紧贴会看不清是哪个兵种", () => {
    const layout = computeLayout(500, 550);
    expect(layout.radius * 2).toBeLessThan(layout.step);
  });

  it("交叉点与像素互为逆映射，90 个点逐个验", () => {
    const layout = computeLayout(500, 550);
    for (let i = 0; i < BOARD_SIZE; i += 1) {
      const { x, y } = pointToPixel(layout, i);
      expect(pixelToPoint(layout, x, y), `下标 ${i}`).toBe(i);
    }
  });

  it("点在格子正中不吸附 — 吸偏一格会选中旁边那个子", () => {
    const layout = computeLayout(500, 550);
    const a = pointToPixel(layout, 0);
    const center = { x: a.x + layout.step / 2, y: a.y + layout.step / 2 };
    expect(pixelToPoint(layout, center.x, center.y)).toBeNull();
  });

  it("点在棋盘外返回 null，不会环绕到对侧", () => {
    const layout = computeLayout(500, 550);
    const last = pointToPixel(layout, at("i9"));
    expect(pixelToPoint(layout, last.x + layout.step, last.y)).toBeNull();
    expect(pixelToPoint(layout, last.x, last.y + layout.step)).toBeNull();
    expect(pixelToPoint(layout, -layout.step, 0)).toBeNull();
  });

  it("棋盘正下方一格返回 null — 只靠距离判断挡不住这一处", () => {
    // 越界判断若被去掉，row = 10 的点会被 pointToPixel 原样还原，距离为 0
    // 于是「命中」一个不存在的交叉点
    const layout = computeLayout(500, 550);
    for (let col = 0; col < FILES; col += 1) {
      const below = pointToPixel(layout, (RANKS - 1) * FILES + col);
      expect(
        pixelToPoint(layout, below.x, below.y + layout.step),
        `第 ${col} 列下方`,
      ).toBeNull();
    }
  });
});

describe("河界与九宫（从规则层反推，不重抄常量）", () => {
  it("河界在第 4、5 行之间 — 与规则层的过河判定同源", () => {
    expect(RIVER_TOP_ROW).toBe(4);
  });

  it("河界带正好一格高，且卡在 4、5 两行的连线上", () => {
    const layout = computeLayout(500, 550);
    const band = riverBand(layout);
    expect(band.bottom - band.top).toBeCloseTo(layout.step, 10);
    expect(band.top).toBeCloseTo(pointToPixel(layout, at("a4")).y, 10);
    expect(band.bottom).toBeCloseTo(pointToPixel(layout, at("a5")).y, 10);
  });

  it("只有最外两条竖线贯通 — 中间七条要在河界断开", () => {
    const through = [];
    for (let col = 0; col < FILES; col += 1) if (isEdgeFile(col)) through.push(col);
    expect(through).toEqual([0, FILES - 1]);
  });

  it("九宫斜线四条，端点都落在九宫角上", () => {
    const lines = palaceDiagonals();
    expect(lines).toHaveLength(4);
    const ends = new Set(lines.flat());
    // 两方各四个角，两条斜线共用这四个角
    expect(ends).toEqual(
      new Set([
        at("d0"),
        at("f0"),
        at("d2"),
        at("f2"),
        at("d7"),
        at("f7"),
        at("d9"),
        at("f9"),
      ]),
    );
  });

  it("九宫点各九个，且与规则层的 isInPalace 完全一致", () => {
    for (const side of ["red", "black"] as const) {
      const points = palacePoints(side);
      expect(points, `${side} 九宫点数`).toHaveLength(9);
      for (const index of points) {
        const sq = { col: index % FILES, row: Math.floor(index / FILES) };
        expect(isInPalace(sq, side), `${side} ${index}`).toBe(true);
      }
    }
    // 两方九宫不重叠，否则棋盘上会画出五条斜线
    expect(
      palacePoints("red").filter((p) => palacePoints("black").includes(p)),
    ).toEqual([]);
  });
});

describe("字形表（UI-DESIGN.md §9 颜色不作为唯一载体）", () => {
  it("红黑七个兵种字形无一重复 — 灰度下也要分得清敌我", () => {
    const red = ALL_TYPES.map((t) => RED_GLYPH[t]);
    const black = ALL_TYPES.map((t) => BLACK_GLYPH[t]);
    expect(red.filter((g) => black.includes(g))).toEqual([]);
    // 各自内部也不许重名，否则同色两个兵种看着一样
    expect(new Set(red).size).toBe(ALL_TYPES.length);
    expect(new Set(black).size).toBe(ALL_TYPES.length);
  });

  it("七个兵种一个不少 — 漏一个就会在棋盘上渲染出 undefined", () => {
    for (const type of ALL_TYPES) {
      expect(RED_GLYPH[type], `红 ${type}`).toMatch(/^.$/u);
      expect(BLACK_GLYPH[type], `黑 ${type}`).toMatch(/^.$/u);
    }
  });

  it("glyphOf 按棋色取表", () => {
    expect(glyphOf({ type: "R", side: "red" })).toBe("俥");
    expect(glyphOf({ type: "R", side: "black" })).toBe("車");
    expect(glyphTable("red")).toBe(RED_GLYPH);
    expect(glyphTable("black")).toBe(BLACK_GLYPH);
  });

  it("无障碍名称带颜色 — 孤零零一个字读屏念出来没有归属", () => {
    expect(pieceLabel({ type: "R", side: "red" })).toBe("红俥");
    expect(pieceLabel({ type: "K", side: "black" })).toBe("黑將");
  });
});

describe("两步走子的状态机", () => {
  const view = viewOf();

  it("未选中时可走点为空集，调用方不必自己判空", () => {
    expect(targetsFrom(view, null).size).toBe(0);
  });

  it("可走点只取自服务端下发的表 — 渲染层不算规则", () => {
    // 红方炮在 b7，开局可走的点由规则层给出
    const from = at("b7");
    const expected = new Set(
      view.legalMoves.filter((m) => m.from === from).map((m) => m.to),
    );
    expect(targetsFrom(view, from)).toEqual(expected);
    expect(expected.size).toBeGreaterThan(0);
  });

  it("点己方子 → 选中", () => {
    expect(resolveTap(view, "red", null, at("e9"))).toEqual({
      kind: "select",
      at: at("e9"),
    });
  });

  it("点已选中的那一格 → 取消，给一条明确的反悔路径", () => {
    expect(resolveTap(view, "red", at("e9"), at("e9"))).toEqual({
      kind: "clear",
    });
  });

  it("点合法落点 → 走子", () => {
    expect(resolveTap(view, "red", at("e9"), at("e8"))).toEqual({
      kind: "move",
      move: { from: at("e9"), to: at("e8") },
    });
  });

  it("点己方另一个子 → 改选，不是取消（挑错子是常事）", () => {
    expect(resolveTap(view, "red", at("e9"), at("b7"))).toEqual({
      kind: "select",
      at: at("b7"),
    });
  });

  it("点非法的空格 → 取消选择；本来没选中则什么都不做", () => {
    const empty = at("e5");
    expect(resolveTap(view, "red", at("e9"), empty)).toEqual({ kind: "clear" });
    expect(resolveTap(view, "red", null, empty)).toEqual({ kind: "none" });
  });

  it("点走不到的对方子 → 不选中对方的子", () => {
    const enemy = at("e0");
    expect(resolveTap(view, "red", null, enemy)).toEqual({ kind: "none" });
  });

  it("观战者点什么都不成立 — 能选子就等于能发意图", () => {
    expect(resolveTap(view, null, null, at("e9"))).toEqual({ kind: "none" });
    expect(resolveTap(view, null, at("e9"), at("e8"))).toEqual({ kind: "none" });
  });

  it("默认光标落在本方将帅上，不是棋盘正中（那是河上的空点）", () => {
    expect(defaultCursor(view, "red")).toBe(at("e9"));
    expect(defaultCursor(view, "black")).toBe(at("e0"));
  });

  it("找不到将（观战或残局构造）时退回棋盘正中，不崩", () => {
    const bare = viewOf(positionFrom("red", { a0: "r" }));
    expect(defaultCursor(bare, null)).toBe(Math.floor(BOARD_SIZE / 2));
    expect(defaultCursor(bare, "red")).toBe(Math.floor(BOARD_SIZE / 2));
  });
});

describe("TUI 字符排版", () => {
  it("网格尺寸固定：12 行 × 10 列（10 行棋盘 + 河界 + 列标，1 列行号）", () => {
    const rows = renderBoardCells(viewOf());
    expect(GRID_ROWS).toBe(RANKS + 2);
    expect(GRID_COLS).toBe(FILES + 1);
    expect(rows).toHaveLength(GRID_ROWS);
    for (const [i, row] of rows.entries()) {
      expect(row, `第 ${i} 行列数`).toHaveLength(GRID_COLS);
    }
  });

  it("有子与空盘的网格尺寸相同 — 字形宽度不参与排版", () => {
    const dense = renderBoardCells(viewOf());
    const empty = renderBoardCells(viewOf(positionFrom("red", {})));
    expect(dense.map((r) => r.length)).toEqual(empty.map((r) => r.length));
  });

  it("河界行在第 5 行，整行都是 river 类且不带交叉点下标", () => {
    const rows = renderBoardCells(viewOf());
    expect(RIVER_TEXT_ROW).toBe(RIVER_TOP_ROW + 1);
    const river = rows[RIVER_TEXT_ROW];
    expect(river.slice(1).every((c) => c.kind === "river")).toBe(true);
    expect(river.slice(1).every((c) => c.index === null)).toBe(true);
    expect(river.map((c) => c.glyph).join("")).toContain("楚");
    expect(river.map((c) => c.glyph).join("")).toContain("界");
  });

  it("行号沿用规则层坐标 0..9，河界不占行号", () => {
    const rows = renderBoardCells(viewOf());
    const labels = rows
      .filter((_, i) => i !== RIVER_TEXT_ROW && i !== GRID_ROWS - 1)
      .map((r) => r[0].glyph);
    expect(labels).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("列标沿用规则层的 a..i — 界面、日志、棋谱必须说同一套坐标", () => {
    const rows = renderBoardCells(viewOf());
    const labels = rows[GRID_ROWS - 1];
    expect(labels[0].glyph).toBe(GLYPH.blank);
    expect(labels.slice(1).map((c) => c.glyph).join("")).toBe("abcdefghi");
  });

  it("每一格的下标与行号列标对得上 — 差一位整盘棋就错位", () => {
    const rows = renderBoardCells(viewOf());
    for (const row of rows) {
      for (const [col, cell] of row.entries()) {
        if (cell.index === null) continue;
        const label = Number(row[0].glyph);
        expect(cell.index, `${label} 行第 ${col} 列`).toBe(
          label * FILES + (col - 1),
        );
      }
    }
  });

  it("棋子格用棋子字形，空点用交叉点字符，九宫内另用一个字符", () => {
    const rows = renderBoardCells(viewOf());
    const cellAt = (index: number) =>
      rows.flat().find((c) => c.index === index)!;

    expect(cellAt(at("e9")).glyph).toBe("帥");
    expect(cellAt(at("e9")).kind).toBe("red");
    expect(cellAt(at("e0")).glyph).toBe("將");
    expect(cellAt(at("e0")).kind).toBe("black");
    // e8 在红方九宫内且是空点
    expect(cellAt(at("e8")).glyph).toBe(GLYPH.palace);
    expect(cellAt(at("e8")).kind).toBe("palace");
    // a5 是普通空点
    expect(cellAt(at("a5")).glyph).toBe(GLYPH.point);
    expect(cellAt(at("a5")).kind).toBe("point");
  });

  it("装饰不写进字形 — 换字符会遮住那一格原本是什么子", () => {
    const target = at("e9");
    const rows = renderBoardCells(viewOf(initialPosition(), {}), {
      cursor: target,
      selected: target,
      targets: new Set([target]),
    });
    const cell = rows.flat().find((c) => c.index === target)!;
    expect(cell.glyph).toBe("帥");
    expect(cell.marks).toContain("cursor");
    expect(cell.marks).toContain("selected");
    // 那一格站着子，落点标记应是「可吃」而不是「可走」
    expect(cell.marks).toContain("capture");
    expect(cell.marks).not.toContain("target");
  });

  it("空的可走点标 target，有子的标 capture — 吃子值得画成两样", () => {
    const empty = at("e5");
    const rows = renderBoardCells(viewOf(), {
      cursor: null,
      selected: null,
      targets: new Set([empty]),
    });
    const cell = rows.flat().find((c) => c.index === empty)!;
    expect(cell.marks).toEqual(["target"]);
  });

  it("最后一手的起点终点都要标出来", () => {
    const view = viewOf(initialPosition(), {
      lastMove: { from: at("b7"), to: at("e7") },
    });
    const rows = renderBoardCells(view).flat();
    expect(rows.find((c) => c.index === at("b7"))!.marks).toContain("last");
    expect(rows.find((c) => c.index === at("e7"))!.marks).toContain("last");
    expect(rows.find((c) => c.index === at("a0"))!.marks).not.toContain("last");
  });

  it("被将军的将/帅带 check 标记", () => {
    const view = viewOf(initialPosition(), { checkSquare: at("e0") });
    const cells = renderBoardCells(view).flat();
    expect(cells.find((c) => c.index === at("e0"))!.marks).toContain("check");
    expect(cells.filter((c) => c.marks.includes("check"))).toHaveLength(1);
  });
});

describe("TUI 状态栏（UI-DESIGN.md §6.3：列出的键必须真的能用）", () => {
  it("轮不到你时不列落子键，但认输照列 — 认输本来就不必等回合", () => {
    const bar = renderStatusBar(viewOf(), false);
    expect(bar).toContain("等待对手");
    expect(bar).toContain("r 认输");
    expect(bar).not.toContain("Enter");
  });

  it("轮到你且未选子时列「Enter 选子」", () => {
    const bar = renderStatusBar(viewOf(), true);
    expect(bar).toContain("Enter 选子");
    expect(bar).not.toContain("落子");
  });

  it("选中之后 Enter 的含义变成落子，说法必须跟着变", () => {
    const bar = renderStatusBar(viewOf(), true, { selected: at("e9") });
    expect(bar).toContain("Enter 落子");
    expect(bar).toContain("Esc 取消选择");
    expect(bar).not.toContain("选子");
  });

  it("开局没得可悔时不列「u 悔棋」，够两手了才列", () => {
    const bar = (ply: number) =>
      renderStatusBar(
        viewOf(initialPosition(), { ply }),
        true,
        { selected: null },
        false,
        SEAT_RED,
      );
    expect(bar(0)).not.toContain("悔棋");
    expect(bar(1)).not.toContain("悔棋");
    expect(bar(2)).toContain("u 悔棋");
  });

  it("列出剩余次数 — 不写的话第 4 次按 u 会收到没头没脑的拒绝", () => {
    const bar = (used: readonly number[]) =>
      renderStatusBar(
        viewOf(initialPosition(), { ply: 4, undoRequestsUsed: used }),
        true,
        { selected: null },
        false,
        SEAT_RED,
      );
    expect(bar([0, 0])).toContain(`u 悔棋(${UNDO_REQUESTS_PER_MATCH})`);
    expect(bar([2, 0])).toContain(`u 悔棋(${UNDO_REQUESTS_PER_MATCH - 2})`);
    // 用光了就不该再列 —— 列了就是骗人（UI-DESIGN.md §6.3）
    expect(bar([UNDO_REQUESTS_PER_MATCH, 0])).not.toContain("悔棋");
  });

  it("观战没有座位，不列悔棋 —— 没有座位就没有额度可言", () => {
    const bar = renderStatusBar(
      viewOf(initialPosition(), { ply: 4 }),
      true,
      { selected: null },
      false,
      null,
    );
    expect(bar).not.toContain("悔棋");
  });

  describe("悔棋请求悬着时", () => {
    // 请求悬着时棋盘是冻住的（服务端会拒绝走子），状态栏必须跟着改口。
    // 照列走子快捷键，玩家会以为还能走，然后收到一串莫名其妙的拒绝。
    const pending = (bySeat: number) =>
      viewOf(initialPosition(), { ply: 4, undoRequest: { bySeat } });

    it("等我答复时只列 y/n，不列走子", () => {
      const bar = renderStatusBar(
        pending(SEAT_BLACK), true, { selected: null }, false, SEAT_RED,
      );
      expect(bar).toContain("对方请求悔棋");
      expect(bar).toContain("y 同意");
      expect(bar).toContain("n 拒绝");
      expect(bar).not.toContain("Enter");
    });

    it("我在等对方答复时说清在等，同样不列走子", () => {
      const bar = renderStatusBar(
        pending(SEAT_RED), true, { selected: null }, false, SEAT_RED,
      );
      expect(bar).toContain("等待对方答复");
      expect(bar).not.toContain("Enter");
      expect(bar).not.toContain("y 同意");
    });
  });

  it("认输待确认压过一切，等待对手时也要显示", () => {
    for (const canAct of [true, false]) {
      const bar = renderStatusBar(viewOf(), canAct, { selected: null }, true);
      expect(bar, `canAct=${canAct}`).toContain("再按一次 r 确认认输");
    }
  });

  describe("限着倒计时", () => {
    // 服务端把剩余回合数算好下发（见 server/local.ts），这里只验「什么时候说、
    // 说什么」。倒计时不是装饰：和棋对双方都不算赢，而入场费在进场时就扣了，
    // 玩家至少该在还来得及变招时知道这盘棋正在走向不分胜负。
    it("离得远时不提示 — 从头挂到尾的警告等于没有警告", () => {
      const bar = renderStatusBar(
        viewOf(initialPosition(), { movesUntilDraw: DRAW_WARN_MOVES + 1 }),
        true,
      );
      expect(bar).not.toContain("限着");
    });

    it("到阈值就提示，并报出真实剩余回合数", () => {
      const bar = renderStatusBar(
        viewOf(initialPosition(), { movesUntilDraw: DRAW_WARN_MOVES }),
        true,
      );
      expect(bar).toContain(`限着还剩 ${DRAW_WARN_MOVES} 回合`);
    });

    it("剩 0 回合照样显示 — 这一手正好判和时不能哑掉", () => {
      expect(
        renderStatusBar(viewOf(initialPosition(), { movesUntilDraw: 0 }), true),
      ).toContain("限着还剩 0 回合");
    });

    it("将军压在倒计时前面 — 两个都急，但没看见将军是直接输", () => {
      const bar = renderStatusBar(
        viewOf(initialPosition(), { checkSquare: at("e0"), movesUntilDraw: 3 }),
        true,
      );
      expect(bar.startsWith("将军！")).toBe(true);
      expect(bar).toContain("限着还剩 3 回合");
      expect(bar.indexOf("将军！")).toBeLessThan(bar.indexOf("限着"));
    });

    it("终局后不再提示 — 已经和了还倒数是自相矛盾", () => {
      const bar = renderStatusBar(
        viewOf(initialPosition(), {
          movesUntilDraw: 0,
          result: { kind: "draw_natural_limit" },
        }),
        true,
      );
      expect(bar).not.toContain("还剩");
    });
  });
  it("将军提示排在最前 — 这是唯一一个没看见就直接输的状态", () => {
    const view = viewOf(initialPosition(), { checkSquare: at("e0") });
    expect(renderStatusBar(view, true).startsWith("将军！")).toBe(true);
    expect(renderStatusBar(viewOf(), true).startsWith("将军！")).toBe(false);
  });

  it("终局只报结果，不再列对局操作", () => {
    const view = viewOf(initialPosition(), {
      result: { kind: "checkmate", winner: "red" },
    });
    const bar = renderStatusBar(view, false);
    expect(bar).toContain("终局");
    expect(bar).toContain("红方胜");
    expect(bar).not.toContain("Enter");
    expect(bar).not.toContain("认输 ");
  });

  it("困毙判负不判和 — 措辞含糊会让人以为是和棋", () => {
    expect(verdictText({ kind: "stalemate", winner: "red" })).toBe(
      "红方胜 · 困毙",
    );
    expect(verdictText({ kind: "checkmate", winner: "black" })).toBe(
      "黑方胜 · 将死",
    );
    expect(verdictText({ kind: "resign", winner: "black" })).toBe(
      "黑方胜 · 对方认输",
    );
    expect(verdictText({ kind: "stalemate", winner: "red" })).not.toContain(
      "和",
    );
  });

  it("长将判负说清是谁长将 — winner 是被将的一方，措辞不能反", () => {
    expect(verdictText({ kind: "perpetual_check", winner: "black" })).toBe(
      "黑方胜 · 对方长将",
    );
  });

  it.each([
    ["draw_natural_limit", "和棋 · 自然限着"],
    ["draw_material", "和棋 · 双方无攻击子力"],
    ["draw_repetition", "和棋 · 三次重复局面"],
  ] as const)("和棋不说成谁胜 — %s", (kind, text) => {
    // 这里守的是一个真实存在过的 bug：verdictText 曾经无条件读 result.winner，
    // 和棋（无 winner）会被渲染成「黑方胜」——玩家看到的结果与结算相反。
    const verdict = verdictText({ kind });
    expect(verdict).toBe(text);
    expect(verdict).not.toContain("胜");
  });

  it("和棋在状态栏里同样不带胜方", () => {
    // verdictText 单独对不代表界面上就对：状态栏是玩家真正看到的那一行。
    const bar = renderStatusBar(
      viewOf(initialPosition(), { result: { kind: "draw_repetition" } }),
      false,
    );
    expect(bar).toContain("和棋 · 三次重复局面");
    expect(bar).not.toContain("胜");
  });

  it("被吃的子双方都看得见，才谈得上公平", () => {
    expect(capturedText(viewOf())).toBe("被吃 红:无 黑:无");
    const view = viewOf(initialPosition(), {
      captured: [
        { type: "P", side: "black" },
        { type: "R", side: "red" },
        { type: "N", side: "black" },
      ],
    });
    expect(capturedText(view)).toBe("被吃 红:俥 黑:卒馬");
  });
});

describe("TUI 渲染器", () => {
  function mountTui(snapshot = snapshotOf()) {
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiXiangqiRenderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    const root = host.firstElementChild as HTMLElement;
    const press = (key: string) =>
      root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return { host, root, renderer, intents, press };
  }

  const markIndex = (host: HTMLElement, mark: string): number | null => {
    const el = host.querySelector(`.bro-xiangqi-tui__cell--${mark}`);
    return el ? Number((el as HTMLElement).dataset.index) : null;
  };

  it("复用共享 TUI 外观类，不另起一套", () => {
    const { host, root } = mountTui();
    expect(root.classList.contains("tui")).toBe(true);
    expect(root.classList.contains("bro-xiangqi-tui")).toBe(true);
    expect(host.querySelector(".tui-statusbar")).not.toBeNull();
    expect(host.querySelector('[role="grid"]')).not.toBeNull();
  });

  it("渲染出 12×10 个格子，与纯函数排版一致", () => {
    const { host } = mountTui();
    expect(host.querySelectorAll(".bro-xiangqi-tui__cell")).toHaveLength(
      GRID_ROWS * GRID_COLS,
    );
  });

  it("光标默认落在本方帅位", () => {
    const { host } = mountTui();
    expect(markIndex(host, "cursor")).toBe(at("e9"));
  });

  it("hjkl 与方向键移动光标", () => {
    const { host, press } = mountTui();
    press("h");
    expect(markIndex(host, "cursor")).toBe(at("d9"));
    press("ArrowRight");
    expect(markIndex(host, "cursor")).toBe(at("e9"));
    press("k");
    expect(markIndex(host, "cursor")).toBe(at("e8"));
    press("ArrowDown");
    expect(markIndex(host, "cursor")).toBe(at("e9"));
  });

  it("光标撞到边界就停住，不绕到对侧行", () => {
    const { host, press } = mountTui();
    for (let i = 0; i < 12; i += 1) press("h");
    expect(markIndex(host, "cursor")).toBe(at("a9"));
    for (let i = 0; i < 12; i += 1) press("j");
    expect(markIndex(host, "cursor")).toBe(at("a9"));
    for (let i = 0; i < 12; i += 1) press("k");
    expect(markIndex(host, "cursor")).toBe(at("a0"));
    for (let i = 0; i < 12; i += 1) press("l");
    expect(markIndex(host, "cursor")).toBe(at("i0"));
  });

  it("两步走子：先 Enter 选子，再 Enter 才上报意图", () => {
    const { host, intents, press } = mountTui();
    press("Enter");
    expect(intents).toEqual([]);
    expect(markIndex(host, "selected")).toBe(at("e9"));
    // 选中后可走点要亮出来，否则玩家不知道能走哪
    expect(host.querySelectorAll(".bro-xiangqi-tui__cell--target").length)
      .toBeGreaterThan(0);

    press("k");
    press("Enter");
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      matchId: "m1",
      basedOnVersion: 1,
      type: "xiangqi/move",
      payload: { from: at("e9"), to: at("e8") },
    });
  });

  it("Esc 取消选择，可走点一并收起", () => {
    const { host, press } = mountTui();
    press("Enter");
    press("Escape");
    expect(markIndex(host, "selected")).toBeNull();
    expect(host.querySelectorAll(".bro-xiangqi-tui__cell--target")).toHaveLength(
      0,
    );
  });

  it("在非法落点按 Enter 不上报 — 不必惊动服务端", () => {
    const { intents, press } = mountTui();
    press("Enter"); // 选中帅
    for (let i = 0; i < 4; i += 1) press("h"); // 走到 a9，帅去不了
    press("Enter");
    expect(intents).toEqual([]);
  });

  it("u 悔棋：够两手才发，开局按了没反应", () => {
    const fresh = mountTui();
    fresh.press("u");
    expect(fresh.intents).toEqual([]);

    const late = mountTui(snapshotOf(viewOf(initialPosition(), { ply: 4 })));
    late.press("u");
    expect(late.intents).toHaveLength(1);
    // 发的是**请求**，不是「已经悔了」。局面退不退由对方答复决定。
    expect(late.intents[0].type).toBe("xiangqi/undo-request");
  });

  it("额度用光后按 u 不发意图 — 与状态栏不列它保持一致", () => {
    const { intents, press } = mountTui(
      snapshotOf(
        viewOf(initialPosition(), {
          ply: 4,
          undoRequestsUsed: [UNDO_REQUESTS_PER_MATCH, 0],
        }),
      ),
    );
    press("u");
    expect(intents).toEqual([]);
  });

  describe("悔棋请求悬着时的键盘", () => {
    const awaiting = () =>
      snapshotOf(
        viewOf(initialPosition(), {
          ply: 4,
          undoRequest: { bySeat: SEAT_BLACK },
        }),
      );

    it("y 同意 / n 拒绝", () => {
      const yes = mountTui(awaiting());
      yes.press("y");
      expect(yes.intents.map((i) => i.type)).toEqual(["xiangqi/undo-accept"]);

      const no = mountTui(awaiting());
      no.press("n");
      expect(no.intents.map((i) => i.type)).toEqual(["xiangqi/undo-decline"]);
    });

    it("其余按键一概不响应 — 棋盘此刻是冻住的", () => {
      const { intents, press } = mountTui(awaiting());
      press("Enter"); // 选子
      press("k");
      press("Enter"); // 落子
      press("u"); // 反手再提一个请求
      press("r"); // 认输
      press("r");
      expect(intents).toEqual([]);
    });

    it("自己发的请求还悬着时按 u 不再发一个", () => {
      // 上一条走的是「对方发的请求」，那会被 awaitingMyReply 提前短路掉，压根
      // 到不了 canRequestUndo。自己发的请求悬着时短路不成立，键盘会一路落到
      // `u` 分支——此时唯一挡住重复发起的就是 canRequestUndo 里那句「已有请求
      // 就不许再发」。两个请求并存，答复该落到哪个上就没有确定答案了。
      const { intents, press } = mountTui(
        snapshotOf(
          viewOf(initialPosition(), {
            ply: 4,
            undoRequest: { bySeat: SEAT_RED },
          }),
        ),
      );
      press("u");
      expect(intents).toEqual([]);
    });
  });

  it("轮不到你时不能悔棋，但可以认输", () => {
    const { intents, press } = mountTui(
      snapshotOf(viewOf(initialPosition(), { ply: 4 }), { activeSeat: 1 }),
    );
    press("u");
    expect(intents).toEqual([]);
    press("r");
    press("r");
    expect(intents).toHaveLength(1);
    expect(intents[0].type).toBe("xiangqi/resign");
  });

  it("轮不到你时 Enter 走不出棋 — 只有认输不必等回合，走子必须等", () => {
    const { intents, press } = mountTui(snapshotOf(viewOf(), { activeSeat: 1 }));
    press("Enter"); // 选帅
    press("k"); // 光标移到 e8
    press("Enter"); // 落子
    expect(intents).toEqual([]);
  });

  it("认输要按两次 r — 不可撤销的操作必须二次确认", () => {
    const { host, intents, press } = mountTui();
    press("r");
    expect(intents).toEqual([]);
    expect(host.querySelector(".tui-statusbar")?.textContent).toContain(
      "再按一次 r 确认认输",
    );
    press("r");
    expect(intents).toHaveLength(1);
    expect(intents[0].type).toBe("xiangqi/resign");
  });

  it("按了别的键就取消认输待确认 — 否则下一次误触直接判负", () => {
    const { host, intents, press } = mountTui();
    press("r");
    press("h");
    expect(host.querySelector(".tui-statusbar")?.textContent).not.toContain(
      "确认认输",
    );
    press("r");
    expect(intents).toEqual([]);
  });

  it("选中的子被吃掉后选中态自动清掉 — 悬空的选中点会照过期的表发意图", () => {
    const { host, renderer } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(markIndex(host, "selected")).toBe(at("e9"));

    // 下一帧那一格空了（被吃或悔棋退了回去）
    const gone = positionFrom("red", { e0: "k", a0: "r" });
    renderer.render(snapshotOf(viewOf(gone), { version: 2 }));
    expect(markIndex(host, "selected")).toBeNull();
  });

  it("观战者不上报任何意图", () => {
    const { intents, press } = mountTui(snapshotOf(viewOf(), { mySeat: null }));
    press("Enter");
    press("Enter");
    press("r");
    press("r");
    expect(intents).toEqual([]);
  });

  it("终局后不再上报意图", () => {
    const view = viewOf(initialPosition(), {
      result: { kind: "resign", winner: "black" },
      ply: 6,
    });
    const { intents, press } = mountTui(
      snapshotOf(view, { phase: "finished", activeSeat: null }),
    );
    press("Enter");
    press("Enter");
    press("u");
    press("r");
    press("r");
    expect(intents).toEqual([]);
  });

  it("状态栏跟随行动权变化", () => {
    const { host, renderer } = mountTui();
    const status = host.querySelector(".tui-statusbar");
    expect(status?.textContent).toContain("Enter");
    renderer.render(snapshotOf(viewOf(), { version: 2, activeSeat: 1 }));
    expect(status?.textContent).toContain("等待对手");
  });

  it("卸载后移除节点并停止响应键盘", () => {
    const { host, root, renderer, intents } = mountTui();
    renderer.unmount();
    expect(host.children).toHaveLength(0);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
  });
});

/**
 * 最小 2D 上下文替身。
 *
 * jsdom 不实现 `getContext`，于是 `draw()` 整段在测试里一次都没执行过。
 * 这个替身把绘制调用记下来，让「到底画了什么」变成能断言的东西。
 *
 * 记圆与文字：象棋盘上有意义的图元是棋子（圆 + 字）与各类标记环（圆），
 * 线条画歪了肉眼一望即知，不值得在这里断言。
 */
function fakeContext() {
  const circles: {
    x: number;
    y: number;
    r: number;
    op: "fill" | "stroke";
    style: string;
    lineWidth: number;
    alpha: number;
  }[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
  const stack: number[] = [];
  let pending: { x: number; y: number; r: number } | null = null;

  const ctx = {
    fillStyle: "" as unknown as string,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {
      pending = null;
    },
    arc: (x: number, y: number, r: number) => {
      pending = { x, y, r };
    },
    fill: () => {
      if (pending) {
        circles.push({
          ...pending,
          op: "fill",
          style: String(ctx.fillStyle),
          lineWidth: ctx.lineWidth,
          alpha: ctx.globalAlpha,
        });
      }
    },
    stroke: () => {
      if (pending) {
        circles.push({
          ...pending,
          op: "stroke",
          style: ctx.strokeStyle,
          lineWidth: ctx.lineWidth,
          alpha: ctx.globalAlpha,
        });
      }
    },
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    moveTo: () => {},
    lineTo: () => {},
    // 透明度要真的入栈出栈，否则半透明的悬停提示会「漏」到后续绘制上
    save: () => stack.push(ctx.globalAlpha),
    restore: () => {
      ctx.globalAlpha = stack.pop() ?? 1;
    },
    setTransform: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };

  return { ctx, circles, texts };
}

describe("Canvas 渲染器", () => {
  const WIDTH = 500;
  const HEIGHT = 550;
  const layout = computeLayout(WIDTH, HEIGHT);

  function mountCanvas(snapshot = snapshotOf()) {
    const host = document.createElement("div");
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

    const renderer = new CanvasXiangqiRenderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    spy.mockRestore();

    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    const click = (index: number) => {
      const { x, y } = pointToPixel(layout, index);
      canvas.dispatchEvent(
        new MouseEvent("click", { clientX: x, clientY: y }),
      );
    };
    const hover = (index: number) => {
      const { x, y } = pointToPixel(layout, index);
      canvas.dispatchEvent(
        new MouseEvent("mousemove", { clientX: x, clientY: y }),
      );
    };
    return { host, canvas, renderer, intents, click, hover, ...gfx };
  }

  it("开局画出 32 个子的字，外加楚河汉界", () => {
    const { texts } = mountCanvas();
    const pieces = texts.filter((t) => t.text.length === 1);
    expect(pieces).toHaveLength(32);
    expect(texts.map((t) => t.text)).toContain("楚 河");
    expect(texts.map((t) => t.text)).toContain("漢 界");
  });

  it("棋子的字画在对应交叉点上", () => {
    const { texts } = mountCanvas();
    const king = pointToPixel(layout, at("e9"));
    expect(texts.some((t) => t.text === "帥" && t.x === king.x && t.y === king.y))
      .toBe(true);
  });

  it("红子比黑子多画一圈 — 颜色之外还得有个形状差异（§9）", () => {
    const onlyRed = mountCanvas(
      snapshotOf(viewOf(positionFrom("red", { e9: "K" }))),
    );
    const onlyBlack = mountCanvas(
      snapshotOf(viewOf(positionFrom("red", { e0: "k" }))),
    );
    const ringsAt = (g: ReturnType<typeof mountCanvas>, index: number) => {
      const p = pointToPixel(layout, index);
      return g.circles.filter((c) => c.x === p.x && c.y === p.y).length;
    };
    expect(ringsAt(onlyRed, at("e9"))).toBe(ringsAt(onlyBlack, at("e0")) + 1);
  });

  it("未选中时不画可走点 — 开局就满盘圆点没法看", () => {
    const { circles } = mountCanvas();
    const dots = circles.filter(
      (c) => Math.abs(c.r - layout.radius * 0.28) < 0.001,
    );
    expect(dots).toEqual([]);
  });

  it("点己方子后亮出全部可走点，空点画点、可吃的画环", () => {
    // 两个将不同列，否则「白脸将」会把一大半着法判非法，可走点数对不上
    const pos = positionFrom("red", { e9: "K", d0: "k", a5: "R", a2: "p" });
    const view = viewOf(pos);
    const { circles, click } = mountCanvas(snapshotOf(view));
    const before = circles.length;
    click(at("a5"));

    const targets = view.legalMoves
      .filter((m) => m.from === at("a5"))
      .map((m) => m.to);
    const captures = targets.filter((t) => view.board[t] != null);
    expect(captures).toEqual([at("a2")]);

    const added = circles.slice(before);
    const dots = added.filter(
      (c) => Math.abs(c.r - layout.radius * 0.28) < 0.001,
    );
    const rings = added.filter(
      (c) => Math.abs(c.r - layout.radius * 1.12) < 0.001,
    );
    expect(dots).toHaveLength(targets.length - captures.length);
    expect(rings).toHaveLength(captures.length);
    expect(rings[0]).toMatchObject(pointToPixel(layout, at("a2")));
  });

  it("两步走子：第一下只选中不发意图，第二下才发", () => {
    const { intents, click } = mountCanvas();
    click(at("e9"));
    expect(intents).toEqual([]);
    click(at("e8"));
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      type: "xiangqi/move",
      payload: { from: at("e9"), to: at("e8") },
    });
  });

  it("再点一次已选中的子就取消，不会走成一步原地不动的棋", () => {
    const { intents, click } = mountCanvas();
    click(at("e9"));
    click(at("e9"));
    click(at("e8"));
    expect(intents).toEqual([]);
  });

  it("走完一步立刻清掉选中态 — 留着的话同一个起点会被连发两次", () => {
    const { intents, click } = mountCanvas();
    click(at("e9"));
    click(at("e8")); // 第一步：e9 → e8
    expect(intents).toHaveLength(1);

    // 服务端还没回快照，棋盘上帅仍在 e9、e8 仍是空点。选中态若没清，这一下
    // 会再次命中「e9 的可走点 e8」，凭空多发一步一模一样的意图
    click(at("e8"));
    expect(intents).toHaveLength(1);
  });

  it("上报的是快照当前版本 — 版本错一位每一手都会被判为过期", () => {
    const snapshot = snapshotOf(viewOf(), { version: 7 });
    const { intents, click } = mountCanvas(snapshot);
    click(at("e9"));
    click(at("e8"));
    expect(intents[0]).toMatchObject({
      matchId: snapshot.matchId,
      basedOnVersion: 7,
    });
  });

  it("选中的子被吃掉后选中态自动清掉 — 悬空的选中点会照过期的表发意图", () => {
    const { circles, click, renderer } = mountCanvas();
    click(at("e9"));
    const selectionRing = (from: number) =>
      circles
        .slice(from)
        .filter((c) => Math.abs(c.r - layout.radius * 1.16) < 0.001);
    expect(selectionRing(0)).not.toEqual([]);

    // 下一帧那一格空了（被吃或悔棋退了回去），选中环必须一并消失。
    // 断言画面而不是意图：悬空选中点最直接的症状就是棋盘上挂着一个
    // 指向空格的黄圈，而那个圈会诱使玩家照着一张过期的可走点表落子
    const mark = circles.length;
    renderer.render(
      snapshotOf(viewOf(positionFrom("red", { e0: "k", d9: "K" })), {
        version: 2,
      }),
    );
    expect(selectionRing(mark)).toEqual([]);
  });

  it("点在棋盘外不上报", () => {
    const { canvas, intents } = mountCanvas();
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 2, clientY: 2 }));
    expect(intents).toEqual([]);
  });

  it("轮不到本人时点击不上报", () => {
    const { intents, click } = mountCanvas(
      snapshotOf(viewOf(), { activeSeat: 1 }),
    );
    click(at("e9"));
    click(at("e8"));
    expect(intents).toEqual([]);
  });

  it("将军格画最粗的一圈，且压在所有标记之上", () => {
    const view = viewOf(initialPosition(), { checkSquare: at("e0") });
    const { circles } = mountCanvas(snapshotOf(view));
    const ring = circles.filter(
      (c) => Math.abs(c.r - layout.radius * 1.24) < 0.001,
    );
    expect(ring).toHaveLength(1);
    expect(ring[0]).toMatchObject(pointToPixel(layout, at("e0")));
    // 最后一个绘制的圆就是它（后面只剩悬停，此处没有悬停）
    expect(circles.at(-1)).toMatchObject({ r: layout.radius * 1.24 });
  });

  it("没有将军就不画那圈红环", () => {
    const { circles } = mountCanvas();
    expect(
      circles.some((c) => Math.abs(c.r - layout.radius * 1.24) < 0.001),
    ).toBe(false);
  });

  it("悬停只在点了会有反应的格子上给反馈", () => {
    const { circles, hover } = mountCanvas();
    const before = circles.length;
    hover(at("e9")); // 己方帅，点了会选中
    expect(circles.slice(before).some((c) => c.alpha < 1)).toBe(true);

    const mid = circles.length;
    hover(at("e5")); // 空点，未选中时点了没反应
    expect(circles.slice(mid).some((c) => c.alpha < 1)).toBe(false);
  });

  it("半透明只作用于悬停提示 — save/restore 漏了会让整盘棋发灰", () => {
    const { circles, hover, canvas } = mountCanvas();
    hover(at("e9"));
    canvas.dispatchEvent(new MouseEvent("mouseleave"));
    expect(circles.at(-1)!.alpha).toBe(1);
  });

  it("按设备像素比放大位图，再用 CSS 缩回去", () => {
    // jsdom 的 devicePixelRatio 恒为 1，不改这个值的话「读了 DPR」与
    // 「写死 1」两种实现完全等价，测了等于没测
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    try {
      const { canvas } = mountCanvas();
      expect(canvas.width).toBe(Math.round(layout.width * 2));
      expect(canvas.height).toBe(Math.round(layout.height * 2));
      expect(canvas.style.width).toBe(`${layout.width}px`);
      expect(canvas.style.height).toBe(`${layout.height}px`);
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

describe("切主题不重开局（真渲染器）", () => {
  it("Canvas 换成 TUI 后局面原样保留", () => {
    const pos = positionFrom("red", { e9: "K", e0: "k", a5: "R" });
    const snapshot = snapshotOf(viewOf(pos), { version: 7 });

    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<XiangqiView>(() => {});
    session.applySnapshot(snapshot);

    session.attachRenderer(new CanvasXiangqiRenderer(), host);
    expect(host.querySelector("canvas")).not.toBeNull();

    session.attachRenderer(new TuiXiangqiRenderer(), host);
    // 旧渲染器的节点必须被清掉，否则两套画面会叠在一起
    expect(host.querySelector("canvas")).toBeNull();

    const cellAt = (index: number) =>
      host.querySelector(`[data-index="${index}"]`)?.textContent;
    expect(cellAt(at("e9"))).toBe("帥");
    expect(cellAt(at("e0"))).toBe("將");
    expect(cellAt(at("a5"))).toBe("俥");
    expect(session.currentState()?.version).toBe(7);
  });

  it("换渲染器后新渲染器的意图仍能送达", () => {
    const sent: InputIntent[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<XiangqiView>((i) => sent.push(i));
    session.applySnapshot(snapshotOf());

    session.attachRenderer(new CanvasXiangqiRenderer(), host);
    session.attachRenderer(new TuiXiangqiRenderer(), host);

    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({ from: at("e9"), to: at("e8") });
  });
});
