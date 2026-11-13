/**
 * Canvas 渲染器（亮色模式）。
 *
 * 棋盘区不套玻璃效果——`backdrop-filter` 在每帧重绘的区域上会把 GPU 吃光，
 * 帧率优先于观感（UI-DESIGN.md §2.4，由 tokens 测试里的护栏强制）。质感靠棋子
 * 的渐变与阴影做，那是画在画布里的，不走合成层。
 *
 * 配色写在这里而不是取自设计令牌，与围棋渲染器一致：Canvas 读不到 CSS 变量，
 * 要读得每帧 `getComputedStyle`，那是布局抖动的常见来源。代价是换主题色时这张
 * 表要跟着改，已在交付说明里登记。
 *
 * 红黑的区分不靠颜色单独承担：字形本身就是两套（帥/將、俥/車……见 glyphs.ts），
 * 另外红子画双圈、黑子画单圈。灰度下仍分得清敌我（UI-DESIGN.md §9）。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { Piece, Side } from "../logic";
import { FILES, RANKS } from "../logic";
import type { XiangqiView } from "../view";
import { XIANGQI_INTENT, sideOfSeat } from "../view";
import { glyphOf } from "./glyphs";
import type { BoardLayout } from "./layout";
import {
  computeLayout,
  isEdgeFile,
  palaceDiagonals,
  pixelToPoint,
  pointToPixel,
  riverBand,
} from "./layout";
import { resolveTap, targetsFrom } from "./selection";


const PALETTE = {
  board: "#e8d5a8",
  line: "#6b5836",
  border: "#4a3d24",
  river: "#8a7550",
  disc: "#f6ead0",
  discEdge: "#b9a077",
  red: "#b3453a",
  black: "#1c1917",
  select: "#c9a227",
  target: "#3f7d58",
  last: "#4a6fa5",
  check: "#b3453a",
} as const;

/**
 * 棋子与河界的字体栈。
 *
 * Canvas 的 `font` 不认 CSS 变量（那是 CSSOM 的东西），只能写死字体名。楷体
 * 打头是象棋的传统字面，装不到就退回系统衬线——退回后字仍然认得出来，
 * 而认得出字比字好看重要得多。
 */
const PIECE_FONT = '"KaiTi", "STKaiti", "Kaiti SC", "SimSun", serif';

export class CanvasXiangqiRenderer implements GameRenderer<XiangqiView> {
  readonly mode: RenderMode = "canvas";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<XiangqiView> | null = null;
  private layout: BoardLayout | null = null;
  /** 悬停点与选中点。纯本地视觉状态，不进快照。 */
  private hover: number | null = null;
  private selected: number | null = null;
  private observer: ResizeObserver | null = null;

  mount(container: HTMLElement): void {
    const canvas = document.createElement("canvas");
    canvas.className = "bro-xiangqi-canvas";
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

  render(state: GameState<XiangqiView>): void {
    this.latest = state;
    // 选中的子可能已被吃掉，或者局面被悔棋退了回去。留着悬空的选中点，
    // 下一次点击会照着一张过期的可走点表发意图。
    if (this.selected !== null && state.board.board[this.selected] == null) {
      this.selected = null;
    }
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

    const layout = computeLayout(width, height);
    // 按 DPR 放大位图再用 CSS 缩回去，否则高分屏上线条会发虚、棋子上的字会糊
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;

    this.layout = layout;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(state, layout);
  }

  private draw(state: GameState<XiangqiView>, layout: BoardLayout): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const view = state.board;

    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = PALETTE.board;
    ctx.fillRect(0, 0, layout.width, layout.height);

    this.drawGrid(ctx, layout);
    this.drawPalaces(ctx, layout);
    this.drawRiver(ctx, layout);

    // 标记画在子的下面：压在子上会挡住字，而字是分辨兵种的唯一依据
    this.drawLastMove(ctx, view, layout);
    this.drawTargets(ctx, view, layout);

    for (let i = 0; i < view.board.length; i += 1) {
      const piece = view.board[i];
      if (piece) this.drawPiece(ctx, layout, i, piece);
    }

    this.drawSelection(ctx, layout);
    this.drawCheck(ctx, view, layout);
    this.drawHover(ctx, state, layout);
  }

  /**
   * 栅格。
   *
   * 横线十条通到底；竖线只有最外两条贯通，中间七条在河界处断开——那道缺口
   * 就是楚河汉界，补上了这张图就不是象棋盘了。
   */
  private drawGrid(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
    const { originX, originY, step } = layout;
    const right = originX + (FILES - 1) * step;
    const bottom = originY + (RANKS - 1) * step;
    const river = riverBand(layout);

    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let row = 0; row < RANKS; row += 1) {
      // 加 0.5 让 1px 线落在像素中心，否则会被抗锯齿摊成 2px 灰线
      const y = Math.round(originY + row * step) + 0.5;
      ctx.moveTo(originX, y);
      ctx.lineTo(right, y);
    }

    for (let col = 0; col < FILES; col += 1) {
      const x = Math.round(originX + col * step) + 0.5;
      if (isEdgeFile(col)) {
        ctx.moveTo(x, originY);
        ctx.lineTo(x, bottom);
      } else {
        ctx.moveTo(x, originY);
        ctx.lineTo(x, river.top);
        ctx.moveTo(x, river.bottom);
        ctx.lineTo(x, bottom);
      }
    }
    ctx.stroke();

    // 外围再描一圈，传统棋盘的双线边框
    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = 2;
    const pad = step * 0.16;
    ctx.strokeRect(
      originX - pad,
      originY - pad,
      right - originX + pad * 2,
      bottom - originY + pad * 2,
    );
  }

  private drawPalaces(
    ctx: CanvasRenderingContext2D,
    layout: BoardLayout,
  ): void {
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [from, to] of palaceDiagonals()) {
      const a = pointToPixel(layout, from);
      const b = pointToPixel(layout, to);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  private drawRiver(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
    const { originX, step } = layout;
    const river = riverBand(layout);
    const mid = (river.top + river.bottom) / 2;

    ctx.save();
    ctx.fillStyle = PALETTE.river;
    ctx.font = `${Math.round(step * 0.5)}px ${PIECE_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("楚 河", originX + step * 2, mid);
    ctx.fillText("漢 界", originX + step * 6, mid);
    ctx.restore();
  }

  private drawPiece(
    ctx: CanvasRenderingContext2D,
    layout: BoardLayout,
    index: number,
    piece: Piece,
  ): void {
    const { x, y } = pointToPixel(layout, index);
    const r = layout.radius;
    const ink = piece.side === "red" ? PALETTE.red : PALETTE.black;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = r * 0.35;
    ctx.shadowOffsetY = r * 0.14;

    // 高光偏左上，模拟单一光源。所有棋子方向一致，不然看着像贴纸
    const gradient = ctx.createRadialGradient(
      x - r * 0.35,
      y - r * 0.35,
      r * 0.1,
      x,
      y,
      r,
    );
    gradient.addColorStop(0, "#fffaf0");
    gradient.addColorStop(1, PALETTE.disc);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = PALETTE.discEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    // 内圈用本方墨色。红子再多一圈：颜色之外还有一个形状差异，
    // 灰度下也分得出敌我（UI-DESIGN.md §9）
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    if (piece.side === "red") {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.68, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.fillStyle = ink;
    ctx.font = `${Math.round(r * 1.05)}px ${PIECE_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyphOf(piece), x, y);
    ctx.restore();
  }

  /** 最后一手：起点画空心方框，终点画实心角标。看不出对方走了哪一步就没法接着下。 */
  private drawLastMove(
    ctx: CanvasRenderingContext2D,
    view: XiangqiView,
    layout: BoardLayout,
  ): void {
    if (!view.lastMove) return;
    ctx.strokeStyle = PALETTE.last;
    ctx.lineWidth = 2;
    for (const at of [view.lastMove.from, view.lastMove.to]) {
      const { x, y } = pointToPixel(layout, at);
      const s = layout.radius * 1.1;
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    }
  }

  /** 可走点：空点画小圆点，可吃的敌子画一圈粗环。 */
  private drawTargets(
    ctx: CanvasRenderingContext2D,
    view: XiangqiView,
    layout: BoardLayout,
  ): void {
    for (const at of targetsFrom(view, this.selected)) {
      const { x, y } = pointToPixel(layout, at);
      if (view.board[at]) {
        ctx.strokeStyle = PALETTE.target;
        ctx.lineWidth = Math.max(2, layout.radius * 0.16);
        ctx.beginPath();
        ctx.arc(x, y, layout.radius * 1.12, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = PALETTE.target;
        ctx.beginPath();
        ctx.arc(x, y, layout.radius * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawSelection(
    ctx: CanvasRenderingContext2D,
    layout: BoardLayout,
  ): void {
    if (this.selected === null) return;
    const { x, y } = pointToPixel(layout, this.selected);
    ctx.strokeStyle = PALETTE.select;
    ctx.lineWidth = Math.max(2, layout.radius * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, layout.radius * 1.16, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 将军：被将的将/帅套一圈醒目的粗环。
   *
   * 这是象棋里唯一一个「没看见就直接输」的状态，画在最上层，不被任何标记盖住。
   * 界面另有文字提示（见 XiangqiGame.tsx），颜色不作为唯一载体。
   */
  private drawCheck(
    ctx: CanvasRenderingContext2D,
    view: XiangqiView,
    layout: BoardLayout,
  ): void {
    if (view.checkSquare === null) return;
    const { x, y } = pointToPixel(layout, view.checkSquare);
    ctx.strokeStyle = PALETTE.check;
    ctx.lineWidth = Math.max(3, layout.radius * 0.26);
    ctx.beginPath();
    ctx.arc(x, y, layout.radius * 1.24, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 悬停提示。
   *
   * 只在「这一下点了会有反应」的格子上画：己方可选的子、当前选中子的可走点。
   * 在死格子上也给反馈等于暗示能点，用户会以为是程序卡了。
   */
  private drawHover(
    ctx: CanvasRenderingContext2D,
    state: GameState<XiangqiView>,
    layout: BoardLayout,
  ): void {
    const at = this.hover;
    if (at === null || !canAct(state)) return;
    const action = resolveTap(
      state.board,
      this.mySide(state),
      this.selected,
      at,
    );
    if (action.kind !== "select" && action.kind !== "move") return;

    const { x, y } = pointToPixel(layout, at);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = PALETTE.select;
    ctx.lineWidth = Math.max(2, layout.radius * 0.14);
    ctx.beginPath();
    ctx.arc(x, y, layout.radius * 1.04, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private onClick = (event: MouseEvent): void => {
    const state = this.latest;
    const at = this.pointAt(event);
    if (at === null || !state || !canAct(state)) return;

    const action = resolveTap(
      state.board,
      this.mySide(state),
      this.selected,
      at,
    );
    switch (action.kind) {
      case "none":
        return;
      case "select":
        this.selected = action.at;
        break;
      case "clear":
        this.selected = null;
        break;
      case "move":
        this.selected = null;
        if (this.handler) {
          this.handler({
            matchId: state.matchId,
            basedOnVersion: state.version,
            type: XIANGQI_INTENT.move,
            payload: action.move,
          });
        }
        break;
    }
    if (this.layout) this.draw(state, this.layout);
  };

  private onMouseMove = (event: MouseEvent): void => {
    const at = this.pointAt(event);
    if (at === this.hover) return;
    this.hover = at;
    if (this.latest && this.layout) this.draw(this.latest, this.layout);
  };

  private onMouseLeave = (): void => {
    if (this.hover === null) return;
    this.hover = null;
    if (this.latest && this.layout) this.draw(this.latest, this.layout);
  };

  private mySide(state: GameState<XiangqiView>): Side | null {
    return state.mySeat === null ? null : sideOfSeat(state.mySeat);
  }

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
