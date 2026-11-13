/**
 * Canvas 渲染器（亮色模式）。
 *
 * 盘面区不套玻璃效果——`backdrop-filter` 压在每帧重绘的区域上会把 GPU 吃光
 * （UI-DESIGN.md §2.4「游戏对局界面全程禁用玻璃」）。质感靠画在画布里的
 * 渐变与描边做，不走合成层。
 *
 * ## 动画不重演中间盘面
 *
 * 消消乐最想让人看到的是连锁：消掉一批 → 上方落下 → 又凑成新的一批。逐帧
 * 回放这个过程需要在渲染层重新算一遍「消除 → 下落 → 补充」，那是把规则搬
 * 进渲染层（core/types.ts 约束一），也意味着同一份规则有两个实现，迟早分叉。
 *
 * 这里的做法是：盘面直接画结算后的稳定态，另外用服务端下发的 `steps` 播两
 * 层特效——
 *
 * - **消除闪光**：每层连锁在自己的时间片里，在该层清掉的坐标上放一圈扩散的
 *   光环，二层以上还标出「×N」。层数与倍率因此看得见。
 * - **落入**：新盘面整体从上方滑入，每列的起始高度由该列被清掉的格子数决定。
 *
 * 得到的观感是「炸了几批、落下来一片」，而不是逐格回放。这是刻意的取舍，
 * 换来的是渲染层里一行规则都没有。
 *
 * 动画全程不阻塞输入：任何时候点击都立即上报意图，新快照到达即打断当前
 * 时间线（UI-DESIGN.md §5.1「动画必须可打断」）。`prefers-reduced-motion`
 * 下完全不起 rAF，直接画终态。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { Pos, TileKind } from "../logic";
import { isAdjacent, posEquals } from "../logic";
import type { Match3View } from "../view";
import { MATCH3_INTENT } from "../view";
import type { Match3Layout } from "./layout";
import {
  cellCenter,
  chainFlashProgress,
  clearedPerColumn,
  computeLayout,
  dropProgress,
  easeOut,
  fallDistance,
  pixelToCell,
  REJECTED_SWAP_MS,
  SWAP_MS,
  swapProgress,
  timelineDuration,
} from "./layout";


export type CanvasMatch3Theme = "ceramic" | "terminal";

const PALETTES = {
  ceramic: {
    board: "#e9e4dc",
    boardDeep: "#cfc6bb",
    grid: "rgba(78, 59, 37, 0.1)",
    cursor: "rgba(50, 40, 30, 0.42)",
    selected: "#b88713",
    flash: "#fff8dc",
    flashRing: "#d2a42b",
    chainLabel: "#39280e",
    facet: "rgba(255,255,255,0.24)",
    facetEdge: "rgba(255,255,255,0.44)",
    rim: "rgba(61,42,26,0.34)",
    trail: "rgba(195,145,28,0.5)",
    tiles: ["#e5ad24", "#28a66a", "#477fd1", "#d94a49", "#8e5dcb", "#20a7b8"],
  },
  terminal: {
    board: "#041109",
    boardDeep: "#010603",
    grid: "rgba(95,244,145,0.13)",
    cursor: "rgba(108,240,154,0.5)",
    selected: "#7dffab",
    flash: "#d8ffe5",
    flashRing: "#6cf09a",
    chainLabel: "#d8ffe5",
    facet: "rgba(225,255,235,0.18)",
    facetEdge: "rgba(178,255,204,0.38)",
    rim: "rgba(4,30,14,0.92)",
    trail: "rgba(108,240,154,0.52)",
    tiles: ["#ffd34f", "#5bed91", "#64a5ff", "#ff6f69", "#bd85ff", "#4fe6e0"],
  },
} as const;

/** 元素高光的提亮量。同一个方向的高光让所有元素看起来受同一束光照。 */
const HIGHLIGHT = "rgba(255, 255, 255, 0.55)";

type ShapePainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) => void;

/**
 * 元素形状表。下标即 `TileKind`，与 TUI 的 `TILE_GLYPHS` 一一对应。
 *
 * 六种形状必须**两两可辨**，这是无障碍要求而不是美术偏好：只靠颜色区分
 * 元素时，色觉障碍玩家连「这三个是不是同一种」都判断不了，游戏直接不可玩
 * （UI-DESIGN.md §9）。tests 里有一条用例逐对比较六种形状的路径，形状撞车
 * 会直接变红。
 */
const TILE_SHAPES: readonly ShapePainter[] = [
  // ◆ 菱形
  (ctx, x, y, r) => polygon(ctx, x, y, r, 4, -Math.PI / 2),
  // ▲ 三角
  (ctx, x, y, r) => polygon(ctx, x, y, r, 3, -Math.PI / 2),
  // ● 圆
  (ctx, x, y, r) => {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  },
  // ■ 方
  (ctx, x, y, r) => polygon(ctx, x, y, r, 4, -Math.PI / 4),
  // ★ 五角星
  (ctx, x, y, r) => star(ctx, x, y, r, r * 0.42, 5),
  // 第六种：六边形（TUI 那边是 ○；Canvas 用六边形以免和菱形撞形）
  (ctx, x, y, r) => polygon(ctx, x, y, r, 6, 0),
];

export interface CanvasMatch3RendererOptions {
  /**
   * 时钟。
   *
   * 注入而不是直接读 `performance.now()`：真跑 rAF 的测试只能断言「动了」，
   * 断言不了「第 180 毫秒画的是第几层连锁」。而错峰时序恰恰是最容易写错、
   * 肉眼又最难验的部分。这和 go/server/bot.ts 注入 RNG 是同一个理由。
   */
  readonly now?: () => number;
  /** 是否减少动效。缺省读 `prefers-reduced-motion`。 */
  readonly reducedMotion?: () => boolean;
  /** 陶瓷白日间盘面或终端夜间盘面。切换只重挂渲染器，不重开会话。 */
  readonly theme?: CanvasMatch3Theme;
}

export class CanvasMatch3Renderer implements GameRenderer<Match3View> {
  readonly mode: RenderMode = "canvas";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<Match3View> | null = null;
  private layout: Match3Layout | null = null;
  private observer: ResizeObserver | null = null;

  /** 已选中待交换的格子。纯本地视觉状态，不进快照。 */
  private selected: Pos | null = null;
  /** 键盘光标。与鼠标悬停分开：悬停跟着指针走，光标不该因为鼠标划过就跳位。 */
  private cursor: Pos = { row: 0, col: 0 };
  private hover: Pos | null = null;
  private focused = false;

  /** 当前时间线的起点。`null` 表示没有动画在跑。 */
  private animStart: number | null = null;
  private frame: number | null = null;
  /** 本次有效交换前的完整盘面，用于先播交换再播消除。 */
  private animFromCells: readonly TileKind[] | null = null;
  /** 服务端拒绝的交换：两颗宝石换过去再弹回原位。 */
  private rejectedSwap: readonly [Pos, Pos] | null = null;

  private readonly now: () => number;
  private readonly reducedMotion: () => boolean;
  private readonly theme: CanvasMatch3Theme;
  private readonly palette: (typeof PALETTES)[CanvasMatch3Theme];

  constructor(options: CanvasMatch3RendererOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.reducedMotion = options.reducedMotion ?? defaultReducedMotion;
    this.theme = options.theme ?? "ceramic";
    this.palette = PALETTES[this.theme];
  }

  mount(container: HTMLElement): void {
    const canvas = document.createElement("canvas");
    canvas.className = "bro-match3-canvas";
    canvas.dataset.visualTheme = this.theme;
    // 键盘也要能玩（UI-DESIGN.md §9 全键盘可达）。画布默认不可聚焦，
    // 不给 tabIndex 的话这块区域对键盘用户等于不存在。
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "消消乐盘面，方向键移动，回车选中与交换");
    container.append(canvas);

    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);
    canvas.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("focus", this.onFocus);
    canvas.addEventListener("blur", this.onBlur);

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(state: GameState<Match3View>): void {
    const previous = this.latest;
    this.latest = state;

    // 版本没动就什么都不做（契约要求 render 幂等）。这既保证了同一状态重复
    // 下发时动画不会反复重启，也保证了选中态不会被无谓清掉。
    if (!previous || previous.version !== state.version) {
      // 版本前进说明服务端接受了一步：选中态该清掉了，否则玩家会拿着上一步
      // 的选中继续点，第二次点击的语义全错
      this.selected = null;
      this.animFromCells =
        previous && state.board.lastSwap ? previous.board.cells : null;
      this.startAnimation(state);
    }

    this.resize();
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.cancelFrame();
    this.observer?.disconnect();
    this.canvas?.removeEventListener("click", this.onClick);
    this.canvas?.removeEventListener("mousemove", this.onMouseMove);
    this.canvas?.removeEventListener("mouseleave", this.onMouseLeave);
    this.canvas?.removeEventListener("keydown", this.onKeyDown);
    this.canvas?.removeEventListener("focus", this.onFocus);
    this.canvas?.removeEventListener("blur", this.onBlur);
    this.canvas?.remove();
    this.observer = null;
    this.canvas = null;
    this.ctx = null;
    this.handler = null;
    this.latest = null;
    this.layout = null;
    this.animStart = null;
    this.animFromCells = null;
    this.rejectedSwap = null;
  }

  /* ---------------- 动画 ---------------- */

  /**
   * 起一条新时间线。
   *
   * 无论上一条跑没跑完都直接换掉——新快照代表新的权威事实，继续播旧动画
   * 就是在演一个已经不成立的过去。这也是 §5.1「动画必须可打断」的落地。
   */
  private startAnimation(state: GameState<Match3View>): void {
    this.cancelFrame();
    this.rejectedSwap = null;

    const duration = timelineDuration(
      state.board.steps.length,
      this.animFromCells !== null && state.board.lastSwap !== null,
    );
    if (duration === 0 || this.reducedMotion()) {
      this.animStart = null;
      return;
    }

    this.animStart = this.now();
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (typeof requestAnimationFrame === "undefined") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const state = this.latest;
      const layout = this.layout;
      if (!state || !layout || this.animStart === null) return;

      if (this.elapsed() >= this.animationDuration()) {
        this.animStart = null;
        this.animFromCells = null;
        this.rejectedSwap = null;
        this.draw(state, layout);
        return;
      }
      this.draw(state, layout);
      this.scheduleFrame();
    });
  }

  private cancelFrame(): void {
    if (this.frame !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  }

  /**
   * 时间线上已经过去的毫秒数。
   *
   * 没有动画在跑时返回整条时间线的长度，也就是「终态」。用它而不是
   * `Infinity`，是因为进度函数要做除法，无穷大会一路把 NaN 传进坐标。
   */
  private elapsed(): number {
    if (this.animStart === null) return this.animationDuration();
    return this.now() - this.animStart;
  }

  private animationDuration(): number {
    if (this.rejectedSwap) return REJECTED_SWAP_MS;
    const view = this.latest?.board;
    return timelineDuration(
      view?.steps.length ?? 0,
      this.animFromCells !== null && view?.lastSwap !== null,
    );
  }

  /* ---------------- 绘制 ---------------- */

  private resize(): void {
    const canvas = this.canvas;
    const state = this.latest;
    if (!canvas || !state) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 0;
    const height = parent?.clientHeight ?? 0;
    if (width === 0 || height === 0) return;

    const { width: cols, height: rows } = state.board;
    const layout = computeLayout(cols, rows, width, height);

    // 按 DPR 放大位图再用 CSS 缩回去，否则高分屏上元素边缘发虚
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(layout.extentX * dpr);
    canvas.height = Math.round(layout.extentY * dpr);
    canvas.style.width = `${layout.extentX}px`;
    canvas.style.height = `${layout.extentY}px`;

    this.layout = layout;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(state, layout);
  }

  private draw(state: GameState<Match3View>, layout: Match3Layout): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const view = state.board;
    const elapsed = this.elapsed();

    ctx.clearRect(0, 0, layout.extentX, layout.extentY);
    this.drawBoard(ctx, layout);

    this.drawTiles(ctx, view, layout, elapsed);
    this.drawMarkers(ctx, state, layout);
    // 有效交换必须先完整移动，消除爆裂从 SWAP_MS 之后才开始。把负时间
    // clamp 成 0 会让第一层爆裂在交换全程停留在最亮一帧，观感像误闪。
    if (!this.rejectedSwap && (!this.animFromCells || elapsed >= SWAP_MS)) {
      const settlementElapsed = this.animFromCells
        ? Math.max(0, elapsed - SWAP_MS)
        : elapsed;
      this.drawFlashes(ctx, view, layout, settlementElapsed);
    }
  }

  private drawBoard(ctx: CanvasRenderingContext2D, layout: Match3Layout): void {
    if (typeof ctx.createRadialGradient === "function") {
      const surface = ctx.createRadialGradient(
        layout.extentX * 0.38,
        layout.extentY * 0.26,
        0,
        layout.extentX * 0.5,
        layout.extentY * 0.5,
        layout.extentX * 0.78,
      );
      surface.addColorStop(0, this.palette.board);
      surface.addColorStop(1, this.palette.boardDeep);
      ctx.fillStyle = surface;
    } else {
      ctx.fillStyle = this.palette.board;
    }
    ctx.fillRect(0, 0, layout.extentX, layout.extentY);

    ctx.save();
    ctx.strokeStyle = this.palette.grid;
    ctx.lineWidth = this.theme === "terminal" ? 1 : 0.7;
    for (let col = 0; col <= layout.columns; col += 1) {
      const x = layout.origin + col * layout.cell;
      ctx.beginPath();
      ctx.moveTo(x, layout.origin);
      ctx.lineTo(x, layout.extentY - layout.origin);
      ctx.stroke();
    }
    for (let row = 0; row <= layout.rows; row += 1) {
      const y = layout.origin + row * layout.cell;
      ctx.beginPath();
      ctx.moveTo(layout.origin, y);
      ctx.lineTo(layout.extentX - layout.origin, y);
      ctx.stroke();
    }
    if (this.theme === "terminal") {
      ctx.globalAlpha = 0.11;
      ctx.strokeStyle = "#6cf09a";
      for (let y = 3; y < layout.extentY; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(layout.extentX, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawTiles(
    ctx: CanvasRenderingContext2D,
    view: Match3View,
    layout: Match3Layout,
    elapsed: number,
  ): void {
    const swap = this.rejectedSwap ?? view.lastSwap;
    const fromCells = this.rejectedSwap ? view.cells : this.animFromCells;
    if (
      swap &&
      fromCells &&
      elapsed < (this.rejectedSwap ? REJECTED_SWAP_MS : SWAP_MS)
    ) {
      this.drawSwappingTiles(
        ctx,
        fromCells,
        view,
        layout,
        swap,
        swapProgress(elapsed, this.rejectedSwap !== null),
      );
      return;
    }

    const settlementElapsed = this.animFromCells
      ? Math.max(0, elapsed - SWAP_MS)
      : elapsed;
    const cleared = view.steps.flatMap((step) => step.cleared);
    const perColumn = clearedPerColumn(layout.columns, cleared);
    const settle = easeOut(dropProgress(settlementElapsed));

    // 裁到盘面区域：下落中的元素起点在盘外，不裁就会画到留白甚至面板上
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, layout.extentX, layout.extentY);
    ctx.clip();

    for (let row = 0; row < view.height; row += 1) {
      for (let col = 0; col < view.width; col += 1) {
        const kind = view.cells[row * view.width + col];
        const { x, y } = cellCenter(layout, { row, col });
        const offset = (1 - settle) * fallDistance(layout, perColumn[col]);
        this.drawTile(ctx, kind, x, y - offset, layout.tile / 2);
      }
    }

    ctx.restore();
  }

  private drawSwappingTiles(
    ctx: CanvasRenderingContext2D,
    cells: readonly TileKind[],
    view: Match3View,
    layout: Match3Layout,
    swap: readonly [Pos, Pos],
    progress: number,
  ): void {
    const [a, b] = swap;
    const aIndex = a.row * view.width + a.col;
    const bIndex = b.row * view.width + b.col;
    const aCenter = cellCenter(layout, a);
    const bCenter = cellCenter(layout, b);

    for (let row = 0; row < view.height; row += 1) {
      for (let col = 0; col < view.width; col += 1) {
        const index = row * view.width + col;
        if (index === aIndex || index === bIndex) continue;
        const { x, y } = cellCenter(layout, { row, col });
        this.drawTile(ctx, cells[index], x, y, layout.tile / 2);
      }
    }

    const mix = (start: number, end: number) =>
      start + (end - start) * progress;
    const aX = mix(aCenter.x, bCenter.x);
    const aY = mix(aCenter.y, bCenter.y);
    const bX = mix(bCenter.x, aCenter.x);
    const bY = mix(bCenter.y, aCenter.y);
    const lift = 1 + Math.sin(progress * Math.PI) * 0.09;

    ctx.save();
    ctx.strokeStyle = this.palette.trail;
    ctx.lineWidth = Math.max(2, layout.cell * 0.055);
    ctx.globalAlpha = 0.28 + Math.sin(progress * Math.PI) * 0.5;
    ctx.beginPath();
    ctx.moveTo(aCenter.x, aCenter.y);
    ctx.lineTo(aX, aY);
    ctx.moveTo(bCenter.x, bCenter.y);
    ctx.lineTo(bX, bY);
    ctx.stroke();
    ctx.restore();

    this.drawTile(ctx, cells[aIndex], aX, aY, (layout.tile / 2) * lift);
    this.drawTile(ctx, cells[bIndex], bX, bY, (layout.tile / 2) * lift);
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    kind: TileKind,
    x: number,
    y: number,
    radius: number,
  ): void {
    const paint = TILE_SHAPES[kind % TILE_SHAPES.length];
    const base = this.palette.tiles[kind % this.palette.tiles.length];

    ctx.save();
    ctx.shadowColor =
      this.theme === "terminal"
        ? "rgba(74,255,132,0.24)"
        : "rgba(55,34,15,0.34)";
    ctx.shadowBlur = radius * (this.theme === "terminal" ? 0.48 : 0.26);
    ctx.shadowOffsetY = radius * 0.12;
    ctx.beginPath();
    paint(ctx, x, y, radius);
    // 真浏览器使用多段径向反射形成宝石的透亮切面；测试的轻量 Canvas mock
    // 没有渐变 API 时回退纯色，绘制次数与形状契约保持不变。
    if (typeof ctx.createRadialGradient === "function") {
      const gem = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.34,
        radius * 0.06,
        x,
        y,
        radius * 1.08,
      );
      gem.addColorStop(0, "rgba(255,255,255,0.96)");
      gem.addColorStop(0.2, base);
      gem.addColorStop(0.72, base);
      gem.addColorStop(1, "rgba(12,18,28,0.72)");
      ctx.fillStyle = gem;
    } else {
      ctx.fillStyle = base;
    }
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 外沿、内层切面与中心折射线共同构成宝石厚度；它们只描边，不新增
    // 位图素材或额外合成层，在高 DPI 与缩放下依然保持锐利。
    ctx.strokeStyle = this.palette.rim;
    ctx.lineWidth = Math.max(1.2, radius * 0.075);
    ctx.stroke();

    ctx.beginPath();
    paint(ctx, x, y, radius * 0.72);
    ctx.strokeStyle = this.palette.facetEdge;
    ctx.lineWidth = Math.max(0.8, radius * 0.045);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - radius * 0.56, y - radius * 0.32);
    ctx.moveTo(x, y);
    ctx.lineTo(x + radius * 0.48, y - radius * 0.4);
    ctx.moveTo(x, y);
    ctx.lineTo(x + radius * 0.34, y + radius * 0.54);
    ctx.strokeStyle = this.palette.facet;
    ctx.lineWidth = Math.max(0.65, radius * 0.03);
    ctx.stroke();

    // 同方向的小高光，让六种形状看起来是同一批材质而不是六张贴纸
    ctx.beginPath();
    paint(ctx, x - radius * 0.18, y - radius * 0.18, radius * 0.42);
    ctx.fillStyle = HIGHLIGHT;
    ctx.fill();
    ctx.restore();
  }

  /** 光标（键盘）与选中（待交换）的标记。两者形态不同，不靠颜色区分。 */
  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    state: GameState<Match3View>,
    layout: Match3Layout,
  ): void {
    if (!canAct(state)) return;

    const half = layout.cell / 2;

    if (this.focused) {
      const { x, y } = cellCenter(layout, this.cursor);
      ctx.strokeStyle = this.palette.cursor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - half, y - half, layout.cell, layout.cell);
    }

    if (
      this.hover &&
      !posEquals(this.hover, this.selected ?? { row: -1, col: -1 })
    ) {
      const { x, y } = cellCenter(layout, this.hover);
      ctx.strokeStyle = this.palette.cursor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - half, y - half, layout.cell, layout.cell);
    }

    if (this.selected) {
      const { x, y } = cellCenter(layout, this.selected);
      // 选中是粗框 + 四角内缩的角标，和光标细框在形状上就分得开
      ctx.strokeStyle = this.palette.selected;
      ctx.lineWidth = 3;
      ctx.strokeRect(x - half, y - half, layout.cell, layout.cell);
      ctx.beginPath();
      ctx.arc(x, y, layout.tile * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 连锁闪光。每层在自己的时间片内扩散并淡出，二层以上标出倍率。 */
  private drawFlashes(
    ctx: CanvasRenderingContext2D,
    view: Match3View,
    layout: Match3Layout,
    elapsed: number,
  ): void {
    for (const step of view.steps) {
      const progress = chainFlashProgress(elapsed, step.chain);
      if (progress === null) continue;

      const eased = easeOut(progress);
      const scale = 1 + eased * 0.6;
      const alpha = 1 - eased;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = this.palette.flashRing;
      ctx.fillStyle = this.palette.flash;
      ctx.lineWidth = 2;

      for (const p of step.cleared) {
        const { x, y } = cellCenter(layout, p);
        const r = (layout.tile / 2) * scale;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        this.drawBurstParticles(ctx, x, y, r, eased);
      }

      if (step.chain >= 2) {
        const anchor = centroid(layout, step.cleared);
        ctx.fillStyle = this.palette.chainLabel;
        ctx.font = `700 ${Math.round(layout.cell * 0.34)}px ${FONT_STACK}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`CHAIN ×${step.chain}`, anchor.x, anchor.y);
      }

      ctx.restore();
    }
  }

  private drawBurstParticles(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    progress: number,
  ): void {
    const count = this.reducedMotion() ? 0 : 6;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + index * 0.19;
      const travel = radius * (0.28 + progress * 0.92);
      const px = x + Math.cos(angle) * travel;
      const py = y + Math.sin(angle) * travel;
      const size = Math.max(1.2, radius * (0.12 - progress * 0.065));
      ctx.beginPath();
      polygon(ctx, px, py, size, 4, Math.PI / 4);
      ctx.fillStyle = this.palette.flash;
      ctx.fill();
    }
  }

  /* ---------------- 输入 ---------------- */

  private onClick = (event: MouseEvent): void => {
    const at = this.cellAt(event);
    if (at === null) return;
    this.hover = at;
    this.cursor = at;
    this.pick(at);
  };

  private onMouseMove = (event: MouseEvent): void => {
    const at = this.cellAt(event);
    if (samePos(at, this.hover)) return;
    this.hover = at;
    this.redraw();
  };

  private onMouseLeave = (): void => {
    if (this.hover === null) return;
    this.hover = null;
    this.redraw();
  };

  private onFocus = (): void => {
    this.focused = true;
    this.redraw();
  };

  private onBlur = (): void => {
    this.focused = false;
    this.redraw();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const state = this.latest;
    if (!state) return;
    const { width, height } = state.board;
    const { row, col } = this.cursor;

    const moved = ((): Pos | null => {
      switch (event.key) {
        case "h":
        case "ArrowLeft":
          return col > 0 ? { row, col: col - 1 } : null;
        case "l":
        case "ArrowRight":
          return col < width - 1 ? { row, col: col + 1 } : null;
        case "k":
        case "ArrowUp":
          return row > 0 ? { row: row - 1, col } : null;
        case "j":
        case "ArrowDown":
          return row < height - 1 ? { row: row + 1, col } : null;
        default:
          return null;
      }
    })();

    if (moved) {
      event.preventDefault();
      this.cursor = moved;
      this.redraw();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.pick(this.cursor);
    } else if (event.key === "Escape" && this.selected) {
      event.preventDefault();
      this.selected = null;
      this.redraw();
    }
  };

  /**
   * 两次点击构成一次交换：先选中，再点相邻格。
   *
   * 不做拖拽。拖拽要在 Canvas 上自己实现指针捕获与阈值判定，而且对触控板、
   * 辅助设备都不友好；两次点击的语义又恰好和 TUI 的「Enter 选中 → Enter
   * 交换」完全一致，两套渲染器行为统一，玩家切主题不用重新学。
   *
   * 点非相邻格改选它，而不是报错——这是玩家改主意的正常操作。
   */
  private pick(at: Pos): void {
    const state = this.latest;
    if (!state || !canAct(state)) return;

    const selected = this.selected;
    if (selected === null) {
      this.selected = at;
      this.redraw();
      return;
    }
    if (posEquals(selected, at)) {
      this.selected = null;
      this.redraw();
      return;
    }
    if (!isAdjacent(selected, at)) {
      this.selected = at;
      this.redraw();
      return;
    }

    this.emitSwap(state, selected, at);
  }

  private emitSwap(state: GameState<Match3View>, a: Pos, b: Pos): void {
    if (!this.handler) return;
    const versionBefore = this.latest?.version;
    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type: MATCH3_INTENT.swap,
      payload: { a, b },
    });
    // 本地 server 是同步的：版本没有前进即代表交换被拒。让两颗宝石明确
    // 地换过去再弹回，玩家不用靠外侧错误文案猜发生了什么。
    if (this.latest?.version === versionBefore && !this.reducedMotion()) {
      this.cancelFrame();
      this.selected = null;
      this.animFromCells = null;
      this.rejectedSwap = [a, b];
      this.animStart = this.now();
      this.scheduleFrame();
    }
  }

  private cellAt(event: MouseEvent): Pos | null {
    if (!this.canvas || !this.layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    return pixelToCell(
      this.layout,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  private redraw(): void {
    if (this.latest && this.layout) this.draw(this.latest, this.layout);
  }
}

const FONT_STACK = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';

/** 正多边形路径。`rotation` 让菱形与方块用同一个函数画出不同朝向。 */
function polygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number,
): void {
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * Math.PI * 2) / sides;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 星形路径：外顶点与内顶点交替。 */
function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outer: number,
  inner: number,
  points: number,
): void {
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 一组格子的中心。连锁倍率标在这里，不至于压在某一个格子上看不清。 */
function centroid(
  layout: Match3Layout,
  positions: readonly Pos[],
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of positions) {
    const c = cellCenter(layout, p);
    x += c.x;
    y += c.y;
  }
  const n = Math.max(1, positions.length);
  return { x: x / n, y: y / n };
}

function samePos(a: Pos | null, b: Pos | null): boolean {
  if (a === null || b === null) return a === b;
  return posEquals(a, b);
}

/**
 * 默认的减少动效判定。
 *
 * `matchMedia` 在部分测试环境里不存在，缺失时按「不减少动效」处理——把
 * 「查不到」当成「要减少」会让所有拿不到 matchMedia 的环境统统失去动画，
 * 而那是多数无头环境的常态。
 */
function defaultReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
