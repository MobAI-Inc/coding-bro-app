/**
 * TUI 渲染器（暗色模式）。
 *
 * 全键盘可操作是硬要求（UI-DESIGN.md §6.3），这里只做键盘。理由与围棋相同：
 * 字符网格里靠像素反推格子，在汉字/半角混排下必然有偏差，与其给一个偶尔点
 * 错格的鼠标，不如不给。象棋更禁不起点错——一步走出去就吃掉了子。
 *
 * 棋盘用 CSS 网格而不是一整块 `<pre>`：`帥車砲` 是全宽汉字，行号是半宽数字，
 * 靠字符宽度对齐会错位（见 tui-text.ts 与 lobby/catalog.ts 的注释）。每格一个
 * `<span>`，宽度由 CSS 保证。
 *
 * 光标、选中点、认输待确认都是渲染器的本地状态，不进服务端快照——它们不该
 * 因为对手走了一步就被重置。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { Side } from "../logic";
import type { XiangqiView } from "../view";
import {
  XIANGQI_INTENT,
  awaitingMyReply,
  canRequestUndo,
  sideOfSeat,
} from "../view";
import { defaultCursor, resolveTap, targetsFrom } from "./selection";
import type { TuiCell } from "./tui-text";
import { renderBoardCells, renderStatusBar } from "./tui-text";
import { FILES, RANKS } from "../logic";

const CELL_CLASS = "bro-xiangqi-tui__cell";

export class TuiXiangqiRenderer implements GameRenderer<XiangqiView> {
  readonly mode: RenderMode = "tui";

  private root: HTMLElement | null = null;
  private boardEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<XiangqiView> | null = null;

  private cursor: number | null = null;
  private selected: number | null = null;
  /** 认输已按过一次，等第二次确认。破坏性操作必须二次确认（UI-DESIGN.md §7.1）。 */
  private pendingResign = false;

  mount(container: HTMLElement): void {
    const root = document.createElement("div");
    // .tui 是共享的 TUI 外观层（themes/tui/tui.css），.bro-xiangqi-tui 只加象棋特有的
    root.className = "tui bro-xiangqi-tui";
    // 让根节点可聚焦，否则收不到键盘事件
    root.tabIndex = 0;

    const board = document.createElement("div");
    board.className = "bro-xiangqi-tui__board";
    board.setAttribute("role", "grid");
    board.setAttribute("aria-label", "象棋棋盘");

    const status = document.createElement("div");
    status.className = "tui-statusbar bro-xiangqi-tui__status";

    root.append(board, status);
    container.append(root);
    root.addEventListener("keydown", this.onKeyDown);

    this.root = root;
    this.boardEl = board;
    this.statusEl = status;
    root.focus();
  }

  render(state: GameState<XiangqiView>): void {
    if (!this.boardEl || !this.statusEl) return;
    this.latest = state;

    const view = state.board;
    const mySide = this.mySide(state);
    if (this.cursor === null || this.cursor >= view.board.length) {
      this.cursor = defaultCursor(view, mySide);
    }
    // 选中的子可能已被对手吃掉，或者局面被悔棋退了回去。留着一个悬空的选中点，
    // 下一次 Enter 会照着一张过期的可走点表发意图。
    if (this.selected !== null && view.board[this.selected] == null) {
      this.selected = null;
    }

    const decor = {
      cursor: this.cursor,
      selected: this.selected,
      targets: targetsFrom(view, this.selected),
    };

    this.boardEl.replaceChildren(
      ...renderBoardCells(view, decor).flatMap((row) => row.map(cellSpan)),
    );
    this.statusEl.textContent = renderStatusBar(
      view,
      canAct(state),
      decor,
      this.pendingResign,
      state.mySeat,
    );
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.root?.removeEventListener("keydown", this.onKeyDown);
    this.root?.remove();
    this.root = null;
    this.boardEl = null;
    this.statusEl = null;
    this.handler = null;
    this.latest = null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const state = this.latest;
    const cursor = this.cursor;
    if (!state || cursor === null) return;

    // 待我答复悔棋时，键盘只认 y/n。棋盘此刻是冻住的（服务端会拒绝走子），
    // 放行光标移动与选子只会让人以为还能走，然后收到一串莫名其妙的拒绝。
    if (awaitingMyReply(state.board, state.mySeat)) {
      if (event.key === "y" || event.key === "n") {
        event.preventDefault();
        this.selected = null;
        this.emit(
          state,
          event.key === "y"
            ? XIANGQI_INTENT.undoAccept
            : XIANGQI_INTENT.undoDecline,
          {},
        );
      }
      return;
    }

    // 认输待确认状态只被第二次 r 或 Esc 消费，其余任何按键都取消它。
    // 「按了别的键但认输还悬着」会导致下一次误触直接判负。
    const wasPending = this.pendingResign;
    if (wasPending && event.key !== "r") this.pendingResign = false;

    const moved = this.nextCursor(cursor, event.key);
    if (moved !== null) {
      event.preventDefault();
      this.cursor = moved;
      this.render(state);
      return;
    }

    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        this.tap(state, cursor);
        break;
      case "Escape":
        event.preventDefault();
        this.selected = null;
        this.render(state);
        break;
      case "u":
        event.preventDefault();
        // 只发请求，局面不动。同不同意由对方说了算——匹配制下对手是陌生人，
        // 单方面回退局面就是作弊。
        if (canAct(state) && canRequestUndo(state.board, state.mySeat)) {
          this.selected = null;
          this.emit(state, XIANGQI_INTENT.undoRequest, {});
        }
        break;
      case "r":
        event.preventDefault();
        if (wasPending) {
          this.pendingResign = false;
          this.emit(state, XIANGQI_INTENT.resign, {});
        } else if (this.canSubmit(state)) {
          this.pendingResign = true;
        }
        this.render(state);
        break;
      default:
        if (wasPending) this.render(state);
    }
  };

  /** 方向键与 hjkl。撞到边界就停住，不绕到对侧行。 */
  private nextCursor(cursor: number, key: string): number | null {
    const row = Math.floor(cursor / FILES);
    const col = cursor % FILES;
    switch (key) {
      case "h":
      case "ArrowLeft":
        return col > 0 ? cursor - 1 : null;
      case "l":
      case "ArrowRight":
        return col < FILES - 1 ? cursor + 1 : null;
      case "k":
      case "ArrowUp":
        return row > 0 ? cursor - FILES : null;
      case "j":
      case "ArrowDown":
        return row < RANKS - 1 ? cursor + FILES : null;
      default:
        return null;
    }
  }

  /** 在光标处「点」一下。选起点、换选、走子、取消都走同一个状态机。 */
  private tap(state: GameState<XiangqiView>, at: number): void {
    if (!canAct(state)) return;
    const action = resolveTap(
      state.board,
      this.mySide(state),
      this.selected,
      at,
    );
    switch (action.kind) {
      case "select":
        this.selected = action.at;
        break;
      case "clear":
        this.selected = null;
        break;
      case "move":
        this.selected = null;
        this.emit(state, XIANGQI_INTENT.move, action.move);
        break;
      case "none":
        return;
    }
    this.render(state);
  }

  /**
   * 能否向服务端发意图。
   *
   * 只管「我是这局的玩家且棋局还在进行」，**不查轮次**——认输不该等到自己
   * 回合才允许（对手长考时想认输却得先等他走一步，荒谬）。轮次相关的意图
   * （走子、悔棋）由调用处各自先过 `canAct`。状态栏在等待对手时也照样列出
   * `r 认输`，两处一致。
   */
  private canSubmit(state: GameState<XiangqiView>): boolean {
    return state.phase === "playing" && state.mySeat !== null;
  }

  private mySide(state: GameState<XiangqiView>): Side | null {
    return state.mySeat === null ? null : sideOfSeat(state.mySeat);
  }

  private emit(
    state: GameState<XiangqiView>,
    type: string,
    payload: unknown,
  ): void {
    if (!this.handler || !this.canSubmit(state)) return;
    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type,
      payload,
    });
  }
}

function cellSpan(cell: TuiCell): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = [
    CELL_CLASS,
    `${CELL_CLASS}--${cell.kind}`,
    ...cell.marks.map((m) => `${CELL_CLASS}--${m}`),
  ].join(" ");
  // 用 textContent 而非 innerHTML：字形表虽然是内部常量，但走 innerHTML
  // 就等于给将来「服务端下发自定义字形」留了个注入口
  span.textContent = cell.glyph;
  if (cell.index !== null) span.dataset.index = String(cell.index);
  return span;
}
