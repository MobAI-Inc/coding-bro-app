/**
 * TUI 渲染器（暗色模式）。
 *
 * 全键盘可操作是硬要求（UI-DESIGN.md §6.3）。这里索性只做键盘：字符
 * 网格里靠点击定位交叉点，得从像素反推字符格，而 `●○┼` 这些字符在
 * 不同字体下宽度并不统一（East Asian Width 属 Ambiguous），反推必然
 * 有偏差。与其给一个偶尔点错格的鼠标，不如不给——设计文档把鼠标列为
 * 可选，键盘才是承诺。
 *
 * 光标是渲染器的本地状态，不是对局状态——它不该进服务端快照，也不该
 * 因为对手落子而被重置。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import { EMPTY } from "../logic";
import type { GoView } from "../view";
import { GO_INTENT } from "../view";
import { cursorTextOffset, renderBoardText, renderStatusBar } from "./tui-text";

export class TuiGoRenderer implements GameRenderer<GoView> {
  readonly mode: RenderMode = "tui";

  private root: HTMLElement | null = null;
  private boardEl: HTMLPreElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<GoView> | null = null;
  /** 光标位置。首次渲染时落到天元。 */
  private cursor: number | null = null;

  mount(container: HTMLElement): void {
    const root = document.createElement("div");
    // .tui 是共享的 TUI 外观层（themes/tui/tui.css），.bro-go-tui 只加围棋特有的部分
    root.className = "tui bro-go-tui";
    // 让根节点可聚焦，否则收不到键盘事件
    root.tabIndex = 0;

    const board = document.createElement("pre");
    board.className = "tui-grid bro-go-tui__board";
    const status = document.createElement("div");
    status.className = "bro-go-tui__status";

    root.append(board, status);
    container.append(root);

    root.addEventListener("keydown", this.onKeyDown);

    this.root = root;
    this.boardEl = board;
    this.statusEl = status;
    root.focus();
  }

  render(state: GameState<GoView>): void {
    if (!this.boardEl || !this.statusEl) return;
    this.latest = state;

    const view = state.board;
    if (this.cursor === null || this.cursor >= view.cells.length) {
      this.cursor = Math.floor((view.size * view.size) / 2);
    }

    const text = renderBoardText(view);
    const offset = cursorTextOffset(view.size, this.cursor);

    // 把光标处那一个字符拆出来套高亮，其余原样。用 textContent 而非
    // innerHTML 写入两侧文本，棋盘内容里就算混进 < 也不会变成标签。
    this.boardEl.replaceChildren(
      document.createTextNode(text.slice(0, offset)),
      cursorSpan(text[offset]),
      document.createTextNode(text.slice(offset + 1)),
    );

    this.statusEl.textContent = renderStatusBar(view, canAct(state));
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

    const { size } = state.board;
    const row = Math.floor(cursor / size);
    const col = cursor % size;

    const moved = ((): number | null => {
      switch (event.key) {
        case "h":
        case "ArrowLeft":
          return col > 0 ? cursor - 1 : null;
        case "l":
        case "ArrowRight":
          return col < size - 1 ? cursor + 1 : null;
        case "k":
        case "ArrowUp":
          return row > 0 ? cursor - size : null;
        case "j":
        case "ArrowDown":
          return row < size - 1 ? cursor + size : null;
        default:
          return null;
      }
    })();

    if (moved !== null) {
      event.preventDefault();
      this.cursor = moved;
      this.render(state);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.emitPlace(state, cursor);
    } else if (event.key === "p") {
      event.preventDefault();
      this.emit(state, GO_INTENT.pass, {});
    }
  };

  private emitPlace(state: GameState<GoView>, index: number): void {
    // 已有子的点直接忽略，不必惊动服务端。这是体验优化，不是规则判定——
    // 真正的合法性仍由服务端裁定（见 core/types.ts 约束 2）。
    if (state.board.cells[index] !== EMPTY) return;
    this.emit(state, GO_INTENT.place, { index });
  }

  private emit(state: GameState<GoView>, type: string, payload: unknown): void {
    if (!this.handler || !canAct(state)) return;
    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type,
      payload,
    });
  }
}

function cursorSpan(char: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "bro-go-tui__cursor";
  span.textContent = char;
  return span;
}
