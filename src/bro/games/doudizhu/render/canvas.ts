/**
 * Canvas 渲染器（亮色模式）。
 *
 * 牌桌区不套玻璃效果——`backdrop-filter` 在每帧重绘的区域上会把 GPU 吃光，
 * 帧率优先于观感（UI-DESIGN.md §5，由 tokens 测试里的护栏强制）。质感靠牌
 * 面的圆角、描边与投影做，那些都画在画布里，不走合成层。
 *
 * **花色一律画出符号，不靠颜色区分**（UI-DESIGN.md §9）。红桃和方块用红色
 * 只是习惯，红绿色觉障碍者看不出红黑差别；符号在，颜色掉了也还认得出。
 *
 * 渲染器不含任何规则判断。它只做两件事：把视图画出来，把「玩家点了哪张牌」
 * 变成选中状态。能不能出、出了算不算，全由服务端裁定（core/types.ts 约束 2）。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { Card, CardId } from "../logic";
import { RANK_JOKER_BIG, formatCards } from "../logic";
import type { DoudizhuView } from "../view";
import { bidOfSeat, seatOfSlot, toIntent } from "../view";
import type { HandLayout, Rect, TableLayout } from "./layout";
import {
  cardAtPixel,
  cardRect,
  computeHandLayout,
  computeTableLayout,
} from "./layout";
import type { SelectionSource } from "./selection";
import { cardsByIds, checkSelection, patternToBeat } from "./selection";
// 花色字符与 TUI 共用一份。两处各写一份，迟早会出现「亮色是 ♠ 暗色是 ♤」
import { SUIT_GLYPH } from "./tui-text";

/** 亮色：陶瓷白会所；暗色：Coding 夜场，但不牺牲牌桌的图形化信息。 */
const LIGHT_PALETTE = {
  felt: "#efe9dd",
  feltEdge: "#d7cbb8",
  rail: "#5a4931",
  railInner: "#b79656",
  cardFace: "#fffdfb",
  cardEdge: "#b9b1a0",
  cardBack: "#8b7c5e",
  suitRed: "#b3453a",
  suitBlack: "#1c1917",
  text: "#1c1917",
  textMuted: "#8b8378",
  accent: "#c9a227",
  landlord: "#b8862b",
} as const;

const DARK_PALETTE = {
  felt: "#071c12",
  feltEdge: "#0f5d35",
  rail: "#020907",
  railInner: "#4bbd73",
  cardFace: "#f7f3e8",
  cardEdge: "#bdc5ad",
  cardBack: "#123b2a",
  suitRed: "#b83e38",
  suitBlack: "#17231b",
  text: "#d8f3df",
  textMuted: "#8bb99a",
  accent: "#d4a44a",
  landlord: "#f0c568",
} as const;

type TablePalette = { readonly [K in keyof typeof LIGHT_PALETTE]: string };

/** 对家最多画几张背面。牌再多也铺不下，超出的部分只在文字里给张数。 */
const MAX_BACKS = 10;

const FONT_SANS =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export interface CanvasDoudizhuRendererOptions {
  /** 选牌变化时的回调。对局页据此更新按钮与提示。 */
  readonly onSelectionChange?: (ids: readonly CardId[]) => void;
  /** 暗色仍使用完整 Canvas 牌桌，只替换夜场配色。 */
  readonly dark?: boolean;
}

export class CanvasDoudizhuRenderer
  implements GameRenderer<DoudizhuView>, SelectionSource
{
  readonly mode: RenderMode = "canvas";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<DoudizhuView> | null = null;
  private table: TableLayout | null = null;
  /** 本家手牌的排布。命中测试要用，所以得跟绘制用的是同一份。 */
  private handLayout: HandLayout | null = null;
  /** 选中的牌。纯本地视觉状态，不进快照。 */
  private selected = new Set<CardId>();
  /** 悬停的牌下标。 */
  private hover: number | null = null;
  private observer: ResizeObserver | null = null;
  private selectionHandler: ((ids: readonly CardId[]) => void) | null;
  private readonly palette: TablePalette;

  constructor(options: CanvasDoudizhuRendererOptions = {}) {
    this.selectionHandler = options.onSelectionChange ?? null;
    this.palette = options.dark ? DARK_PALETTE : LIGHT_PALETTE;
  }

  mount(container: HTMLElement): void {
    const canvas = document.createElement("canvas");
    canvas.className = "bro-doudizhu-canvas";
    container.append(canvas);

    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);

    // 容器尺寸变化要重算布局，否则拉窗口后牌会糊或错位
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(state: GameState<DoudizhuView>): void {
    this.latest = state;
    this.pruneSelection(state.board);
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
    this.table = null;
    this.handLayout = null;
  }

  /* ---------------- 选牌 ---------------- */

  onSelectionChange(handler: (ids: readonly CardId[]) => void): void {
    this.selectionHandler = handler;
  }

  selection(): readonly CardId[] {
    const hand = this.latest?.board.hand ?? [];
    // 按手牌顺序回报，不按点击顺序：同一手牌只能有一种写法，否则日志和
    // 断言里全是「同一手牌的两种排列」这种纯噪音
    return hand.filter((card) => this.selected.has(card.id)).map((c) => c.id);
  }

  toggleSelection(id: CardId): void {
    if (!this.latest?.board.hand.some((card) => card.id === id)) return;
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.notifySelection();
    this.redraw();
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.notifySelection();
    this.redraw();
  }

  /**
   * 丢掉已经不在手上的选中项。
   *
   * 出牌成功后手牌变短，旧的选中 id 会指向已经打出去的牌。不清理的话，
   * 「选中张数」和实际选中的牌会对不上，出牌按钮亮着却永远出不去。
   */
  private pruneSelection(view: DoudizhuView): void {
    if (this.selected.size === 0) return;
    const alive = new Set(view.hand.map((card) => card.id));
    let changed = false;
    for (const id of [...this.selected]) {
      if (!alive.has(id)) {
        this.selected.delete(id);
        changed = true;
      }
    }
    if (changed) this.notifySelection();
  }

  private notifySelection(): void {
    this.selectionHandler?.(this.selection());
  }

  /* ---------------- 绘制 ---------------- */

  /** 按容器实际尺寸与设备像素比重置画布，然后重绘。 */
  private resize(): void {
    const canvas = this.canvas;
    const state = this.latest;
    if (!canvas || !state) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 0;
    const height = parent?.clientHeight ?? 0;
    if (width === 0 || height === 0) return;

    // 按 DPR 放大位图再用 CSS 缩回去，否则高分屏上牌面文字会发虚
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    this.table = computeTableLayout(width, height);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(state, this.table);
  }

  private redraw(): void {
    if (this.latest && this.table) this.draw(this.latest, this.table);
  }

  private draw(state: GameState<DoudizhuView>, table: TableLayout): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const palette = this.palette;
    ctx.clearRect(0, 0, table.width, table.height);
    ctx.fillStyle = palette.rail;
    ctx.fillRect(0, 0, table.width, table.height);

    // 双层桌沿把平面 Canvas 压出实体牌桌的厚度；不依赖滤镜，重绘也稳定。
    const inset = Math.max(7, Math.min(table.width, table.height) * 0.026);
    ctx.fillStyle = palette.railInner;
    roundedPath(
      ctx,
      {
        x: inset,
        y: inset,
        width: table.width - inset * 2,
        height: table.height - inset * 2,
      },
      inset * 1.15,
    );
    ctx.fill();
    const feltInset = inset * 1.8;
    ctx.fillStyle = palette.felt;
    roundedPath(
      ctx,
      {
        x: feltInset,
        y: feltInset,
        width: table.width - feltInset * 2,
        height: table.height - feltInset * 2,
      },
      inset,
    );
    ctx.fill();
    ctx.strokeStyle = palette.feltEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    this.drawHud(ctx, table, state);

    // 座位映射交给 view.ts：本家在下、上家左上、下家右上
    this.drawSeat(ctx, table.left, state, seatOfSlot("left", state.mySeat));
    this.drawSeat(ctx, table.right, state, seatOfSlot("right", state.mySeat));
    this.drawMiddle(ctx, table.trick, state);
    this.drawHand(ctx, table.hand, state);
  }

  /** 一家对手：几张背面 + 一行状态文字。手牌内容视图里根本没有，画不出来。 */
  private drawSeat(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    state: GameState<DoudizhuView>,
    seat: number,
  ): void {
    const view = state.board;
    const info = view.seats[seat];
    const backs = Math.min(info.cardsLeft, MAX_BACKS);
    const layout = computeHandLayout(backs, {
      x: rect.x + rect.width * 0.1,
      y: rect.y + rect.height * 0.12,
      width: rect.width * 0.8,
      height: rect.height * 0.5,
    });
    for (let i = 0; i < backs; i += 1) {
      this.drawCardBack(ctx, cardRect(layout, i));
    }

    const role = info.isLandlord
      ? "地主"
      : view.landlord === null
        ? ""
        : "农民";
    const active = state.activeSeat === seat;
    const head = [role, `${info.cardsLeft} 张`].filter(Boolean).join(" · ");
    this.text(ctx, head, rect.x + rect.width / 2, rect.y + rect.height * 0.74, {
      size: 14,
      color: info.isLandlord ? this.palette.landlord : this.palette.text,
      weight: active ? "700" : "500",
    });

    const status = seatStatus(view, seat);
    if (status) {
      this.text(
        ctx,
        status,
        rect.x + rect.width / 2,
        rect.y + rect.height * 0.92,
        { size: 12, color: this.palette.textMuted },
      );
    }
  }

  /** 桌面中央：底牌 + 待压的牌。 */
  private drawMiddle(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    state: GameState<DoudizhuView>,
  ): void {
    const view = state.board;

    // 底牌带：亮牌前画背面。视图里 cards 是 null，想画正面也没有数据
    const bottomHeight = rect.height * 0.34;
    const bottom = computeHandLayout(view.bottom.count, {
      x: rect.x + rect.width / 2 - bottomHeight,
      y: rect.y,
      width: bottomHeight * 2,
      height: bottomHeight,
    });
    for (let i = 0; i < view.bottom.count; i += 1) {
      const at = cardRect(bottom, i);
      const card = view.bottom.cards?.[i];
      if (card) this.drawCardFace(ctx, at, card, false);
      else this.drawCardBack(ctx, at);
    }

    const centerY = rect.y + rect.height * 0.72;
    if (view.toBeat !== null) {
      const cards = view.toBeat.cards;
      const trick = computeHandLayout(cards.length, {
        x: rect.x,
        y: rect.y + bottomHeight,
        width: rect.width,
        height: rect.height - bottomHeight,
      });
      for (let i = 0; i < cards.length; i += 1) {
        this.drawCardFace(ctx, cardRect(trick, i), cards[i], false);
      }
      return;
    }

    const message =
      view.stage === "bidding"
        ? "叫地主"
        : view.stage === "over"
          ? "本局结束"
          : "新一轮 · 自由出牌";
    this.text(ctx, message, rect.x + rect.width / 2, centerY, {
      size: 15,
      color: this.palette.textMuted,
    });
  }

  /** 本家手牌。只有这一排能看见牌面——服务端也只发了这一排。 */
  private drawHand(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    state: GameState<DoudizhuView>,
  ): void {
    const hand = state.board.hand;
    const layout = computeHandLayout(hand.length, {
      x: rect.x + rect.width * 0.05,
      y: rect.y,
      width: rect.width * 0.9,
      height: rect.height * 0.9,
    });
    this.handLayout = layout;

    for (let i = 0; i < hand.length; i += 1) {
      const selected = this.selected.has(hand[i].id);
      this.drawCardFace(
        ctx,
        cardRect(layout, i, selected),
        hand[i],
        selected,
        i === this.hover,
      );
    }
  }

  private drawCardFace(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    card: Card,
    selected: boolean,
    hovered = false,
  ): void {
    const radius = Math.min(rect.width, rect.height) * 0.12;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = rect.width * 0.18;
    ctx.shadowOffsetY = rect.width * 0.05;
    roundedPath(ctx, rect, radius);
    ctx.fillStyle = this.palette.cardFace;
    ctx.fill();
    ctx.restore();

    roundedPath(ctx, rect, radius);
    ctx.strokeStyle = selected
      ? this.palette.accent
      : hovered
        ? this.palette.landlord
        : this.palette.cardEdge;
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.stroke();

    const face = faceText(card);
    const color = isRedSuit(card)
      ? this.palette.suitRed
      : this.palette.suitBlack;
    const x = rect.x + rect.width * 0.5;

    this.text(ctx, face.rank, x, rect.y + rect.height * 0.24, {
      size: rect.width * 0.46,
      color,
      weight: "700",
    });
    // 花色符号必须画出来：颜色不能是唯一区分手段（UI-DESIGN.md §9）
    this.text(ctx, face.suit, x, rect.y + rect.height * 0.62, {
      size: rect.width * 0.42,
      color,
    });
  }

  private drawCardBack(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const radius = Math.min(rect.width, rect.height) * 0.12;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.24)";
    ctx.shadowBlur = rect.width * 0.12;
    ctx.shadowOffsetY = rect.width * 0.04;
    roundedPath(ctx, rect, radius);
    ctx.fillStyle = this.palette.cardBack;
    ctx.fill();
    ctx.restore();
    roundedPath(ctx, rect, radius);
    ctx.strokeStyle = this.palette.cardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    const inset = Math.max(2, rect.width * 0.12);
    const inner = {
      x: rect.x + inset,
      y: rect.y + inset,
      width: rect.width - inset * 2,
      height: rect.height - inset * 2,
    };
    roundedPath(ctx, inner, Math.max(2, radius * 0.55));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
    ctx.lineWidth = Math.max(1, rect.width * 0.025);
    ctx.stroke();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const diamond = rect.width * 0.22;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - diamond);
    ctx.lineTo(centerX + diamond, centerY);
    ctx.lineTo(centerX, centerY + diamond);
    ctx.lineTo(centerX - diamond, centerY);
    ctx.closePath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.stroke();
  }

  private text(
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    opts: { size: number; color: string; weight?: string },
  ): void {
    ctx.font = `${opts.weight ?? "400"} ${Math.max(1, opts.size)}px ${FONT_SANS}`;
    ctx.fillStyle = opts.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value, x, y);
  }

  /** 顶部 HUD：把轮次、倍数和当前行动做成不遮挡出牌区的桌面仪表。 */
  private drawHud(
    ctx: CanvasRenderingContext2D,
    table: TableLayout,
    state: GameState<DoudizhuView>,
  ): void {
    const { board } = state;
    const label = board.result
      ? "牌局结算"
      : state.activeSeat === state.mySeat
        ? "YOUR TURN"
        : "WAITING";
    const detail = `×${board.multiplier ?? 1}  ${board.bombs + (board.rocket ? 1 : 0) ? `炸 ${board.bombs + (board.rocket ? 1 : 0)}` : "常规局"}`;
    const width = Math.min(190, table.width * 0.3);
    const height = 34;
    const x = (table.width - width) / 2;
    const y = 16;
    ctx.fillStyle = this.palette.rail;
    roundedPath(ctx, { x, y, width, height }, 17);
    ctx.fill();
    ctx.strokeStyle = this.palette.railInner;
    ctx.lineWidth = 1;
    ctx.stroke();
    this.text(ctx, label, x + width / 2, y + 12, {
      size: 10,
      color:
        state.activeSeat === state.mySeat
          ? this.palette.accent
          : this.palette.textMuted,
      weight: "700",
    });
    this.text(ctx, detail, x + width / 2, y + 24, {
      size: 9,
      color: this.palette.text,
      weight: "500",
    });
  }

  /* ---------------- 输入 ---------------- */

  private onClick = (event: MouseEvent): void => {
    const state = this.latest;
    const layout = this.handLayout;
    if (!state || !layout) return;
    // 叫分阶段手牌不可选：那时候选牌毫无意义，点中了反而让人以为能出
    if (state.board.stage !== "playing") return;

    const index = this.cardAt(event);
    if (index === null) return;

    // 双击 = 把当前选中的牌打出去。键鼠玩家最顺手的一下，也是这个渲染器
    // 唯一会发意图的地方；单击只改本地选中状态，不惊动服务端
    if (event.detail >= 2) {
      this.emitPlay(state);
      return;
    }

    this.toggleSelection(state.board.hand[index].id);
  };

  private emitPlay(state: GameState<DoudizhuView>): void {
    if (!this.handler || !canAct(state)) return;
    const ids = this.selection();
    const cards = cardsByIds(state.board.hand, ids);
    // 出不去的牌不往上报。这是体验优化不是规则判定——真正的裁定在服务端，
    // 这里放过去了服务端一样会拒
    if (!checkSelection(cards, patternToBeat(state.board)).ok) return;
    this.handler(
      toIntent({ type: "play", cardIds: ids }, state.matchId, state.version),
    );
  }

  private onMouseMove = (event: MouseEvent): void => {
    const index = this.cardAt(event);
    if (index === this.hover) return;
    this.hover = index;
    this.redraw();
  };

  private onMouseLeave = (): void => {
    if (this.hover === null) return;
    this.hover = null;
    this.redraw();
  };

  private cardAt(event: MouseEvent): number | null {
    const layout = this.handLayout;
    const hand = this.latest?.board.hand;
    if (!this.canvas || !layout || !hand) return null;
    const rect = this.canvas.getBoundingClientRect();
    return cardAtPixel(
      layout,
      event.clientX - rect.left,
      event.clientY - rect.top,
      // 抬起来的牌要按抬起后的位置命中，否则选中的牌点不掉
      (i) => this.selected.has(hand[i].id),
    );
  }
}

/** 一家在牌桌上的一句话状态。叫分与出牌是两套信息，不混在一起说。 */
function seatStatus(view: DoudizhuView, seat: number): string {
  if (view.stage === "bidding") {
    const bid = bidOfSeat(view, seat);
    if (bid === null) return "";
    return bid === 0 ? "不叫" : `叫 ${bid} 分`;
  }
  const action = view.seats[seat].lastAction;
  if (action === null) return "";
  return action.kind === "pass" ? "不要" : formatCards(action.cards);
}

/** 牌面上的两段字符：点数与花色。王没有花色，用「大/小 + 王」。 */
function faceText(card: Card): { rank: string; suit: string } {
  if (card.suit === null) {
    return { rank: "王", suit: card.rank === RANK_JOKER_BIG ? "大" : "小" };
  }
  return { rank: formatCards([card]), suit: SUIT_GLYPH[card.suit] };
}

function isRedSuit(card: Card): boolean {
  return card.suit === "H" || card.suit === "D";
}

/** 圆角矩形路径。`roundRect` 在部分环境里还没有，自己连一条更稳。 */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const { x, y, width: w, height: h } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
