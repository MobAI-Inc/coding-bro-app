/**
 * 围棋渲染层测试。
 *
 * 渲染层被刻意切成三块：几何换算（layout）、字符排版（tui-text）、DOM
 * 与事件（tui）。前两块是纯函数，可以逐像素、逐字符地断言；只有第三块
 * 需要 DOM。这么切不是为了洁癖，是因为 jsdom 里没有 2D 上下文——布局
 * 若写在 Canvas 渲染器内部，就一行都测不了。
 *
 * 本文件不测「画得好不好看」，只测会导致误判棋形的东西：棋盘是不是
 * 正方形、点击有没有落到该落的交叉点、字符网格有没有错位。
 */

import { describe, expect, it, vi } from "vitest";
import {
  computeLayout,
  pixelToPoint,
  pointToPixel,
  starPoints,
} from "@/bro/games/go/render/layout";
import {
  GLYPH,
  coordLabel,
  cursorTextOffset,
  renderBoardText,
  renderStatusBar,
} from "@/bro/games/go/render/tui-text";
import { TuiGoRenderer } from "@/bro/games/go/render/tui";
import { CanvasGoRenderer } from "@/bro/games/go/render/canvas";
import { GameSession } from "@/bro/games/core/session";
import type { InputIntent } from "@/bro/games/core/types";
import { BLACK, EMPTY, WHITE } from "@/bro/games/go/logic";
import type { BoardSize, Stone } from "@/bro/games/go/logic";
import type { GoSnapshot, GoView } from "@/bro/games/go/view";

/** 造一个视图。`cells` 缺省为空盘，其余字段取无害默认值。 */
function viewOf(size: BoardSize, cells?: Stone[]): GoView {
  return {
    size,
    cells: cells ?? new Array<Stone>(size * size).fill(EMPTY),
    koPoint: null,
    captures: { black: 0, white: 0 },
    lastMove: null,
    passes: 0,
    score: null,
  };
}

function snapshotOf(view: GoView, over: Partial<GoSnapshot> = {}): GoSnapshot {
  return {
    matchId: "m1",
    gameId: "go",
    phase: "playing",
    version: 1,
    activeSeat: 0,
    mySeat: 0,
    board: view,
    ...over,
  };
}

describe("布局几何", () => {
  it("容器非正方时取短边 — 拉伸的棋盘会让人误判棋形", () => {
    const wide = computeLayout(19, 800, 400);
    const tall = computeLayout(19, 400, 800);
    expect(wide.extent).toBe(400);
    expect(tall.extent).toBe(400);
    expect(wide.step).toBe(tall.step);
  });

  it("四周留白相等 — 边线上的子不会被裁掉半个", () => {
    const layout = computeLayout(9, 600, 600);
    const first = pointToPixel(layout, 0);
    const last = pointToPixel(layout, 9 * 9 - 1);
    const leading = first.x;
    const trailing = layout.extent - last.x;
    expect(leading).toBeCloseTo(trailing, 6);
    // 留白至少要够半颗子，否则边上的子会压在画布边缘
    expect(leading).toBeGreaterThan(layout.radius);
  });

  it("棋子直径小于线距 — 相邻两子之间必须留缝，否则糊成一片数不清", () => {
    const layout = computeLayout(19, 720, 720);
    expect(layout.radius * 2).toBeLessThan(layout.step);
  });

  it("交叉点与像素互为逆映射", () => {
    const layout = computeLayout(9, 500, 500);
    for (let i = 0; i < 81; i += 1) {
      const { x, y } = pointToPixel(layout, i);
      expect(pixelToPoint(layout, x, y)).toBe(i);
    }
  });

  it("点在格子正中不吸附 — 围棋落子不可悔，宁可不响应也不能落错", () => {
    const layout = computeLayout(9, 500, 500);
    const a = pointToPixel(layout, 0);
    // 四个交叉点围出的方格中心，到任一交叉点的距离都是 0.707 格
    const center = { x: a.x + layout.step / 2, y: a.y + layout.step / 2 };
    expect(pixelToPoint(layout, center.x, center.y)).toBeNull();
  });

  it("点在棋盘外返回 null，不会环绕到对侧", () => {
    const layout = computeLayout(9, 500, 500);
    const last = pointToPixel(layout, 80);
    expect(pixelToPoint(layout, last.x + layout.step, last.y)).toBeNull();
    expect(pixelToPoint(layout, -layout.step, 0)).toBeNull();
    expect(
      pixelToPoint(layout, last.x + layout.step, last.y - layout.step),
    ).toBeNull();
  });

  it("点在棋盘正下方一格返回 null — 只靠距离判断挡不住这一处", () => {
    // 越界判断若被去掉，行号 9（盘外一行）会被 pointToPixel 原样还原成
    // 同一个坐标，距离为 0 于是「命中」下标 81——一个不存在的交叉点。
    // 左右越界会因为坐标对不上被距离判断顺手挡下，唯独下边界不会。
    const layout = computeLayout(9, 500, 500);
    for (let col = 0; col < 9; col += 1) {
      const below = pointToPixel(layout, 8 * 9 + col);
      const hit = pixelToPoint(layout, below.x, below.y + layout.step);
      expect(hit, `第 ${col} 列下方`).toBeNull();
    }
  });
});

describe("星位", () => {
  it("19 路九个星位，取 4/10/16 线", () => {
    const points = starPoints(19);
    expect(points).toHaveLength(9);
    expect(new Set(points).size).toBe(9);
    // 左上小目星位是 4 线交点，即下标 (3,3)
    expect(points).toContain(3 * 19 + 3);
    // 天元只出现一次，不因为「补一个中心」而重复
    expect(points.filter((p) => p === 9 * 19 + 9)).toHaveLength(1);
  });

  it("13 路与 9 路各五个 — 四角加天元", () => {
    for (const size of [13, 9] as const) {
      const points = starPoints(size);
      expect(points, `${size} 路`).toHaveLength(5);
      expect(new Set(points).size, `${size} 路去重后`).toBe(5);
      const center = (size - 1) / 2;
      expect(points, `${size} 路天元`).toContain(center * size + center);
    }
  });

  it("星位全部落在盘内且上下左右对称", () => {
    for (const size of [19, 13, 9] as const) {
      const points = starPoints(size);
      const mirrored = points.map((p) => {
        const row = Math.floor(p / size);
        const col = p % size;
        return (size - 1 - row) * size + (size - 1 - col);
      });
      expect(points.every((p) => p >= 0 && p < size * size)).toBe(true);
      expect(new Set(mirrored)).toEqual(new Set(points));
    }
  });
});

describe("TUI 字符排版", () => {
  it("每行字符数一致 — 长短不齐的行会让整个网格错位", () => {
    for (const size of [19, 13, 9] as const) {
      const lines = renderBoardText(viewOf(size)).split("\n");
      // size 行棋盘 + 1 行列标
      expect(lines, `${size} 路行数`).toHaveLength(size + 1);
      const widths = new Set(lines.map((l) => l.length));
      expect(widths.size, `${size} 路行宽种类`).toBe(1);
    }
  });

  it("有子与空盘的行宽相同 — 连接线换成空格不能改变宽度", () => {
    const dense: Stone[] = Array.from({ length: 81 }, (_, i) =>
      i % 3 === 0 ? BLACK : i % 3 === 1 ? WHITE : EMPTY,
    );
    const empty = renderBoardText(viewOf(9)).split("\n");
    const full = renderBoardText(viewOf(9, dense)).split("\n");
    expect(full.map((l) => l.length)).toEqual(empty.map((l) => l.length));
  });

  it("行号自上而下递减 — 用数组下标当行号会让整份棋谱对不上", () => {
    const lines = renderBoardText(viewOf(19)).split("\n");
    expect(lines[0].startsWith("19")).toBe(true);
    expect(lines[18].startsWith(" 1")).toBe(true);
  });

  it("列标跳过 I — I 与 1 在等宽字体里几乎一样", () => {
    const lines = renderBoardText(viewOf(19)).split("\n");
    const labels = lines[lines.length - 1].replace(/\s/g, "");
    expect(labels).toBe("ABCDEFGHJKLMNOPQRST");
    expect(labels).not.toContain("I");
  });

  it("星位与普通交叉点字符不同", () => {
    const text = renderBoardText(viewOf(19));
    expect(text).toContain(GLYPH.star);
    expect(text).toContain(GLYPH.intersection);
    const stars = [...text].filter((c) => c === GLYPH.star);
    expect(stars).toHaveLength(9);
  });

  it("棋子两侧不画连接线 — 否则两颗子看着像连成一体", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[9 * 4 + 4] = BLACK;
    const text = renderBoardText(viewOf(9, cells));
    const at = cursorTextOffset(9, 9 * 4 + 4);
    expect(text[at]).toBe(GLYPH.black);
    expect(text[at - 1]).toBe(" ");
    expect(text[at + 1]).toBe(" ");
  });

  it("空点之间画连接线", () => {
    const text = renderBoardText(viewOf(9));
    const at = cursorTextOffset(9, 9 * 4 + 4);
    expect(text[at - 1]).toBe(GLYPH.link);
    expect(text[at + 1]).toBe(GLYPH.link);
  });

  it("光标偏移落在对应交叉点的字符上 — 逐点验证，差一位就露馅", () => {
    // 三色循环铺满，每个下标的期望字符都不同于邻居，偏移错一位必然被抓到
    const cells: Stone[] = Array.from({ length: 81 }, (_, i) =>
      i % 3 === 0 ? BLACK : i % 3 === 1 ? WHITE : EMPTY,
    );
    const view = viewOf(9, cells);
    const text = renderBoardText(view);
    const stars = new Set(starPoints(9));

    for (let i = 0; i < 81; i += 1) {
      const expected =
        cells[i] === BLACK
          ? GLYPH.black
          : cells[i] === WHITE
            ? GLYPH.white
            : stars.has(i)
              ? GLYPH.star
              : GLYPH.intersection;
      expect(text[cursorTextOffset(9, i)], `下标 ${i}`).toBe(expected);
    }
  });

  it("有子与空盘的光标偏移一致 — 偏移只由坐标决定", () => {
    const cells: Stone[] = Array.from({ length: 81 }, () => BLACK);
    const dense = renderBoardText(viewOf(9, cells));
    const empty = renderBoardText(viewOf(9));
    for (let i = 0; i < 81; i += 1) {
      const at = cursorTextOffset(9, i);
      expect(dense[at]).toBe(GLYPH.black);
      expect(empty[at] === GLYPH.intersection || empty[at] === GLYPH.star).toBe(
        true,
      );
    }
  });

  it("棋谱坐标用字母加行号，且跳过 I", () => {
    expect(coordLabel(19, 0)).toBe("A19");
    expect(coordLabel(19, 19 * 18 + 18)).toBe("T1");
    // 第 9 列（下标 8）是 J，不是 I
    expect(coordLabel(19, 8)).toBe("J19");
  });
});

describe("TUI 状态栏（UI-DESIGN.md §6.3）", () => {
  it("轮不到你时不列出落子快捷键 — 列了就是骗人", () => {
    const bar = renderStatusBar(viewOf(19), false);
    expect(bar).not.toContain("Enter");
    expect(bar).not.toContain("落子");
    expect(bar).toContain("等待对手");
  });

  it("轮到你时列出落子与虚手", () => {
    const bar = renderStatusBar(viewOf(19), true);
    expect(bar).toContain("Enter");
    expect(bar).toContain("落子");
    expect(bar).toContain("虚手");
  });

  it("对方虚手一次要提示，否则玩家不知道再虚一手就终局了", () => {
    const view = { ...viewOf(19), passes: 1 };
    expect(renderStatusBar(view, true)).toContain("再虚一手");
    expect(renderStatusBar(viewOf(19), true)).not.toContain("再虚一手");
  });

  it("终局显示胜负与目数，不再列出对局操作", () => {
    const view: GoView = {
      ...viewOf(19),
      score: { [BLACK]: 100, [WHITE]: 80, winner: BLACK, margin: 12.5 },
    };
    const bar = renderStatusBar(view, false);
    expect(bar).toContain("黑胜");
    expect(bar).toContain("12.5");
    expect(bar).not.toContain("Enter");
  });

  it("提子数始终显示 — 双方都看得见，才谈得上公平", () => {
    const view = { ...viewOf(19), captures: { black: 7, white: 3 } };
    const bar = renderStatusBar(view, true);
    expect(bar).toContain("7");
    expect(bar).toContain("3");
  });
});

describe("TUI 渲染器", () => {
  /** 挂一个渲染器，返回容器与意图收集数组。 */
  function mountTui(snapshot = snapshotOf(viewOf(9))) {
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiGoRenderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    return { host, renderer, intents };
  }

  /** 取光标当前所在的交叉点下标。 */
  function cursorIndex(host: HTMLElement, size: BoardSize): number {
    const span = host.querySelector(".bro-go-tui__cursor");
    const before = span?.previousSibling?.textContent ?? "";
    for (let i = 0; i < size * size; i += 1) {
      if (cursorTextOffset(size, i) === before.length) return i;
    }
    throw new Error(`光标偏移 ${before.length} 不对应任何交叉点`);
  }

  it("挂载后复用共享 TUI 外观类，不另起一套", () => {
    const { host } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    expect(root.classList.contains("tui")).toBe(true);
    expect(host.querySelector("pre")?.classList.contains("tui-grid")).toBe(
      true,
    );
  });

  it("渲染出的文本与纯函数排版一致 — 光标 span 不改变字符内容", () => {
    const view = viewOf(9);
    const { host } = mountTui(snapshotOf(view));
    expect(host.querySelector("pre")?.textContent).toBe(renderBoardText(view));
  });

  it("光标默认落在天元", () => {
    const { host } = mountTui();
    expect(cursorIndex(host, 9)).toBe(9 * 4 + 4);
  });

  it("hjkl 与方向键移动光标", () => {
    const { host } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    const press = (key: string) =>
      root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    press("h");
    expect(cursorIndex(host, 9)).toBe(9 * 4 + 3);
    press("ArrowRight");
    expect(cursorIndex(host, 9)).toBe(9 * 4 + 4);
    press("k");
    expect(cursorIndex(host, 9)).toBe(9 * 3 + 4);
    press("ArrowDown");
    expect(cursorIndex(host, 9)).toBe(9 * 4 + 4);
  });

  it("光标撞到边界就停住，不会绕到对侧行", () => {
    const { host } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    const press = (key: string) =>
      root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    for (let i = 0; i < 10; i += 1) press("h");
    expect(cursorIndex(host, 9)).toBe(9 * 4);
    for (let i = 0; i < 10; i += 1) press("k");
    expect(cursorIndex(host, 9)).toBe(0);
    for (let i = 0; i < 20; i += 1) press("j");
    expect(cursorIndex(host, 9)).toBe(9 * 8);
  });

  it("Enter 上报落子意图，坐标取光标所在点", () => {
    const { host, intents } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      matchId: "m1",
      basedOnVersion: 1,
      type: "go/place",
      payload: { index: 9 * 4 + 5 },
    });
  });

  it("p 上报虚手", () => {
    const { host, intents } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    expect(intents[0]?.type).toBe("go/pass");
  });

  it("已有子的点按 Enter 不上报 — 不必惊动服务端", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[9 * 4 + 4] = WHITE;
    const { host, intents } = mountTui(snapshotOf(viewOf(9, cells)));
    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
  });

  it("轮不到本人时不上报任何意图", () => {
    const { host, intents } = mountTui(
      snapshotOf(viewOf(9), { activeSeat: 1, mySeat: 0 }),
    );
    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    expect(intents).toEqual([]);
  });

  it("观战者不上报意图", () => {
    const { host, intents } = mountTui(
      snapshotOf(viewOf(9), { mySeat: null, activeSeat: 0 }),
    );
    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
  });

  it("状态栏跟随行动权变化 — 与实际可用的按键保持一致", () => {
    const view = viewOf(9);
    const { host, renderer } = mountTui(snapshotOf(view));
    const status = host.querySelector(".bro-go-tui__status");
    expect(status?.textContent).toContain("Enter");

    renderer.render(snapshotOf(view, { version: 2, activeSeat: 1 }));
    expect(status?.textContent).not.toContain("Enter");
  });

  it("卸载后移除节点并停止响应键盘", () => {
    // 注：单独去掉 removeEventListener 这一行，本测试抓不到——unmount 还
    // 会把 handler 与 latest 一并置空，任何一道都能挡住意图。三道一起去掉
    // 才会变红（已验证）。留着摘监听是卫生问题，不是这条断言在保的东西。
    const { host, renderer, intents } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    renderer.unmount();
    expect(host.children).toHaveLength(0);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
  });
});

/**
 * 最小 2D 上下文替身。
 *
 * jsdom 不实现 `getContext`，于是 `draw()` 整段在测试里一次都没执行过——
 * 渲染器里写错一个方法名也发现不了，非要真跑起来才炸。这个替身把绘制
 * 调用记下来，让「到底画了什么」变成能断言的东西。
 *
 * 只记圆：棋盘上有意义的图元全是圆（棋子、星位、最后一手标记），线条
 * 画歪了肉眼一望即知，不值得在这里断言。
 */
function fakeContext() {
  const circles: { x: number; y: number; r: number; alpha: number }[] = [];
  let pending: { x: number; y: number; r: number } | null = null;
  const stack: number[] = [];

  const ctx = {
    fillStyle: "" as unknown,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {
      pending = null;
    },
    arc: (x: number, y: number, r: number) => {
      pending = { x, y, r };
    },
    fill: () => {
      if (pending) circles.push({ ...pending, alpha: ctx.globalAlpha });
    },
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    // 透明度要真的入栈出栈，否则半透明的预览子会「漏」到后续绘制上
    save: () => stack.push(ctx.globalAlpha),
    restore: () => {
      ctx.globalAlpha = stack.pop() ?? 1;
    },
    setTransform: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };

  return { ctx, circles };
}

describe("Canvas 渲染器", () => {
  const SIDE = 500;
  const layout = computeLayout(9, SIDE, SIDE);

  /** 挂一个带真实尺寸与假上下文的 Canvas 渲染器。 */
  function mountCanvas(snapshot = snapshotOf(viewOf(9))) {
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

    const renderer = new CanvasGoRenderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    spy.mockRestore();

    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    return { host, canvas, renderer, intents, ...gfx };
  }

  /** 落在某个交叉点上的鼠标事件坐标。jsdom 里 getBoundingClientRect 全零。 */
  function atPoint(index: number) {
    const { x, y } = pointToPixel(layout, index);
    return { clientX: x, clientY: y };
  }

  it("空盘只画星位 — 画不出东西是这个文件最可能的故障", () => {
    const { circles } = mountCanvas();
    expect(circles).toHaveLength(starPoints(9).length);
    expect(circles.every((c) => c.alpha === 1)).toBe(true);
  });

  it("每颗子画一个圆，半径取布局给的值", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[40] = BLACK;
    cells[41] = WHITE;
    const { circles } = mountCanvas(snapshotOf(viewOf(9, cells)));

    const stones = circles.filter((c) => c.r === layout.radius);
    expect(stones).toHaveLength(2);
    expect(stones.map((s) => s.x)).toEqual([
      pointToPixel(layout, 40).x,
      pointToPixel(layout, 41).x,
    ]);
  });

  it("标记最后一手 — 网络对局里看不出对方下在哪就没法接着走", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[40] = BLACK;
    const marked = mountCanvas(
      snapshotOf({ ...viewOf(9, cells), lastMove: 40 }),
    );
    const plain = mountCanvas(snapshotOf(viewOf(9, cells)));

    expect(marked.circles).toHaveLength(plain.circles.length + 1);
    const marker = marked.circles.at(-1)!;
    expect(marker.r).toBeLessThan(layout.radius);
    expect(marker).toMatchObject(pointToPixel(layout, 40));
  });

  it("悬停画半透明预览子，落子前看得清位置", () => {
    const { canvas, circles } = mountCanvas();
    const before = circles.length;
    canvas.dispatchEvent(new MouseEvent("mousemove", atPoint(40)));

    const ghost = circles.slice(before).find((c) => c.alpha < 1);
    expect(ghost).toBeDefined();
    expect(ghost!.alpha).toBeCloseTo(0.45, 2);
    expect(ghost).toMatchObject(pointToPixel(layout, 40));
  });

  it("轮不到本人时不画预览子 — 画了等于暗示能下", () => {
    const { canvas, circles } = mountCanvas(
      snapshotOf(viewOf(9), { activeSeat: 1 }),
    );
    const before = circles.length;
    canvas.dispatchEvent(new MouseEvent("mousemove", atPoint(40)));
    expect(circles.slice(before).some((c) => c.alpha < 1)).toBe(false);
  });

  it("已有子的点不画预览子", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[40] = WHITE;
    const { canvas, circles } = mountCanvas(snapshotOf(viewOf(9, cells)));
    const before = circles.length;
    canvas.dispatchEvent(new MouseEvent("mousemove", atPoint(40)));
    expect(circles.slice(before).some((c) => c.alpha < 1)).toBe(false);
  });

  it("半透明只作用于预览子 — save/restore 漏了会让整盘棋发灰", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[40] = BLACK;
    const { canvas, circles } = mountCanvas(snapshotOf(viewOf(9, cells)));
    canvas.dispatchEvent(new MouseEvent("mousemove", atPoint(41)));
    // 重绘一次，若透明度没被还原，这一帧的实体子会带上 0.45
    canvas.dispatchEvent(new MouseEvent("mouseleave", {}));
    expect(circles.at(-1)!.alpha).toBe(1);
  });

  it("按设备像素比放大位图，再用 CSS 缩回去 — 否则高分屏上线条发虚", () => {
    // jsdom 的 devicePixelRatio 恒为 1，不改这个值的话「读了 DPR」与
    // 「写死 1」两种实现完全等价，测了等于没测
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    try {
      const { canvas } = mountCanvas();
      expect(canvas.width).toBe(layout.extent * 2);
      expect(canvas.height).toBe(layout.extent * 2);
      // CSS 尺寸仍是逻辑像素，位图放大不该把棋盘撑成两倍大
      expect(canvas.style.width).toBe(`${layout.extent}px`);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", {
        value: original,
        configurable: true,
      });
    }
  });

  it("点击空点上报落子意图，坐标由像素反推", () => {
    const { canvas, intents } = mountCanvas();
    canvas.dispatchEvent(new MouseEvent("click", atPoint(9 * 2 + 6)));
    expect(intents).toHaveLength(1);
    expect(intents[0].payload).toEqual({ index: 9 * 2 + 6 });
  });

  it("点在棋盘外不上报 — 空点击不该产生意图", () => {
    const { canvas, intents } = mountCanvas();
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 2, clientY: 2 }));
    expect(intents).toEqual([]);
  });

  it("点在已有子的点上不上报", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[40] = WHITE;
    const { canvas, intents } = mountCanvas(snapshotOf(viewOf(9, cells)));
    canvas.dispatchEvent(new MouseEvent("click", atPoint(40)));
    expect(intents).toEqual([]);
  });

  it("轮不到本人时点击不上报", () => {
    const { canvas, intents } = mountCanvas(
      snapshotOf(viewOf(9), { activeSeat: 1 }),
    );
    canvas.dispatchEvent(new MouseEvent("click", atPoint(40)));
    expect(intents).toEqual([]);
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
  it("Canvas 换成 TUI 后棋局原样保留", () => {
    const cells = new Array<Stone>(81).fill(EMPTY);
    cells[9 * 3 + 3] = BLACK;
    cells[9 * 5 + 5] = WHITE;
    const snapshot = snapshotOf(viewOf(9, cells), { version: 7 });

    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<GoView>(() => {});
    session.applySnapshot(snapshot);

    session.attachRenderer(new CanvasGoRenderer(), host);
    expect(host.querySelector("canvas")).not.toBeNull();

    session.attachRenderer(new TuiGoRenderer(), host);
    // 旧渲染器的节点必须被清掉，否则两套画面会叠在一起
    expect(host.querySelector("canvas")).toBeNull();

    const text = host.querySelector("pre")?.textContent ?? "";
    expect(text[cursorTextOffset(9, 9 * 3 + 3)]).toBe(GLYPH.black);
    expect(text[cursorTextOffset(9, 9 * 5 + 5)]).toBe(GLYPH.white);
    expect(session.currentState()?.version).toBe(7);
  });

  it("换渲染器后新渲染器的意图仍能送达", () => {
    const sent: InputIntent[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<GoView>((i) => sent.push(i));
    session.applySnapshot(snapshotOf(viewOf(9)));

    session.attachRenderer(new CanvasGoRenderer(), host);
    session.attachRenderer(new TuiGoRenderer(), host);

    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({ index: 40 });
  });
});
