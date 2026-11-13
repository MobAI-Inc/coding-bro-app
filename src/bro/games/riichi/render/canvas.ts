/**
 * 立直麻将：Canvas 渲染器（亮色模式）。
 *
 * 与围棋、台球同构：按 DPR 放大位图、ResizeObserver 重算布局、点击转意图。
 *
 * 牌面用 Canvas 文字画而不是贴图：34 种牌 × 一套贴图是几百 KB 的资源，而
 * 短记法（`3m` / `东`）在任何缩放下都清晰，也不用管资源加载时序 —— 首帧
 * 贴图没到位的话，牌桌会白闪一下。
 *
 * 台面区不套玻璃效果：`backdrop-filter` 在每帧重绘的区域上会把 GPU 吃光
 * （UI-DESIGN.md §5 的性能护栏）。质感靠牌面的圆角、描边与投影做，那些画在
 * 画布里，不走合成层。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import { isRedFive } from "../logic";
import type { Tile136 } from "../logic";
import type { RiichiView } from "../view";
import { RIICHI_INTENT } from "../view";
import type { Rect, TableLayout } from "./layout";
import {
  computeTableLayout,
  handTileRect,
  hitTestHand,
  labelOf,
  pondTileRect,
  tileLabel,
} from "./layout";


const PALETTE = {
  table: "#e7ded0",
  tableInner: "#dcd0bd",
  tileFace: "#fdfcf9",
  tileEdge: "#c3b8a4",
  tileText: "#2c2620",
  redFive: "#c0392b",
  pondFace: "#f2ede3",
  riichiMark: "#c0392b",
  hint: "#7a6d58",
  selected: "#3d7a63",
  text: "#2c2620",
} as const;

export class CanvasRiichiRenderer implements GameRenderer<RiichiView> {
  readonly mode: RenderMode = "canvas";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<RiichiView> | null = null;
  private layout: TableLayout | null = null;
  /** 悬停的手牌下标。纯本地视觉状态，不进快照。 */
  private hover: number | null = null;
  private observer: ResizeObserver | null = null;

  mount(container: HTMLElement): void {
    const canvas = document.createElement("canvas");
    canvas.className = "bro-riichi-canvas";
    container.append(canvas);

    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(state: GameState<RiichiView>): void {
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

  private resize(): void {
    const canvas = this.canvas;
    const state = this.latest;
    if (!canvas || !state) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 0;
    const height = parent?.clientHeight ?? 0;
    if (width === 0 || height === 0) return;

    const layout = computeTableLayout(width, height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    this.layout = layout;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(state, layout, width, height);
  }

  private draw(
    state: GameState<RiichiView>,
    layout: TableLayout,
    width: number,
    height: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const view = state.board;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = PALETTE.table;
    ctx.fillRect(layout.originX, layout.originY, layout.size, layout.size);

    this.drawCenter(ctx, view, layout);

    // 四家牌河。自己是相对座位 0，对手按 view.opponents 的顺序 1/2/3
    this.drawPond(ctx, view.self.discards, layout, 0);
    view.opponents.forEach((o, i) => {
      this.drawPond(ctx, o.discards, layout, i + 1);
    });

    this.drawHand(ctx, state, layout);
  }

  /** 中央信息区：场风本场、余牌、宝牌、四家点数。 */
  private drawCenter(
    ctx: CanvasRenderingContext2D,
    view: RiichiView,
    layout: TableLayout,
  ): void {
    const cx = layout.originX + layout.size / 2;
    const cy = layout.originY + layout.size / 2;
    const r = layout.size * 0.1;

    ctx.fillStyle = PALETTE.tableInner;
    ctx.beginPath();
    ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.16);
    ctx.fill();

    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(layout.tileW * 0.42)}px system-ui, sans-serif`;
    ctx.fillText(
      `${tileLabel(view.roundWind)}场 ${view.honba}本场`,
      cx,
      cy - r * 0.45,
    );
    ctx.fillText(`余 ${view.wallRemaining}`, cx, cy);
    ctx.fillText(
      `棒 ${view.riichiSticks}  宝 ${view.doraIndicators.map((t) => labelOf(t)).join(" ") || "—"}`,
      cx,
      cy + r * 0.45,
    );
  }

  private drawPond(
    ctx: CanvasRenderingContext2D,
    discards: readonly Tile136[],
    layout: TableLayout,
    relSeat: number,
  ): void {
    discards.forEach((tile, i) => {
      const rect = pondTileRect(layout, relSeat, i);
      this.drawTile(ctx, rect, tile, { face: PALETTE.pondFace });
    });
  }

  private drawHand(
    ctx: CanvasRenderingContext2D,
    state: GameState<RiichiView>,
    layout: TableLayout,
  ): void {
    const view = state.board;
    const hand = view.self.hand;
    const hasDrawn = view.self.drawn !== null;
    const canDiscard = canAct(state);

    hand.forEach((tile, i) => {
      const rect = handTileRect(layout, i, hand.length, hasDrawn);
      const hovered = canDiscard && this.hover === i;
      this.drawTile(
        ctx,
        hovered ? liftRect(rect, layout.tileH * 0.12) : rect,
        tile,
        {
          // 打了能保持听牌的牌标出来。这是提示不是限制 —— 玩家照样能打别的
          outline: view.self.tenpaiDiscards.includes(tile)
            ? PALETTE.selected
            : undefined,
        },
      );
    });
  }

  /** 画一张牌。`outline` 有值时描一圈提示色。 */
  private drawTile(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    tile: Tile136,
    options: { readonly face?: string; readonly outline?: string } = {},
  ): void {
    const radius = Math.max(1, rect.w * 0.12);
    ctx.fillStyle = options.face ?? PALETTE.tileFace;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w * 0.94, rect.h, radius);
    ctx.fill();

    ctx.strokeStyle = options.outline ?? PALETTE.tileEdge;
    ctx.lineWidth = options.outline ? 2 : 1;
    ctx.stroke();

    // 赤 5 用红字。它多算一番，看不出来就等于少算了打点
    ctx.fillStyle = isRedFive(tile) ? PALETTE.redFive : PALETTE.tileText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(rect.h * 0.42)}px system-ui, sans-serif`;
    ctx.fillText(
      labelOf(tile),
      rect.x + (rect.w * 0.94) / 2,
      rect.y + rect.h / 2,
    );
  }

  private onClick = (event: MouseEvent): void => {
    const state = this.latest;
    const layout = this.layout;
    if (!state || !layout || !this.handler || !canAct(state)) return;

    const { x, y } = this.toLocal(event);
    const hand = state.board.self.hand;
    const index = hitTestHand(
      layout,
      x,
      y,
      hand.length,
      state.board.self.drawn !== null,
    );
    if (index === null) return;

    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type: RIICHI_INTENT.discard,
      payload: { tile: hand[index] },
    });
  };

  private onMouseMove = (event: MouseEvent): void => {
    const state = this.latest;
    const layout = this.layout;
    if (!state || !layout) return;
    const { x, y } = this.toLocal(event);
    const next = hitTestHand(
      layout,
      x,
      y,
      state.board.self.hand.length,
      state.board.self.drawn !== null,
    );
    if (next === this.hover) return;
    this.hover = next;
    this.resize();
  };

  private onMouseLeave = (): void => {
    if (this.hover === null) return;
    this.hover = null;
    this.resize();
  };

  private toLocal(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
}

/** 悬停时把牌抬起来一点。抬起是「可点」的通用视觉暗示。 */
function liftRect(rect: Rect, by: number): Rect {
  return { ...rect, y: rect.y - by };
}
