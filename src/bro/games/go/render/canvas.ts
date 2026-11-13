/**
 * Canvas 渲染器（亮色模式）。
 *
 * 棋盘区不套玻璃效果——`backdrop-filter` 在每帧重绘的区域上会把 GPU
 * 吃光，帧率优先于观感（UI-DESIGN.md §5，由 tokens 测试里的护栏强制）。
 * 质感靠棋子的渐变和阴影做，那是画在画布里的，不走合成层。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import { BLACK, EMPTY } from "../logic";
import type { GoView } from "../view";
import { GO_INTENT, playerOfSeat } from "../view";
import type { BoardLayout } from "./layout";
import {
  computeLayout,
  pixelToPoint,
  pointToPixel,
  starPoints,
} from "./layout";


const PALETTE = {
  board: "#e8d5a8",
  line: "#6b5836",
  star: "#5a4a2c",
  blackStone: "#14110c",
  blackStoneHi: "#4a453c",
  whiteStone: "#fbfaf7",
  whiteStoneHi: "#ffffff",
  whiteStoneEdge: "#b9b1a0",
  lastMove: "#c0392b",
} as const;

export class CanvasGoRenderer implements GameRenderer<GoView> {
  readonly mode: RenderMode = "canvas";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<GoView> | null = null;
  private layout: BoardLayout | null = null;
  /** 悬停的交叉点。纯本地视觉状态，不进快照。 */
  private hover: number | null = null;
  private observer: ResizeObserver | null = null;

  mount(container: HTMLElement): void {
    const canvas = document.createElement("canvas");
    canvas.className = "bro-go-canvas";
    container.append(canvas);

    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);

    // 容器尺寸变化要重算布局，否则拉窗口后棋盘会糊或错位
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(state: GameState<GoView>): void {
    this.latest = state;
    this.resize();
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.observer?.disconnect();
    this.canvas?.removeEventListener("click", this.onClick);
    this.canvas?.removeEventListener("mousemove", this.onMouseMove);
    this.canvas?.removeEventListener("mouseleave", this.onMouseLeave);
    this.canvas?.remove();
    this.observer = null;
    this.canvas = null;
    this.ctx = null;
    this.handler = null;
    this.latest = null;
    this.layout = null;
  }

  /** 按容器实际尺寸与设备像素比重置画布，然后重绘。 */
  private resize(): void {
    const canvas = this.canvas;
    const state = this.latest;
    if (!canvas || !state) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 0;
    const height = parent?.clientHeight ?? 0;
    if (width === 0 || height === 0) return;

    const layout = computeLayout(state.board.size, width, height);
    // 按 DPR 放大位图再用 CSS 缩回去，否则高分屏上线条会发虚
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(layout.extent * dpr);
    canvas.height = Math.round(layout.extent * dpr);
    canvas.style.width = `${layout.extent}px`;
    canvas.style.height = `${layout.extent}px`;

    this.layout = layout;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(state, layout);
  }

  private draw(state: GameState<GoView>, layout: BoardLayout): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const view = state.board;

    ctx.clearRect(0, 0, layout.extent, layout.extent);
    ctx.fillStyle = PALETTE.board;
    ctx.fillRect(0, 0, layout.extent, layout.extent);

    this.drawGrid(ctx, layout);
    this.drawStars(ctx, layout);

    for (let i = 0; i < view.cells.length; i += 1) {
      if (view.cells[i] !== EMPTY) {
        const { x, y } = pointToPixel(layout, i);
        this.drawStone(ctx, x, y, layout.radius, view.cells[i] === BLACK);
      }
    }

    if (view.lastMove !== null && view.cells[view.lastMove] !== EMPTY) {
      const { x, y } = pointToPixel(layout, view.lastMove);
      ctx.beginPath();
      ctx.arc(x, y, layout.radius * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.lastMove;
      ctx.fill();
    }

    this.drawHover(ctx, state, layout);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
    const { size, origin, step } = layout;
    const end = origin + (size - 1) * step;
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < size; i += 1) {
      // 加 0.5 让 1px 线落在像素中心，否则会被抗锯齿摊成 2px 灰线
      const at = Math.round(origin + i * step) + 0.5;
      ctx.moveTo(at, origin);
      ctx.lineTo(at, end);
      ctx.moveTo(origin, at);
      ctx.lineTo(end, at);
    }
    ctx.stroke();
  }

  private drawStars(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
    ctx.fillStyle = PALETTE.star;
    for (const index of starPoints(layout.size)) {
      const { x, y } = pointToPixel(layout, index);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, layout.step * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStone(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    black: boolean,
  ): void {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = radius * 0.35;
    ctx.shadowOffsetY = radius * 0.14;

    // 高光偏左上，模拟单一光源。所有棋子方向一致，不然看着像贴纸
    const gradient = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.35,
      radius * 0.1,
      x,
      y,
      radius,
    );
    if (black) {
      gradient.addColorStop(0, PALETTE.blackStoneHi);
      gradient.addColorStop(1, PALETTE.blackStone);
    } else {
      gradient.addColorStop(0, PALETTE.whiteStoneHi);
      gradient.addColorStop(1, PALETTE.whiteStone);
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    if (!black) {
      // 白子和奶油色棋盘明度接近，没有描边就分不出边界
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = PALETTE.whiteStoneEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** 悬停处画一枚半透明的预览子，落子前能看清位置。 */
  private drawHover(
    ctx: CanvasRenderingContext2D,
    state: GameState<GoView>,
    layout: BoardLayout,
  ): void {
    const at = this.hover;
    if (at === null || !canAct(state)) return;
    if (state.board.cells[at] !== EMPTY || at === state.board.koPoint) return;

    const { x, y } = pointToPixel(layout, at);
    ctx.save();
    ctx.globalAlpha = 0.45;
    this.drawStone(
      ctx,
      x,
      y,
      layout.radius,
      playerOfSeat(state.mySeat ?? 0) === BLACK,
    );
    ctx.restore();
  }

  private onClick = (event: MouseEvent): void => {
    const index = this.pointAt(event);
    const state = this.latest;
    if (index === null || !state) return;
    // 已有子的点不必惊动服务端。合法性最终仍由服务端裁定。
    if (state.board.cells[index] !== EMPTY) return;
    if (!this.handler || !canAct(state)) return;
    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type: GO_INTENT.place,
      payload: { index },
    });
  };

  private onMouseMove = (event: MouseEvent): void => {
    const index = this.pointAt(event);
    if (index === this.hover) return;
    this.hover = index;
    if (this.latest && this.layout) this.draw(this.latest, this.layout);
  };

  private onMouseLeave = (): void => {
    if (this.hover === null) return;
    this.hover = null;
    if (this.latest && this.layout) this.draw(this.latest, this.layout);
  };

  private pointAt(event: MouseEvent): number | null {
    if (!this.canvas || !this.layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    return pixelToPoint(
      this.layout,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }
}
