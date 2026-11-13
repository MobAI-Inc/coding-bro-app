/**
 * 消消乐渲染层测试。
 *
 * 渲染层被刻意切成三块：几何与时序（layout）、字符排版（tui-text）、DOM 与
 * 事件（tui / canvas）。前两块是纯函数，可以逐像素、逐字符、逐毫秒地断言；
 * 只有第三块需要 DOM。这么切不是洁癖——jsdom 里没有 2D 上下文，布局若写在
 * Canvas 渲染器内部就一行都测不了。
 *
 * 本文件不测「画得好不好看」，只测会让人玩不了或看错的东西：格子是不是正
 * 方形、点击有没有落到该落的格、六种元素是不是真的分得开、字符网格有没有
 * 错位、动画会不会挡住操作。
 */

import { describe, expect, it, vi } from "vitest";
import {
  BOARD_PADDING_RATIO,
  CHAIN_STAGGER_MS,
  CLEAR_MS,
  DROP_MS,
  REJECTED_SWAP_MS,
  SWAP_MS,
  cellCenter,
  chainFlashProgress,
  clearedPerColumn,
  computeLayout,
  dropProgress,
  easeOut,
  fallDistance,
  pixelToCell,
  swapProgress,
  timelineDuration,
} from "@/bro/games/match3/render/layout";
import {
  TILE_GLYPHS,
  cellTextOffset,
  clearedTextOffsets,
  glyphOf,
  renderBoardText,
  renderProgressBar,
  renderStatsLine,
  renderStatusBar,
} from "@/bro/games/match3/render/tui-text";
import { TuiMatch3Renderer } from "@/bro/games/match3/render/tui";
import { CanvasMatch3Renderer } from "@/bro/games/match3/render/canvas";
import { GameSession } from "@/bro/games/core/session";
import type { InputIntent } from "@/bro/games/core/types";
import type { Pos, TileKind } from "@/bro/games/match3/logic";
import type {
  Match3Snapshot,
  Match3Step,
  Match3View,
} from "@/bro/games/match3/view";
import {
  goalProgress,
  movesLeft,
  totalGained,
  viewCellsOf,
} from "@/bro/games/match3/view";

/* ============================================================
   夹具
   ============================================================ */

interface ViewOverrides {
  readonly cells?: TileKind[];
  readonly steps?: Match3Step[];
  readonly lastSwap?: readonly [Pos, Pos] | null;
  readonly score?: number;
  readonly targetScore?: number;
  readonly movesUsed?: number;
  readonly moveLimit?: number;
  readonly bestChain?: number;
  readonly reshuffled?: boolean;
  readonly outcome?: Match3View["outcome"];
}

/** 造一个视图。默认 4×4、四种元素循环铺开，保证相邻格永不同类。 */
function viewOf(width = 4, height = 4, over: ViewOverrides = {}): Match3View {
  const cells =
    over.cells ??
    Array.from({ length: width * height }, (_, i) => {
      const row = Math.floor(i / width);
      const col = i % width;
      return (row + col * 2) % 4;
    });
  return {
    width,
    height,
    kinds: 6,
    cells,
    score: over.score ?? 0,
    targetScore: over.targetScore ?? 1000,
    movesUsed: over.movesUsed ?? 0,
    moveLimit: over.moveLimit ?? 25,
    seed: 42,
    lastSwap: over.lastSwap ?? null,
    steps: over.steps ?? [],
    bestChain: over.bestChain ?? 0,
    reshuffled: over.reshuffled ?? false,
    outcome: over.outcome ?? null,
  };
}

function snapshotOf(
  view: Match3View,
  over: Partial<Match3Snapshot> = {},
): Match3Snapshot {
  return {
    matchId: "m1",
    gameId: "match3",
    phase: "playing",
    version: 1,
    activeSeat: 0,
    mySeat: 0,
    board: view,
    ...over,
  };
}

function stepOf(chain: number, cleared: Pos[], gained = 0): Match3Step {
  return { chain, cleared, gained, groups: 1 };
}

/* ============================================================
   布局几何
   ============================================================ */

describe("布局几何", () => {
  it("容器非正方时格子仍是正方形 — 长方形格子会让横竖三连看起来不一样长", () => {
    const wide = computeLayout(8, 8, 900, 400);
    const tall = computeLayout(8, 8, 400, 900);
    expect(wide.cell).toBeCloseTo(tall.cell, 9);
    expect(wide.extentX).toBeCloseTo(wide.extentY, 9);
  });

  it("非正方盘面按短边定格子，宽高各自成比例", () => {
    const layout = computeLayout(10, 5, 600, 600);
    expect(layout.extentX).toBeGreaterThan(layout.extentY);
    expect(layout.extentX - 2 * layout.origin).toBeCloseTo(layout.cell * 10, 9);
    expect(layout.extentY - 2 * layout.origin).toBeCloseTo(layout.cell * 5, 9);
  });

  it("四周留白相等且非零 — 留白不足时元素会被画布边缘切掉", () => {
    const layout = computeLayout(8, 8, 640, 640);
    const first = cellCenter(layout, { row: 0, col: 0 });
    const last = cellCenter(layout, { row: 7, col: 7 });
    expect(first.x - 0).toBeCloseTo(layout.extentX - last.x, 9);
    expect(layout.origin).toBeCloseTo(layout.cell * BOARD_PADDING_RATIO, 9);
    expect(layout.origin).toBeGreaterThan(0);
  });

  it("盘面永远塞得进容器 — 溢出的部分玩家点不到，也没有滚动条", () => {
    // 只断言「格子是正方形」抓不到取长边的写法：容器长宽对调后两次算出的
    // 仍是同一个数，正方形照样成立，盘面却已经溢出去了
    for (const [w, h] of [
      [900, 400],
      [400, 900],
      [640, 640],
      [1200, 300],
    ] as const) {
      const layout = computeLayout(8, 8, w, h);
      expect(layout.extentX, `${w}×${h}`).toBeLessThanOrEqual(w + 1e-9);
      expect(layout.extentY, `${w}×${h}`).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  it("元素边长小于格子边长 — 元素贴在一起时三连和四连看起来一样", () => {
    const layout = computeLayout(8, 8, 640, 640);
    expect(layout.tile).toBeLessThan(layout.cell);
  });

  it("格子与像素互为逆映射，逐格验证", () => {
    const layout = computeLayout(8, 8, 640, 640);
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const { x, y } = cellCenter(layout, { row, col });
        expect(pixelToCell(layout, x, y), `(${row},${col})`).toEqual({
          row,
          col,
        });
      }
    }
  });

  it("格子的四个角仍归属该格 — 边界判定差一个像素就会点错格", () => {
    const layout = computeLayout(8, 8, 640, 640);
    const { x, y } = cellCenter(layout, { row: 3, col: 3 });
    const half = layout.cell / 2;
    const eps = 0.01;
    expect(pixelToCell(layout, x - half + eps, y - half + eps)).toEqual({
      row: 3,
      col: 3,
    });
    expect(pixelToCell(layout, x + half - eps, y + half - eps)).toEqual({
      row: 3,
      col: 3,
    });
    // 越过下/右边界即进入下一格，不是仍算本格
    expect(pixelToCell(layout, x + half + eps, y)).toEqual({ row: 3, col: 4 });
    expect(pixelToCell(layout, x, y + half + eps)).toEqual({ row: 4, col: 3 });
  });

  it("点在留白或盘外返回 null，不会环绕到对侧", () => {
    const layout = computeLayout(8, 8, 640, 640);
    expect(pixelToCell(layout, 1, 1)).toBeNull();
    expect(
      pixelToCell(layout, layout.extentX - 1, layout.extentY - 1),
    ).toBeNull();
    expect(pixelToCell(layout, -50, 100)).toBeNull();
    expect(pixelToCell(layout, 100, -50)).toBeNull();
    expect(pixelToCell(layout, layout.extentX + 50, 100)).toBeNull();
  });

  it("容器尺寸为 0 时不炸也不误判命中 — 首帧挂载常常拿到 0", () => {
    const layout = computeLayout(8, 8, 0, 0);
    expect(layout.cell).toBe(0);
    expect(pixelToCell(layout, 0, 0)).toBeNull();
  });
});

/* ============================================================
   动画时序
   ============================================================ */

describe("动画时序（UI-DESIGN.md §5.1）", () => {
  it("没有连锁就没有时间线 — 被拒的交换不该触发任何动画", () => {
    expect(timelineDuration(0)).toBe(0);
  });

  it("单层连锁的时长就是消除时长", () => {
    expect(timelineDuration(1)).toBe(CLEAR_MS);
  });

  it("多层连锁按错峰累加，且下落与消除并行不串行", () => {
    // 串行实现会得到 n * CLEAR_MS；三层就是 750ms，玩家点一下要等大半秒
    expect(timelineDuration(3)).toBe(2 * CHAIN_STAGGER_MS + CLEAR_MS);
    expect(timelineDuration(3)).toBeLessThan(3 * CLEAR_MS);
    expect(timelineDuration(1)).toBeGreaterThanOrEqual(DROP_MS);
  });

  it("有效交换先移动两颗宝石，再进入消除与下落", () => {
    expect(timelineDuration(1, true)).toBe(SWAP_MS + CLEAR_MS);
    expect(swapProgress(0)).toBe(0);
    expect(swapProgress(SWAP_MS)).toBe(1);
    expect(swapProgress(SWAP_MS / 2)).toBeGreaterThan(0.8);
  });

  it("无效交换会完整换过去再弹回原位", () => {
    expect(swapProgress(0, true)).toBe(0);
    expect(swapProgress(REJECTED_SWAP_MS / 2, true)).toBe(1);
    expect(swapProgress(REJECTED_SWAP_MS, true)).toBe(0);
  });

  it("整条时间线不超过半秒（到五层为止）— 再长就是可感知的卡顿", () => {
    expect(timelineDuration(5)).toBeLessThanOrEqual(650);
  });

  it("第 n 层在第 (n-1)×错峰 毫秒才开始 — 全部同时亮就没有「连锁」可言", () => {
    expect(chainFlashProgress(0, 1)).toBe(0);
    expect(chainFlashProgress(0, 2)).toBeNull();
    expect(chainFlashProgress(0, 3)).toBeNull();

    expect(chainFlashProgress(CHAIN_STAGGER_MS, 2)).toBe(0);
    expect(chainFlashProgress(2 * CHAIN_STAGGER_MS, 3)).toBe(0);
  });

  it("闪光走完即停止绘制，返回 null 而不是 0", () => {
    // 返回 0 兼表「结束」会让所有已结束的层在每一帧重新亮到最盛
    expect(chainFlashProgress(CLEAR_MS, 1)).toBe(1);
    expect(chainFlashProgress(CLEAR_MS + 1, 1)).toBeNull();
    expect(chainFlashProgress(-1, 1)).toBeNull();
  });

  it("同一时刻不同层的进度不同 — 相同就说明错峰没生效", () => {
    const at = CHAIN_STAGGER_MS + 20;
    const first = chainFlashProgress(at, 1);
    const second = chainFlashProgress(at, 2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!).toBeGreaterThan(second!);
  });

  it("下落进度截在 [0,1]，越界不产生负坐标", () => {
    expect(dropProgress(0)).toBe(0);
    expect(dropProgress(DROP_MS / 2)).toBeCloseTo(0.5, 9);
    expect(dropProgress(DROP_MS)).toBe(1);
    expect(dropProgress(DROP_MS * 10)).toBe(1);
    expect(dropProgress(-100)).toBe(0);
    expect(dropProgress(Number.POSITIVE_INFINITY)).toBe(1);
    expect(dropProgress(Number.NaN)).toBe(0);
  });

  it("缓动曲线端点精确、全程单调、起手比线性快", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 20; i += 1) {
      const value = easeOut(i / 20);
      expect(value, `t=${i / 20}`).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    // cubic-bezier(0.16, 1, 0.3, 1) 在中点已经走了八成以上；
    // 若被换成线性或 1-(1-t)³，这条会红
    expect(easeOut(0.5)).toBeGreaterThan(0.8);
    expect(easeOut(0.25)).toBeGreaterThan(0.5);
  });

  it("每列的下落高度由该列被清掉的格子数决定", () => {
    const cleared: Pos[] = [
      { row: 0, col: 2 },
      { row: 1, col: 2 },
      { row: 3, col: 5 },
    ];
    const counts = clearedPerColumn(8, cleared);
    expect(counts[2]).toBe(2);
    expect(counts[5]).toBe(1);
    expect(counts[0]).toBe(0);
    expect(counts).toHaveLength(8);
  });

  it("越界的列号被忽略，不会写到别的列上", () => {
    const counts = clearedPerColumn(4, [
      { row: 0, col: -1 },
      { row: 0, col: 9 },
      { row: 0, col: 1 },
    ]);
    expect(counts).toEqual([0, 1, 0, 0]);
  });

  it("下落高度截到整盘高度 — 连锁多轮时不截会让元素从画布外飞进来", () => {
    const layout = computeLayout(8, 8, 640, 640);
    expect(fallDistance(layout, 0)).toBe(0);
    expect(fallDistance(layout, 3)).toBeCloseTo(3 * layout.cell, 9);
    expect(fallDistance(layout, 40)).toBeCloseTo(8 * layout.cell, 9);
  });
});

/* ============================================================
   TUI 字符排版
   ============================================================ */

describe("TUI 字符排版", () => {
  it("六种元素字符两两不同 — 撞字就等于两种元素显示成一种", () => {
    expect(new Set(TILE_GLYPHS).size).toBe(TILE_GLYPHS.length);
  });

  it("字符两两不同族 — 码位不同但形状相同等于只剩颜色能分", () => {
    // 这条是 Set 去重抓不到的那一半：`◆`(U+25C6) 与 `♦`(U+2666) 码位不同、
    // 形状却一样，`Set.size` 全绿而色觉障碍玩家分不出来（UI-DESIGN.md §1
    // 「颜色不作为唯一信息载体」）。按形状族归类，同族出现两个即判红
    const FAMILY: Record<string, string> = {
      "◆": "菱形",
      "♦": "菱形",
      "◇": "菱形",
      "▲": "三角",
      "△": "三角",
      "▼": "三角",
      "●": "实心圆",
      "○": "空心圆",
      "■": "方块",
      "□": "方块",
      "★": "星",
      "☆": "星",
    };
    const families = TILE_GLYPHS.map((g) => {
      expect(
        FAMILY[g],
        `字符 ${g} 不在形状族表里，新增字符请先归族`,
      ).toBeTruthy();
      return FAMILY[g];
    });
    expect(new Set(families).size).toBe(TILE_GLYPHS.length);
  });

  it("元素字符全部是单码位，不是组合字符或代理对", () => {
    // 多码位字符会让 text[offset] 取到半个字，整行随之错位
    for (const glyph of TILE_GLYPHS) {
      expect([...glyph], glyph).toHaveLength(1);
      expect(glyph.length, glyph).toBe(1);
    }
  });

  it("越界的元素种类抛错，而不是回绕成别的字符", () => {
    // 回绕会让两种元素显示成同一个字符，玩家看到「三个一样的却消不掉」
    expect(() => glyphOf(-1)).toThrow(RangeError);
    expect(() => glyphOf(TILE_GLYPHS.length)).toThrow(RangeError);
    expect(() => glyphOf(1.5)).toThrow(RangeError);
    expect(glyphOf(0)).toBe(TILE_GLYPHS[0]);
    expect(glyphOf(TILE_GLYPHS.length - 1)).toBe(TILE_GLYPHS.at(-1));
  });

  it("每行字符数一致 — 长短不齐的行会让整个网格错位", () => {
    for (const [w, h] of [
      [8, 8],
      [5, 9],
      [3, 3],
    ] as const) {
      const cells = Array.from({ length: w * h }, (_, i) => i % 6);
      const lines = renderBoardText(viewOf(w, h, { cells })).split("\n");
      expect(lines, `${w}×${h} 行数`).toHaveLength(h);
      expect(new Set(lines.map((l) => l.length)).size, `${w}×${h} 行宽`).toBe(
        1,
      );
    }
  });

  it("盘面行里只有元素字符与半角空格 — 混进窄字符就会随字体错位", () => {
    const cells = Array.from({ length: 64 }, (_, i) => i % 6);
    const text = renderBoardText(viewOf(8, 8, { cells }));
    const allowed = new Set<string>([...TILE_GLYPHS, " ", "\n"]);
    for (const ch of text) {
      expect(allowed.has(ch), `出现了非法字符 ${JSON.stringify(ch)}`).toBe(
        true,
      );
    }
  });

  it("字符偏移落在对应格的字符上 — 逐格验证，差一位就露馅", () => {
    // 六色循环铺满，任意两个相邻格字符都不同，偏移错一位必然被抓到
    const cells = Array.from({ length: 40 }, (_, i) => i % 6);
    const view = viewOf(5, 8, { cells });
    const text = renderBoardText(view);
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const expected = glyphOf(cells[row * 5 + col]);
        expect(text[cellTextOffset(5, { row, col })], `(${row},${col})`).toBe(
          expected,
        );
      }
    }
  });

  it("偏移只由坐标决定，与盘面内容无关", () => {
    const a = viewOf(6, 6, {
      cells: Array.from({ length: 36 }, () => 0),
    });
    const b = viewOf(6, 6, {
      cells: Array.from({ length: 36 }, (_, i) => i % 6),
    });
    expect(renderBoardText(a).length).toBe(renderBoardText(b).length);
  });

  it("消除偏移去重且升序 — L 形拐点重复套 span 会让整行错位", () => {
    const view = viewOf(4, 4, {
      steps: [
        stepOf(1, [
          { row: 2, col: 2 },
          { row: 0, col: 1 },
          { row: 2, col: 2 },
        ]),
        stepOf(2, [{ row: 0, col: 1 }]),
      ],
    });
    const offsets = clearedTextOffsets(view);
    expect(offsets).toEqual([
      cellTextOffset(4, { row: 0, col: 1 }),
      cellTextOffset(4, { row: 2, col: 2 }),
    ]);
    expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
  });

  it("没有消除时偏移为空", () => {
    expect(clearedTextOffsets(viewOf())).toEqual([]);
  });
});

describe("TUI 进度条", () => {
  it("宽度固定，填充随比例变化", () => {
    expect(renderProgressBar(0, 10)).toBe("░".repeat(10));
    expect(renderProgressBar(0.5, 10)).toBe("█".repeat(5) + "░".repeat(5));
    expect(renderProgressBar(1, 10)).toBe("█".repeat(10));
    expect(renderProgressBar(0.37, 10)).toHaveLength(10);
  });

  it("不到 100% 绝不画满 — 97% 显示成满格会让玩家以为已经通关", () => {
    for (const ratio of [0.9, 0.95, 0.97, 0.99, 0.999]) {
      const bar = renderProgressBar(ratio, 10);
      expect(bar.includes("░"), `${ratio}`).toBe(true);
    }
  });

  it("超出与负数都被截住", () => {
    expect(renderProgressBar(2, 8)).toBe("█".repeat(8));
    expect(renderProgressBar(-1, 8)).toBe("░".repeat(8));
  });
});

describe("TUI 状态栏与数据行（UI-DESIGN.md §6.3）", () => {
  it("数据行同时给出分数、目标与剩余步数", () => {
    const line = renderStatsLine(
      viewOf(4, 4, {
        score: 320,
        targetScore: 1000,
        movesUsed: 7,
        moveLimit: 25,
      }),
    );
    expect(line).toContain("320");
    expect(line).toContain("1000");
    // 剩余步数是算出来的，不是把 movesUsed 直接印上去
    expect(line).toContain("18");
  });

  it("还没连锁过就不显示连锁数 — 显示 ×0 会让人以为出了 bug", () => {
    expect(renderStatsLine(viewOf())).not.toContain("连锁");
    expect(renderStatsLine(viewOf(4, 4, { bestChain: 3 }))).toContain("×3");
  });

  it("不能行动时不列出交换快捷键 — 列了就是骗人", () => {
    const bar = renderStatusBar(viewOf(), false, null);
    expect(bar).not.toContain("Enter");
    expect(bar).toContain("等待");
  });

  it("未选中时不提示 Esc 取消 — 那时候没有东西可取消", () => {
    const bar = renderStatusBar(viewOf(), true, null);
    expect(bar).toContain("Enter");
    expect(bar).not.toContain("Esc");
  });

  it("已选中时给出取消键与选中位置", () => {
    const bar = renderStatusBar(viewOf(), true, { row: 2, col: 3 });
    expect(bar).toContain("Esc");
    // 展示用一起点的坐标，玩家不读数组下标
    expect(bar).toContain("(3,4)");
  });

  it("盘面重排要提示，否则元素凭空全变很吓人", () => {
    expect(
      renderStatusBar(viewOf(4, 4, { reshuffled: true }), true, null),
    ).toContain("重排");
    expect(renderStatusBar(viewOf(), true, null)).not.toContain("重排");
  });

  it("终局显示通关与否及分数，不再列出对局操作", () => {
    const cleared = renderStatusBar(
      viewOf(4, 4, {
        outcome: {
          verdict: "cleared",
          score: 1200,
          targetScore: 1000,
          movesUsed: 20,
          bestChain: 4,
        },
      }),
      false,
      null,
    );
    expect(cleared).toContain("通关");
    expect(cleared).toContain("1200");
    expect(cleared).not.toContain("Enter");

    const failed = renderStatusBar(
      viewOf(4, 4, {
        outcome: {
          verdict: "failed",
          score: 800,
          targetScore: 1000,
          movesUsed: 25,
          bestChain: 2,
        },
      }),
      false,
      null,
    );
    expect(failed).toContain("未通关");
  });
});

/* ============================================================
   TUI 渲染器
   ============================================================ */

describe("TUI 渲染器", () => {
  function mountTui(snapshot = snapshotOf(viewOf())) {
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new TuiMatch3Renderer();
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    const root = host.firstElementChild as HTMLElement;
    const press = (key: string) =>
      root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return { host, root, renderer, intents, press };
  }

  /** 带某个类名的第一个 span 在盘面文本里的字符偏移。 */
  function markedOffset(host: HTMLElement, className: string): number | null {
    const pre = host.querySelector("pre")!;
    let at = 0;
    for (const node of pre.childNodes) {
      const text = node.textContent ?? "";
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).classList.contains(className)
      ) {
        return at;
      }
      at += text.length;
    }
    return null;
  }

  function markedCell(host: HTMLElement, className: string, width = 4) {
    const offset = markedOffset(host, className);
    if (offset === null) return null;
    const lineLength = width * 2;
    return {
      row: Math.floor(offset / lineLength),
      col: (offset % lineLength) / 2,
    };
  }

  it("挂载后复用共享 TUI 外观类，不另起一套", () => {
    const { host } = mountTui();
    const root = host.firstElementChild as HTMLElement;
    expect(root.classList.contains("tui")).toBe(true);
    expect(host.querySelector("pre")?.classList.contains("tui-grid")).toBe(
      true,
    );
  });

  it("渲染出的文本与纯函数排版逐字相等 — 标记 span 不改变字符内容", () => {
    const view = viewOf();
    const { host } = mountTui(snapshotOf(view));
    expect(host.querySelector("pre")?.textContent).toBe(renderBoardText(view));
  });

  it("每个 span 只包一个字符 — 包多个会让有标记的行与无标记的行列宽不同", () => {
    const { host } = mountTui();
    for (const span of host.querySelectorAll("pre span")) {
      expect(span.textContent).toHaveLength(1);
    }
  });

  it("光标默认在左上角，hjkl 与方向键移动", () => {
    const { host, press } = mountTui();
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 0,
      col: 0,
    });
    press("l");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 0,
      col: 1,
    });
    press("j");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 1,
      col: 1,
    });
    press("ArrowLeft");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 1,
      col: 0,
    });
    press("ArrowUp");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 0,
      col: 0,
    });
  });

  it("光标撞到边界就停住，不会绕到对侧行", () => {
    const { host, press } = mountTui();
    for (let i = 0; i < 10; i += 1) press("h");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 0,
      col: 0,
    });
    for (let i = 0; i < 10; i += 1) press("j");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 3,
      col: 0,
    });
    for (let i = 0; i < 10; i += 1) press("l");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 3,
      col: 3,
    });
  });

  it("撞界后反向移动立刻生效 — 光标越界只是被夹回来的话会「粘」住", () => {
    // 只断言撞界后的位置抓不到「先出界再夹回」的实现：出界 3 格再往回按
    // 3 次，夹回来的结果仍是边界格，看着一切正常。必须按一次就检查一次。
    const { host, press } = mountTui();
    for (let i = 0; i < 6; i += 1) press("l");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 0,
      col: 3,
    });
    press("h");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 0,
      col: 2,
    });

    for (let i = 0; i < 6; i += 1) press("j");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 3,
      col: 2,
    });
    press("k");
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 2,
      col: 2,
    });
  });

  it("Enter 选中后再选相邻格才上报，只按一次不上报", () => {
    const { host, intents, press } = mountTui();
    press("Enter");
    expect(intents).toEqual([]);
    expect(markedCell(host, "bro-match3-tui__selected")).toEqual({
      row: 0,
      col: 0,
    });

    press("l");
    press("Enter");
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      matchId: "m1",
      basedOnVersion: 1,
      type: "match3/swap",
      payload: { a: { row: 0, col: 0 }, b: { row: 0, col: 1 } },
    });
  });

  it("空格与 Enter 等效 — 状态栏只写 Enter，但空格是玩家的肌肉记忆", () => {
    const { intents, press } = mountTui();
    press(" ");
    press("l");
    press(" ");
    expect(intents).toHaveLength(1);
  });

  it("在同一格再按一次即取消选中", () => {
    const { host, intents, press } = mountTui();
    press("Enter");
    press("Enter");
    expect(intents).toEqual([]);
    expect(markedCell(host, "bro-match3-tui__selected")).toBeNull();
  });

  it("选非相邻格是改选，不是报错 — 玩家改主意是正常操作", () => {
    const { host, intents, press } = mountTui();
    press("Enter");
    press("j");
    press("j");
    press("Enter");
    expect(intents).toEqual([]);
    expect(markedCell(host, "bro-match3-tui__selected")).toEqual({
      row: 2,
      col: 0,
    });
  });

  it("Esc 取消选中", () => {
    const { host, press } = mountTui();
    press("Enter");
    press("Escape");
    expect(markedCell(host, "bro-match3-tui__selected")).toBeNull();
  });

  it("不能行动时不上报意图，也不画光标 — 画了等于暗示还能操作", () => {
    const { host, intents, press } = mountTui(
      snapshotOf(viewOf(), { phase: "finished", activeSeat: null }),
    );
    press("Enter");
    press("l");
    press("Enter");
    expect(intents).toEqual([]);
    expect(markedOffset(host, "bro-match3-tui__cursor")).toBeNull();
  });

  it("观战者不上报意图", () => {
    const { intents, press } = mountTui(snapshotOf(viewOf(), { mySeat: null }));
    press("Enter");
    press("l");
    press("Enter");
    expect(intents).toEqual([]);
  });

  it("消除过的格子带闪烁类，位置与 steps 一致", () => {
    const cleared = [
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
    ];
    const { host } = mountTui(
      snapshotOf(viewOf(4, 4, { steps: [stepOf(1, cleared, 90)] })),
    );
    const flashes = [...host.querySelectorAll(".bro-match3-tui__flash")];
    expect(flashes).toHaveLength(3);
    expect(markedCell(host, "bro-match3-tui__flash")).toEqual({
      row: 1,
      col: 1,
    });
  });

  it("同一状态渲染两次结果完全相同（契约要求幂等）", () => {
    const snapshot = snapshotOf(
      viewOf(4, 4, { steps: [stepOf(1, [{ row: 2, col: 2 }], 30)] }),
    );
    const { host, renderer } = mountTui(snapshot);
    const first = host.innerHTML;
    renderer.render(snapshot);
    expect(host.innerHTML).toBe(first);
  });

  it("移动光标不重建盘面节点 — 重建会让消除闪烁每按一次键就重播", () => {
    const { host, press } = mountTui(
      snapshotOf(
        viewOf(4, 4, { steps: [stepOf(1, [{ row: 3, col: 3 }], 30)] }),
      ),
    );
    const before = host.querySelector(".bro-match3-tui__flash");
    press("l");
    press("j");
    expect(host.querySelector(".bro-match3-tui__flash")).toBe(before);
  });

  it("新版本到达时清掉选中 — 否则第二次按 Enter 的语义全错", () => {
    const view = viewOf();
    const { host, renderer, press } = mountTui(snapshotOf(view));
    press("Enter");
    expect(markedCell(host, "bro-match3-tui__selected")).not.toBeNull();

    renderer.render(snapshotOf(view, { version: 2 }));
    expect(markedCell(host, "bro-match3-tui__selected")).toBeNull();
  });

  it("盘面尺寸变小后光标被拉回盘内，标记不会跑到别的行", () => {
    const { host, renderer } = mountTui(
      snapshotOf(
        viewOf(8, 8, { cells: Array.from({ length: 64 }, (_, i) => i % 6) }),
      ),
    );
    const root = host.firstElementChild as HTMLElement;
    for (let i = 0; i < 7; i += 1) {
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    }
    renderer.render(snapshotOf(viewOf(4, 4), { version: 2 }));
    expect(markedCell(host, "bro-match3-tui__cursor")).toEqual({
      row: 3,
      col: 3,
    });
  });

  it("状态栏跟随行动权变化 — 与实际可用的按键保持一致", () => {
    const view = viewOf();
    const { host, renderer } = mountTui(snapshotOf(view));
    const status = host.querySelector(".bro-match3-tui__status");
    expect(status?.textContent).toContain("Enter");

    renderer.render(snapshotOf(view, { version: 2, activeSeat: null }));
    expect(status?.textContent).not.toContain("Enter");
  });

  it("卸载后移除节点并停止响应键盘", () => {
    const { host, root, renderer, intents } = mountTui();
    const detach = vi.spyOn(root, "removeEventListener");
    renderer.unmount();
    expect(host.children).toHaveLength(0);
    // 摘监听要单独断言：卸载后 latest 已置空，漏摘的监听器也只是静默返回，
    // 光看「没上报意图」分辨不出监听器还挂着没有
    expect(detach).toHaveBeenCalledWith("keydown", expect.any(Function));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
    detach.mockRestore();
  });
});

/* ============================================================
   Canvas 渲染器
   ============================================================ */

/** 一次 fill/stroke 记录下来的路径与样式。 */
interface DrawOp {
  readonly kind: "fill" | "stroke" | "strokeRect" | "text";
  /** 路径顶点。arc 记圆心，半径另记在 {@link DrawOp.radii}。 */
  readonly points: readonly { x: number; y: number }[];
  readonly radii: readonly number[];
  readonly style: string;
  readonly alpha: number;
  readonly lineWidth: number;
  readonly text?: string;
}

/**
 * 最小 2D 上下文替身。
 *
 * jsdom 不实现 `getContext`，于是 `draw()` 整段在测试里一次都没执行过——
 * 渲染器里写错一个方法名也发现不了，非要真跑起来才炸。这个替身把路径与
 * 样式都记下来，让「到底画了什么形状」变成能断言的东西：六种元素必须
 * 两两形状不同，这是无障碍要求，只靠颜色区分等于色觉障碍玩家玩不了。
 */
function fakeContext() {
  const ops: DrawOp[] = [];
  let points: { x: number; y: number }[] = [];
  let radii: number[] = [];
  const stack: number[] = [];

  /**
   * 顶点按结构存，不拼成字符串。
   *
   * 第一版把路径拼成 `"M80.000,-72.533 L125.867,..."` 再做子串比较，结果是
   * 两条形状撞车的变异体（六边形改成菱形、方块改成菱形）居然全绿——归一化
   * 时要从扁平字符串里反推哪个数是 x、哪个是 y，第一对之后就错位了，不同
   * 形状被归一化成同一个串。结构化之后 x/y 不会认错。
   */
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {
      points = [];
      radii = [];
    },
    moveTo: (x: number, y: number) => points.push({ x, y }),
    lineTo: (x: number, y: number) => points.push({ x, y }),
    arc: (x: number, y: number, radius: number) => {
      points.push({ x, y });
      radii.push(radius);
    },
    rect: (x: number, y: number, w: number, h: number) => {
      points.push({ x, y }, { x: x + w, y: y + h });
    },
    closePath: () => {},
    clip: () => {},
    fill: () => ops.push(snap("fill", ctx.fillStyle)),
    stroke: () => ops.push(snap("stroke", ctx.strokeStyle)),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      ops.push({
        kind: "strokeRect",
        points: [
          { x, y },
          { x: x + w, y: y + h },
        ],
        radii: [],
        style: ctx.strokeStyle,
        alpha: ctx.globalAlpha,
        lineWidth: ctx.lineWidth,
      }),
    fillText: (text: string, x: number, y: number) =>
      ops.push({
        kind: "text",
        points: [{ x, y }],
        radii: [],
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        lineWidth: ctx.lineWidth,
        text,
      }),
    // 透明度要真的入栈出栈，否则淡出的闪光会「漏」到后续绘制上
    save: () => stack.push(ctx.globalAlpha),
    restore: () => {
      ctx.globalAlpha = stack.pop() ?? 1;
    },
    setTransform: () => {},
  };

  function snap(kind: "fill" | "stroke", style: string): DrawOp {
    return {
      kind,
      points: [...points],
      radii: [...radii],
      style,
      alpha: ctx.globalAlpha,
      lineWidth: ctx.lineWidth,
    };
  }

  return { ctx, ops };
}

/** 路径顶点的平均纵坐标 —— 用来判断这一笔画在什么高度上。 */
function pathCenterY(op: DrawOp): number {
  return op.points.reduce((sum, p) => sum + p.y, 0) / op.points.length;
}

/**
 * 把一笔路径归一化成与位置、大小无关的形状指纹。
 *
 * 相对各自的中心、按尺度缩放后取整，于是「同一个形状画在不同格子上」得到
 * 相同指纹，而「不同形状」必然不同。形状是否两两可辨是无障碍要求，这个
 * 指纹就是那条断言的地基，不能靠字符串凑合。
 */
function shapeFingerprint(op: DrawOp, scale: number): string {
  const cx = op.points.reduce((s, p) => s + p.x, 0) / op.points.length;
  const cy = pathCenterY(op);
  const norm = op.points
    .map(
      (p) =>
        `${((p.x - cx) / scale).toFixed(2)},${((p.y - cy) / scale).toFixed(2)}`,
    )
    .join(" ");
  const r = op.radii.map((v) => (v / scale).toFixed(2)).join(",");
  return `${norm}|${r}`;
}

describe("Canvas 渲染器", () => {
  const SIDE = 480;

  function mountCanvas(
    snapshot = snapshotOf(viewOf()),
    options: {
      now?: () => number;
      reducedMotion?: () => boolean;
      theme?: "ceramic" | "terminal";
    } = {},
  ) {
    const host = document.createElement("div");
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(host, prop, { value: SIDE, configurable: true });
    }
    document.body.append(host);

    const gfx = fakeContext();
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(gfx.ctx as unknown as CanvasRenderingContext2D);

    const renderer = new CanvasMatch3Renderer({
      now: options.now,
      // 默认关掉动效：多数用例只关心画了什么，不关心第几毫秒
      reducedMotion: options.reducedMotion ?? (() => true),
      theme: options.theme,
    });
    const intents: InputIntent[] = [];
    renderer.mount(host);
    renderer.onIntent((i) => intents.push(i));
    renderer.render(snapshot);
    spy.mockRestore();

    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    return { host, canvas, renderer, intents, ...gfx };
  }

  function layoutOf(view: Match3View) {
    return computeLayout(view.width, view.height, SIDE, SIDE);
  }

  /** 落在某个格子中心的鼠标事件坐标。jsdom 里 getBoundingClientRect 全零。 */
  function atCell(view: Match3View, p: Pos) {
    const { x, y } = cellCenter(layoutOf(view), p);
    return { clientX: x, clientY: y };
  }

  it("每个格子都画了元素 — 画不出东西是这个文件最可能的故障", () => {
    const { ops } = mountCanvas();
    // 每个元素两次 fill（本体 + 高光）
    expect(ops.filter((o) => o.kind === "fill")).toHaveLength(16 * 2);
  });

  it("日间陶瓷与夜间终端使用不同的盘面材质，但元素仍保持六种可辨颜色", () => {
    const view = viewOf(6, 1, { cells: [0, 1, 2, 3, 4, 5] });
    const ceramic = mountCanvas(snapshotOf(view), { theme: "ceramic" });
    const terminal = mountCanvas(snapshotOf(view), { theme: "terminal" });

    expect(ceramic.canvas.dataset.visualTheme).toBe("ceramic");
    expect(terminal.canvas.dataset.visualTheme).toBe("terminal");
    const bodyColors = (ops: readonly DrawOp[]) =>
      ops
        .filter((op) => op.kind === "fill")
        .filter((_, index) => index % 2 === 0)
        .map((op) => op.style);
    expect(new Set(bodyColors(ceramic.ops))).not.toEqual(
      new Set(bodyColors(terminal.ops)),
    );
    expect(new Set(bodyColors(terminal.ops)).size).toBe(6);
  });

  it("六种元素的形状两两不同 — 只靠颜色区分，色觉障碍玩家直接玩不了", () => {
    const view = viewOf(6, 1, { cells: [0, 1, 2, 3, 4, 5] });
    const { ops } = mountCanvas(snapshotOf(view));
    const layout = layoutOf(view);

    const shapes = ops
      .filter((o) => o.kind === "fill")
      // 隔一个取一个：偶数下标是本体，奇数是高光
      .filter((_, i) => i % 2 === 0)
      .map((op) => shapeFingerprint(op, layout.tile));

    expect(shapes).toHaveLength(6);
    expect(new Set(shapes).size, "有两种元素画成了同一个形状").toBe(6);
  });

  it("形状指纹与位置无关 — 指纹认位置的话上面那条断言等于没测", () => {
    // 同一种元素铺满两行两列，四处的指纹必须完全一致；否则「六种各不相同」
    // 只是在反映它们画在不同格子上，撞形也照样绿
    const view = viewOf(2, 2, { cells: [3, 3, 3, 3] });
    const { ops } = mountCanvas(snapshotOf(view));
    const layout = layoutOf(view);
    const shapes = ops
      .filter((o) => o.kind === "fill")
      .filter((_, i) => i % 2 === 0)
      .map((op) => shapeFingerprint(op, layout.tile));
    expect(new Set(shapes).size).toBe(1);
  });

  it("六种元素的颜色也两两不同 — 形状之外再加一层冗余", () => {
    const view = viewOf(6, 1, { cells: [0, 1, 2, 3, 4, 5] });
    const { ops } = mountCanvas(snapshotOf(view));
    const colors = ops
      .filter((o) => o.kind === "fill")
      .filter((_, i) => i % 2 === 0)
      .map((o) => o.style);
    expect(new Set(colors).size).toBe(6);
  });

  it("按设备像素比放大位图，再用 CSS 缩回去 — 否则高分屏上元素边缘发虚", () => {
    // jsdom 的 devicePixelRatio 恒为 1，不改这个值的话「读了 DPR」与
    // 「写死 1」两种实现完全等价，测了等于没测
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    try {
      const view = viewOf();
      const layout = layoutOf(view);
      const { canvas } = mountCanvas(snapshotOf(view));
      expect(canvas.width).toBe(Math.round(layout.extentX * 2));
      expect(canvas.style.width).toBe(`${layout.extentX}px`);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", {
        value: original,
        configurable: true,
      });
    }
  });

  it("画布可聚焦并带无障碍角色 — 不给 tabIndex，键盘用户看不到这块区域", () => {
    const { canvas } = mountCanvas();
    expect(canvas.tabIndex).toBe(0);
    expect(canvas.getAttribute("role")).toBe("application");
    expect(canvas.getAttribute("aria-label")).toBeTruthy();
  });

  it("两次点击相邻格构成一次交换，只点一次不上报", () => {
    const view = viewOf();
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 1 })),
    );
    expect(intents).toEqual([]);

    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 2 })),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0].payload).toEqual({
      a: { row: 1, col: 1 },
      b: { row: 1, col: 2 },
    });
  });

  it("点非相邻格是改选，不上报", () => {
    const view = viewOf();
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 0, col: 0 })),
    );
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 3, col: 3 })),
    );
    expect(intents).toEqual([]);

    // 改选生效：现在点 (3,2) 应当以 (3,3) 为起点
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 3, col: 2 })),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0].payload).toEqual({
      a: { row: 3, col: 3 },
      b: { row: 3, col: 2 },
    });
  });

  it("点同一格两次即取消选中", () => {
    const view = viewOf();
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    const at = atCell(view, { row: 1, col: 1 });
    canvas.dispatchEvent(new MouseEvent("click", at));
    canvas.dispatchEvent(new MouseEvent("click", at));
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 2 })),
    );
    expect(intents).toEqual([]);
  });

  it("点在盘外不上报，也不清掉已有选中", () => {
    const view = viewOf();
    const { canvas, intents } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 1 })),
    );
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 1, clientY: 1 }));
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 2 })),
    );
    expect(intents).toHaveLength(1);
  });

  it("键盘可以完成一次完整交换 — 全键盘可达是硬要求", () => {
    const { canvas, intents } = mountCanvas();
    const press = (key: string) =>
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key }));
    press("j");
    press("Enter");
    press("l");
    press("Enter");
    expect(intents).toHaveLength(1);
    expect(intents[0].payload).toEqual({
      a: { row: 1, col: 0 },
      b: { row: 1, col: 1 },
    });
  });

  it("不能行动时点击与按键都不上报", () => {
    const view = viewOf();
    const { canvas, intents } = mountCanvas(
      snapshotOf(view, { phase: "finished", activeSeat: null }),
    );
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 1 })),
    );
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 2 })),
    );
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(intents).toEqual([]);
  });

  it("终局后不画光标与选中标记 — 画了等于暗示还能操作", () => {
    const view = viewOf();
    const { canvas, ops } = mountCanvas(
      snapshotOf(view, { phase: "finished", activeSeat: null }),
    );
    // 必须先聚焦并把指针移进盘面：光标只在聚焦时画、悬停框只在指针在盘内时
    // 画，什么都不做的话即便去掉 canAct 判断也一个标记都不会出现
    const before = ops.length;
    canvas.dispatchEvent(new FocusEvent("focus"));
    canvas.dispatchEvent(
      new MouseEvent("mousemove", atCell(view, { row: 2, col: 2 })),
    );
    expect(ops.slice(before).filter((o) => o.kind === "strokeRect")).toEqual(
      [],
    );
  });

  it("选中标记与光标标记形态不同 — 两者会同时出现，只靠颜色分不出来", () => {
    const view = viewOf();
    const { canvas, ops } = mountCanvas(snapshotOf(view));
    canvas.dispatchEvent(new FocusEvent("focus"));
    const before = ops.length;
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 2, col: 2 })),
    );

    const marks = ops.slice(before).filter((o) => o.kind === "strokeRect");
    expect(marks.length).toBeGreaterThanOrEqual(2);
    // 线宽不同 + 选中还多画一个圆，形状上就分得开
    expect(new Set(marks.map((m) => m.lineWidth)).size).toBeGreaterThan(1);
    expect(
      ops
        .slice(before)
        .some(
          (o) => o.kind === "stroke" && o.radii.length > 0 && o.lineWidth === 3,
        ),
    ).toBe(true);
  });

  it("减少动效时不起动画帧，直接画终态", () => {
    // prefers-reduced-motion 是硬性要求（UI-DESIGN.md §5.3）：前庭功能敏感的
    // 用户会因连续闪烁产生眩晕。这里连 rAF 都不能起，否则空转一整条时间线。
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    try {
      mountCanvas(
        snapshotOf(
          viewOf(4, 4, { steps: [stepOf(1, [{ row: 0, col: 0 }], 30)] }),
        ),
        { reducedMotion: () => true },
      );
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it("没有连锁就不起动画 — 首帧与被拒后的重绘都不该动", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    try {
      mountCanvas(snapshotOf(viewOf()), { reducedMotion: () => false });
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it("有连锁且允许动效时才起动画帧", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    try {
      const { renderer } = mountCanvas(
        snapshotOf(
          viewOf(4, 4, { steps: [stepOf(1, [{ row: 0, col: 0 }], 30)] }),
        ),
        { reducedMotion: () => false, now: () => 0 },
      );
      expect(raf).toHaveBeenCalled();
      renderer.unmount();
    } finally {
      raf.mockRestore();
    }
  });

  it("有效交换沿两格之间绘制轨迹，并在移动中抬起宝石", () => {
    let clock = 0;
    const initial = viewOf();
    const { canvas, renderer, ops } = mountCanvas(snapshotOf(initial), {
      reducedMotion: () => false,
      now: () => clock,
    });
    const swap = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ] as const;
    renderer.render(
      snapshotOf(
        viewOf(4, 4, {
          lastSwap: swap,
          steps: [stepOf(1, [{ row: 0, col: 0 }], 30)],
        }),
        { version: 2 },
      ),
    );

    clock = SWAP_MS / 2;
    const before = ops.length;
    canvas.dispatchEvent(new FocusEvent("focus"));
    const frame = ops.slice(before);
    const trail = frame.find(
      (op) =>
        op.kind === "stroke" &&
        op.style === "rgba(195,145,28,0.5)" &&
        op.points.length === 4,
    );
    expect(trail).toBeTruthy();

    const layout = layoutOf(initial);
    const movingBodies = frame.filter((op) => op.kind === "fill").slice(-4);
    expect(
      movingBodies.some((op) =>
        op.radii.some((radius) => radius > layout.tile / 2),
      ),
    ).toBe(true);
  });

  it("动画播放期间元素从上方落入，播完落到位", () => {
    let clock = 0;
    const view = viewOf(4, 4, {
      steps: [stepOf(1, [{ row: 3, col: 0 }], 30)],
    });
    const { canvas, ops } = mountCanvas(snapshotOf(view), {
      now: () => clock,
      reducedMotion: () => false,
    });
    const layout = layoutOf(view);
    const settled = cellCenter(layout, { row: 0, col: 0 });

    // 第 0 毫秒：第 0 列被清过一格，该列元素起点应当高出整整一个格子
    const first = ops.find((o) => o.kind === "fill")!;
    expect(pathCenterY(first)).toBeCloseTo(settled.y - layout.cell, 3);

    // 时间线走完后重绘（focus 触发一次同步重绘，不依赖真实 rAF 的时机）
    clock = DROP_MS + 1;
    const before = ops.length;
    canvas.dispatchEvent(new FocusEvent("focus"));
    const after = ops.slice(before).find((o) => o.kind === "fill")!;
    expect(pathCenterY(after)).toBeCloseTo(settled.y, 3);
  });

  it("没被清过的列不下落 — 整盘一起掉会让人以为每一格都变了", () => {
    const view = viewOf(4, 4, { steps: [stepOf(1, [{ row: 3, col: 0 }], 30)] });
    const { ops } = mountCanvas(snapshotOf(view), {
      now: () => 0,
      reducedMotion: () => false,
    });
    const layout = layoutOf(view);
    // 行主序第 0 行：col 0 被清过要下落，col 1 没有
    const fills = ops.filter((o) => o.kind === "fill");
    expect(pathCenterY(fills[0])).toBeCloseTo(
      cellCenter(layout, { row: 0, col: 0 }).y - layout.cell,
      3,
    );
    expect(pathCenterY(fills[2])).toBeCloseTo(
      cellCenter(layout, { row: 0, col: 1 }).y,
      3,
    );
  });

  it("动画不阻塞输入 — 时间线跑到一半点击照样上报", () => {
    let clock = 0;
    const view = viewOf(4, 4, {
      steps: [
        stepOf(1, [{ row: 3, col: 0 }], 30),
        stepOf(2, [{ row: 2, col: 1 }], 60),
      ],
    });
    const { canvas, intents } = mountCanvas(snapshotOf(view), {
      now: () => clock,
      reducedMotion: () => false,
    });

    clock = 60;
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 1 })),
    );
    canvas.dispatchEvent(
      new MouseEvent("click", atCell(view, { row: 1, col: 2 })),
    );
    expect(intents).toHaveLength(1);
  });

  it("二层以上连锁标出倍率，单层不标 — 倍率是这游戏的卖点", () => {
    // 时钟必须是可变的：animStart 取的就是 render 那一刻的 now()，
    // 给一个常量时钟等于 elapsed 恒为 0，第二层永远不会开始
    let clock = 0;
    const single = mountCanvas(
      snapshotOf(
        viewOf(4, 4, { steps: [stepOf(1, [{ row: 0, col: 0 }], 30)] }),
      ),
      { now: () => clock, reducedMotion: () => false },
    );
    expect(single.ops.filter((o) => o.kind === "text")).toEqual([]);

    const deep = mountCanvas(
      snapshotOf(
        viewOf(4, 4, {
          steps: [
            stepOf(1, [{ row: 0, col: 0 }], 30),
            stepOf(2, [{ row: 1, col: 1 }], 60),
          ],
        }),
      ),
      { now: () => clock, reducedMotion: () => false },
    );
    // 第二层要到错峰点之后才登场
    expect(deep.ops.filter((o) => o.kind === "text")).toEqual([]);

    clock = CHAIN_STAGGER_MS + 10;
    const before = deep.ops.length;
    deep.canvas.dispatchEvent(new FocusEvent("focus"));
    const labels = deep.ops.slice(before).filter((o) => o.kind === "text");
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe("CHAIN ×2");
  });

  it("闪光淡出后透明度被还原 — save/restore 漏了会让整盘元素发灰", () => {
    let clock = 0;
    const view = viewOf(4, 4, {
      steps: [
        stepOf(1, [{ row: 0, col: 0 }], 30),
        stepOf(2, [{ row: 1, col: 1 }], 60),
      ],
    });
    const { canvas, ops } = mountCanvas(snapshotOf(view), {
      now: () => clock,
      reducedMotion: () => false,
    });

    // 泄漏的透明度要下一次绘制才看得见：闪光是每帧最后画的，同一帧内它后面
    // 没有别的笔触，只看当帧的话漏掉 restore 也照样绿
    clock = CHAIN_STAGGER_MS + 10;
    canvas.dispatchEvent(new FocusEvent("focus"));
    const before = ops.length;
    clock = CHAIN_STAGGER_MS + 20;
    canvas.dispatchEvent(new FocusEvent("focus"));
    const frame = ops.slice(before);

    expect(
      frame.some((o) => o.alpha < 1),
      "闪光应当是半透明的",
    ).toBe(true);
    // 真正的泄漏在这里：闪光是每帧最后画的，没还原的话下一帧的元素本体
    // 会顶着上一帧残留的透明度画出来，整盘发灰
    expect(
      frame
        .filter((o) => o.kind === "fill")
        // 前 cells×2 笔固定是宝石本体与高光；后面的半透明 fill 是爆裂粒子。
        .slice(0, view.cells.length * 2)
        .every((o) => o.alpha === 1),
    ).toBe(true);
    // 两层闪光各自淡出，先开始的那层更淡；相等说明透明度没有逐层设置
    const rings = frame.filter(
      (o) => o.kind === "stroke" && o.radii.length > 0,
    );
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rings.map((o) => o.alpha)).size).toBeGreaterThan(1);
  });

  it("同一状态重复渲染不重启动画（契约要求 render 幂等）", () => {
    let clock = 0;
    const view = viewOf(4, 4, { steps: [stepOf(1, [{ row: 3, col: 0 }], 30)] });
    const snapshot = snapshotOf(view);
    const { renderer, ops } = mountCanvas(snapshot, {
      now: () => clock,
      reducedMotion: () => false,
    });
    const layout = layoutOf(view);
    const settled = cellCenter(layout, { row: 0, col: 0 });

    // 时间线走完，元素已落到位
    clock = DROP_MS + 1;
    renderer.render(snapshot);
    const before = ops.length;
    renderer.render(snapshot);
    const again = ops.slice(before).find((o) => o.kind === "fill")!;
    // 重启动画的话 animStart 会被拨到现在，元素又飞回上方重新落一遍
    expect(pathCenterY(again)).toBeCloseTo(settled.y, 3);
  });

  it("新版本到达时打断旧时间线，从头播新的", () => {
    let clock = 0;
    const view = viewOf(4, 4, { steps: [stepOf(1, [{ row: 3, col: 0 }], 30)] });
    const { renderer, ops } = mountCanvas(snapshotOf(view), {
      now: () => clock,
      reducedMotion: () => false,
    });
    const layout = layoutOf(view);
    const settled = cellCenter(layout, { row: 0, col: 0 });

    clock = DROP_MS + 1;
    const before = ops.length;
    renderer.render(snapshotOf(view, { version: 2 }));
    const fresh = ops.slice(before).find((o) => o.kind === "fill")!;
    expect(pathCenterY(fresh)).toBeCloseTo(settled.y - layout.cell, 3);
  });

  it("卸载时断开 ResizeObserver 并取消动画帧 — 漏掉就是每局一个泄漏", () => {
    const disconnect = vi.fn();
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;

    try {
      const { host, renderer } = mountCanvas(
        snapshotOf(
          viewOf(4, 4, { steps: [stepOf(1, [{ row: 0, col: 0 }], 30)] }),
        ),
        { now: () => 0, reducedMotion: () => false },
      );
      renderer.unmount();
      expect(disconnect).toHaveBeenCalled();
      expect(cancel).toHaveBeenCalled();
      expect(host.querySelector("canvas")).toBeNull();
    } finally {
      globalThis.ResizeObserver = original;
      cancel.mockRestore();
    }
  });
});

/* ============================================================
   视图口径
   ============================================================ */

describe("视图派生量", () => {
  it("剩余步数不为负 — 负数会让进度条与状态栏一起显示成乱码", () => {
    expect(movesLeft(viewOf(4, 4, { moveLimit: 25, movesUsed: 7 }))).toBe(18);
    expect(movesLeft(viewOf(4, 4, { moveLimit: 25, movesUsed: 25 }))).toBe(0);
    // 服务端不该发出这种数，但视图是防线的最后一道
    expect(movesLeft(viewOf(4, 4, { moveLimit: 25, movesUsed: 30 }))).toBe(0);
  });

  it("目标完成度截在 1 — 超额得分不能把进度条画出格", () => {
    expect(goalProgress(viewOf(4, 4, { score: 0, targetScore: 1000 }))).toBe(0);
    expect(goalProgress(viewOf(4, 4, { score: 500, targetScore: 1000 }))).toBe(
      0.5,
    );
    expect(goalProgress(viewOf(4, 4, { score: 3000, targetScore: 1000 }))).toBe(
      1,
    );
  });

  it("目标为 0 时算作已完成，而不是除零", () => {
    expect(goalProgress(viewOf(4, 4, { score: 0, targetScore: 0 }))).toBe(1);
  });

  it("本次得分是连锁各层之和 — 只算首层等于连锁白打", () => {
    expect(totalGained([])).toBe(0);
    expect(
      totalGained([stepOf(1, [], 30), stepOf(2, [], 120), stepOf(3, [], 90)]),
    ).toBe(240);
  });

  it("盘面出现空洞直接抛错，不静默填一个默认元素", () => {
    // 静默填补会把「结算循环少跑一轮」这种算错分的 bug，伪装成「偶尔某格
    // 显示怪怪的」，从现象几乎反推不到成因
    const holed = {
      width: 2,
      height: 1,
      cells: [0, null],
    } as unknown as Parameters<typeof viewCellsOf>[0];
    expect(() => viewCellsOf(holed)).toThrow(/空洞/);
    const solid = {
      width: 2,
      height: 1,
      cells: [0, 3],
    } as unknown as Parameters<typeof viewCellsOf>[0];
    expect(viewCellsOf(solid)).toEqual([0, 3]);
  });
});

/* ============================================================
   切主题不重开局
   ============================================================ */

describe("切主题不重开局（真渲染器）", () => {
  it("Canvas 换成 TUI 后盘面与分数原样保留", () => {
    const cells = Array.from({ length: 16 }, (_, i) => i % 6);
    const snapshot = snapshotOf(viewOf(4, 4, { cells, score: 480 }), {
      version: 7,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<Match3View>(() => {});
    session.applySnapshot(snapshot);

    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(
        fakeContext().ctx as unknown as CanvasRenderingContext2D,
      );
    session.attachRenderer(new CanvasMatch3Renderer(), host);
    spy.mockRestore();
    expect(host.querySelector("canvas")).not.toBeNull();

    session.attachRenderer(new TuiMatch3Renderer(), host);
    // 旧渲染器的节点必须被清掉，否则两套画面会叠在一起
    expect(host.querySelector("canvas")).toBeNull();

    const text = host.querySelector("pre")?.textContent ?? "";
    expect(text).toBe(renderBoardText(snapshot.board));
    expect(session.currentState()?.version).toBe(7);
    expect(session.currentState()?.board.score).toBe(480);
  });

  it("换渲染器后新渲染器的意图仍能送达", () => {
    const sent: InputIntent[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const session = new GameSession<Match3View>((i) => sent.push(i));
    session.applySnapshot(snapshotOf(viewOf()));

    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(
        fakeContext().ctx as unknown as CanvasRenderingContext2D,
      );
    session.attachRenderer(new CanvasMatch3Renderer(), host);
    spy.mockRestore();
    session.attachRenderer(new TuiMatch3Renderer(), host);

    const root = host.firstElementChild as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({
      a: { row: 0, col: 0 },
      b: { row: 0, col: 1 },
    });
  });
});
