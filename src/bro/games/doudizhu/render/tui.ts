/**
 * TUI 渲染器（暗色模式）。
 *
 * 全键盘可操作是硬要求（UI-DESIGN.md §6.3），这里索性只做键盘。
 *
 * **手牌不是一整块 `<pre>`，而是一行固定宽度的格子。** 这是这个文件唯一
 * 值得强调的实现选择：`♠♥♦♣` 在 Unicode 里属 East Asian Width Ambiguous，
 * `小王` 是全宽，同一串牌在不同字体、不同终端下宽度不一样。用空格补齐列宽
 * 只在开发者自己那台机器上是齐的，换台机器光标就对不上牌了。把每张牌塞进
 * 一个宽度写死的 CSS 格子（`.bro-doudizhu-tui__card`），列宽就与字符宽度
 * 无关——这是 src/bro/lobby/catalog.ts 里记下的同一个教训。
 *
 * 光标与选中都是渲染器的本地状态：不进快照，也不因对手出牌而重置。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { Bid, CardId } from "../logic";
import { canPass } from "../logic";
import type { DoudizhuAction, DoudizhuView } from "../view";
import { seatOfSlot, toIntent } from "../view";
import type { SelectionSource } from "./selection";
import { cardsByIds, checkSelection, patternToBeat } from "./selection";
import {
  availableBids,
  cardLabel,
  renderBottomLine,
  renderSeatLine,
  renderStatusBar,
  renderTrickLine,
} from "./tui-text";

export interface TuiDoudizhuRendererOptions {
  readonly onSelectionChange?: (ids: readonly CardId[]) => void;
}

export class TuiDoudizhuRenderer
  implements GameRenderer<DoudizhuView>, SelectionSource
{
  readonly mode: RenderMode = "tui";

  private root: HTMLElement | null = null;
  private seatsEl: HTMLPreElement | null = null;
  private tableEl: HTMLPreElement | null = null;
  private handEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<DoudizhuView> | null = null;
  /** 光标落在手牌的第几张。 */
  private cursor = 0;
  private selected = new Set<CardId>();
  private selectionHandler: ((ids: readonly CardId[]) => void) | null;

  constructor(options: TuiDoudizhuRendererOptions = {}) {
    this.selectionHandler = options.onSelectionChange ?? null;
  }

  mount(container: HTMLElement): void {
    const root = document.createElement("div");
    // .tui 是共享的 TUI 外观层（themes/tui/tui.css），.bro-doudizhu-tui 只加本游戏特有的部分
    root.className = "tui bro-doudizhu-tui";
    // 让根节点可聚焦，否则收不到键盘事件
    root.tabIndex = 0;

    const seats = document.createElement("pre");
    seats.className = "tui-grid bro-doudizhu-tui__seats";
    const table = document.createElement("pre");
    table.className = "tui-grid bro-doudizhu-tui__table";
    const hand = document.createElement("div");
    hand.className = "bro-doudizhu-tui__hand";
    const status = document.createElement("div");
    status.className = "bro-doudizhu-tui__status";

    root.append(seats, table, hand, status);
    container.append(root);
    root.addEventListener("keydown", this.onKeyDown);

    this.root = root;
    this.seatsEl = seats;
    this.tableEl = table;
    this.handEl = hand;
    this.statusEl = status;
    root.focus();
  }

  render(state: GameState<DoudizhuView>): void {
    const { seatsEl, tableEl, handEl, statusEl } = this;
    if (!seatsEl || !tableEl || !handEl || !statusEl) return;

    this.latest = state;
    const view = state.board;
    this.pruneSelection(view);
    // 出牌后手牌变短，光标可能落在数组外
    this.cursor = Math.max(0, Math.min(this.cursor, view.hand.length - 1));

    const anchor = state.mySeat;
    seatsEl.textContent = [
      renderSeatLine(
        view,
        seatOfSlot("left", anchor),
        anchor,
        state.activeSeat,
      ),
      renderSeatLine(
        view,
        seatOfSlot("right", anchor),
        anchor,
        state.activeSeat,
      ),
    ].join("\n");

    tableEl.textContent = [
      renderBottomLine(view),
      renderTrickLine(view, anchor),
      renderSeatLine(
        view,
        seatOfSlot("self", anchor),
        anchor,
        state.activeSeat,
      ),
    ].join("\n");

    // 一张牌一个格子。用 textContent 逐个写入，牌面字符不会被当成标签解析
    handEl.replaceChildren(
      ...view.hand.map((card, index) => {
        const cell = document.createElement("span");
        const classes = ["bro-doudizhu-tui__card"];
        if (this.selected.has(card.id)) classes.push("is-selected");
        if (index === this.cursor) classes.push("is-cursor");
        cell.className = classes.join(" ");
        cell.textContent = cardLabel(card);
        return cell;
      }),
    );

    statusEl.textContent = renderStatusBar(
      view,
      canAct(state),
      this.selection(),
    );
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.root?.removeEventListener("keydown", this.onKeyDown);
    this.root?.remove();
    this.root = null;
    this.seatsEl = null;
    this.tableEl = null;
    this.handEl = null;
    this.statusEl = null;
    this.handler = null;
    this.latest = null;
  }

  /* ---------------- 选牌 ---------------- */

  onSelectionChange(handler: (ids: readonly CardId[]) => void): void {
    this.selectionHandler = handler;
  }

  selection(): readonly CardId[] {
    const hand = this.latest?.board.hand ?? [];
    return hand.filter((card) => this.selected.has(card.id)).map((c) => c.id);
  }

  toggleSelection(id: CardId): void {
    const state = this.latest;
    if (!state?.board.hand.some((card) => card.id === id)) return;
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.selectionHandler?.(this.selection());
    this.render(state);
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.selectionHandler?.(this.selection());
    if (this.latest) this.render(this.latest);
  }

  /** 丢掉已经出掉的牌的选中项，否则选中张数与实际选中的牌会对不上。 */
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
    if (changed) this.selectionHandler?.(this.selection());
  }

  /* ---------------- 键盘 ---------------- */

  private onKeyDown = (event: KeyboardEvent): void => {
    const state = this.latest;
    if (!state) return;
    const view = state.board;

    if (view.stage === "bidding") {
      this.onBiddingKey(event, state);
      return;
    }
    if (view.stage !== "playing") return;

    switch (event.key) {
      case "h":
      case "ArrowLeft":
        return this.moveCursor(event, -1);
      case "l":
      case "ArrowRight":
        return this.moveCursor(event, 1);
      case " ":
        return this.toggleAtCursor(event);
      case "Enter":
        event.preventDefault();
        return this.play(state);
      case "p":
        event.preventDefault();
        return this.pass(state);
      case "Escape":
        event.preventDefault();
        this.clearSelection();
        return;
      default:
        return;
    }
  };

  private onBiddingKey(
    event: KeyboardEvent,
    state: GameState<DoudizhuView>,
  ): void {
    // 必须先卡住字符形状再转数字。`Number(" ")` 是 0，直接转的话按空格会
    // 变成「不叫」——玩家在出牌阶段习惯用空格选牌，叫分阶段一按就白送地主
    if (!/^[0-3]$/.test(event.key)) return;
    const bid = Number(event.key) as Bid;
    // 只认状态栏上列出来的那几个键。状态栏说能按 2，按下去就必须真的叫 2；
    // 反过来，没列出来的键按了不能有反应（UI-DESIGN.md §6.3）
    if (!availableBids(state.board).includes(bid)) return;
    event.preventDefault();
    this.emit(state, { type: "bid", bid });
  }

  private moveCursor(event: KeyboardEvent, delta: number): void {
    const state = this.latest;
    if (!state) return;
    const count = state.board.hand.length;
    if (count === 0) return;
    event.preventDefault();
    // 到头就停，不回绕。回绕在一排 17 张牌上极易误操作——按到头再按一下
    // 就跳到另一端，玩家以为光标没动，实际选错了牌
    this.cursor = Math.max(0, Math.min(count - 1, this.cursor + delta));
    this.render(state);
  }

  private toggleAtCursor(event: KeyboardEvent): void {
    const state = this.latest;
    const card = state?.board.hand[this.cursor];
    if (!state || !card) return;
    event.preventDefault();
    this.toggleSelection(card.id);
  }

  private play(state: GameState<DoudizhuView>): void {
    const ids = this.selection();
    const cards = cardsByIds(state.board.hand, ids);
    // 出不去的牌不上报。这是体验优化不是规则判定——服务端仍会独立裁定
    if (!checkSelection(cards, patternToBeat(state.board)).ok) return;
    this.emit(state, { type: "play", cardIds: ids });
  }

  private pass(state: GameState<DoudizhuView>): void {
    // 自己领出的一轮不能过。状态栏此时也不会列出 p，两处用同一个判断
    if (!canPass(patternToBeat(state.board))) return;
    this.emit(state, { type: "pass" });
  }

  private emit(state: GameState<DoudizhuView>, action: DoudizhuAction): void {
    if (!this.handler || !canAct(state)) return;
    this.handler(toIntent(action, state.matchId, state.version));
  }
}
