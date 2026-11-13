/**
 * TUI 渲染器（暗色模式）。
 *
 * 全键盘可操作是硬要求（UI-DESIGN.md §6.3），这里只做键盘。理由和围棋那边
 * 一样：字符网格里靠点击定位格子，得从像素反推字符格，而 `◆▲●■★○` 的
 * East Asian Width 是 Ambiguous，实际宽度随字体变，反推必然有偏差。与其给
 * 一个偶尔点错格的鼠标，不如不给——设计文档把鼠标列为可选，键盘才是承诺。
 *
 * 光标与选中都是渲染器的本地状态，不进服务端快照：它们不该因为服务端推来
 * 一帧新盘面就被重置到别处。
 *
 * ## DOM 只在版本前进时重建
 *
 * 每个元素字符各自套一个 span，光标、选中、消除闪烁全靠改这些 span 的
 * className 表达，不动 DOM 结构。两个后果都是必需的：
 *
 * 1. **`render()` 幂等**（core/types.ts 对渲染器的要求）。闪烁标记是
 *    `view.steps` 的纯函数，同一份状态渲染两次得到完全相同的 DOM。若改成
 *    「只在收到新快照时加闪烁」，第二次 render 会把闪烁抹掉——同一个状态
 *    渲染出两种画面。
 * 2. **移动光标不重启闪烁动画。** CSS 动画在元素创建时起播，逐帧重建 DOM
 *    会让玩家每按一次方向键就看见盘面重闪一遍，而那批格子上一步就消掉了。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { Pos } from "../logic";
import { isAdjacent, posEquals } from "../logic";
import type { Match3View } from "../view";
import { MATCH3_INTENT } from "../view";
import {
  cellTextOffset,
  clearedTextOffsets,
  renderBoardText,
  renderStatsLine,
  renderStatusBar,
} from "./tui-text";

/** 三种标记的类名。都由 match3.css 定义，闪烁在 reduced-motion 下自动停。 */
const MARK = {
  cursor: "bro-match3-tui__cursor",
  selected: "bro-match3-tui__selected",
  flash: "bro-match3-tui__flash",
} as const;

export class TuiMatch3Renderer implements GameRenderer<Match3View> {
  readonly mode: RenderMode = "tui";

  private root: HTMLElement | null = null;
  private boardEl: HTMLPreElement | null = null;
  private statsEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<Match3View> | null = null;

  private cursor: Pos = { row: 0, col: 0 };
  private selected: Pos | null = null;

  /** 字符偏移 → 该格的 span。偏移由 {@link cellTextOffset} 算，不扫字符串。 */
  private cellSpans = new Map<number, HTMLSpanElement>();
  /** 当前 DOM 对应的版本。用来判断要不要重建，见文件头。 */
  private builtVersion: number | null = null;

  mount(container: HTMLElement): void {
    const root = document.createElement("div");
    // .tui 是共享的 TUI 外观层（themes/tui/tui.css），.bro-match3-tui 只加本游戏特有的
    root.className = "tui bro-match3-tui";
    root.tabIndex = 0;

    const stats = document.createElement("div");
    stats.className = "bro-match3-tui__stats";
    const board = document.createElement("pre");
    board.className = "tui-grid bro-match3-tui__board";
    const status = document.createElement("div");
    status.className = "tui-statusbar bro-match3-tui__status";

    root.append(stats, board, status);
    container.append(root);
    root.addEventListener("keydown", this.onKeyDown);

    this.root = root;
    this.statsEl = stats;
    this.boardEl = board;
    this.statusEl = status;
    root.focus();
  }

  render(state: GameState<Match3View>): void {
    // 版本前进说明服务端接受了一步：选中态该清掉了，否则玩家会拿着上一步
    // 的选中继续按 Enter，第二次按下的语义全错
    if (this.latest === null || this.latest.version !== state.version) {
      this.selected = null;
    }
    this.latest = state;
    this.paint();
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.root?.removeEventListener("keydown", this.onKeyDown);
    this.root?.remove();
    this.root = null;
    this.boardEl = null;
    this.statsEl = null;
    this.statusEl = null;
    this.handler = null;
    this.latest = null;
    this.cellSpans.clear();
    this.builtVersion = null;
  }

  private paint(): void {
    const state = this.latest;
    if (!state || !this.boardEl || !this.statusEl || !this.statsEl) return;
    const view = state.board;

    this.clampCursor(view);
    if (this.builtVersion !== state.version) {
      this.buildBoard(view);
      this.builtVersion = state.version;
    }

    const acting = canAct(state);
    const flashing = new Set(clearedTextOffsets(view));
    const cursorAt = cellTextOffset(view.width, this.cursor);
    const selectedAt = this.selected
      ? cellTextOffset(view.width, this.selected)
      : null;

    for (const [offset, span] of this.cellSpans) {
      const classes: string[] = [];
      if (flashing.has(offset)) classes.push(MARK.flash);
      // 不能行动时不画光标与选中：画了等于暗示还能操作
      if (acting && offset === selectedAt) classes.push(MARK.selected);
      if (acting && offset === cursorAt) classes.push(MARK.cursor);
      span.className = classes.join(" ");
    }

    this.statsEl.textContent = renderStatsLine(view);
    this.statusEl.textContent = renderStatusBar(view, acting, this.selected);
  }

  /**
   * 按盘面文本重建 span 结构。
   *
   * 每个 span 恰好包一个元素字符，分隔符与换行留作裸文本节点。用
   * `createTextNode` 而不是 `innerHTML`：盘面字符里就算混进 `<`，也只会是
   * 一个字符，不会变成标签。
   *
   * 文本本身仍由 {@link renderBoardText} 产出，span 只是套在外面——
   * `boardEl.textContent` 因此与纯函数的输出逐字相等，排版可以脱离 DOM 断言。
   */
  private buildBoard(view: Match3View): void {
    const board = this.boardEl;
    if (!board) return;

    const text = renderBoardText(view);
    const nodes: Node[] = [];
    this.cellSpans.clear();

    let at = 0;
    for (let row = 0; row < view.height; row += 1) {
      for (let col = 0; col < view.width; col += 1) {
        const offset = cellTextOffset(view.width, { row, col });
        if (offset > at)
          nodes.push(document.createTextNode(text.slice(at, offset)));
        const span = document.createElement("span");
        span.textContent = text[offset];
        nodes.push(span);
        this.cellSpans.set(offset, span);
        at = offset + 1;
      }
    }
    if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));

    board.replaceChildren(...nodes);
  }

  /**
   * 把光标拉回盘内。
   *
   * 盘面尺寸理论上一局之内不变，但换局、重连后拿到别的配置都可能让它变。
   * 光标越界会算出一个落在别行的字符偏移，标记就跑到毫不相干的格子上。
   */
  private clampCursor(view: Match3View): void {
    this.cursor = {
      row: Math.min(Math.max(0, this.cursor.row), view.height - 1),
      col: Math.min(Math.max(0, this.cursor.col), view.width - 1),
    };
  }

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
      this.paint();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.pick(state, this.cursor);
    } else if (event.key === "Escape" && this.selected) {
      event.preventDefault();
      this.selected = null;
      this.paint();
    }
  };

  /**
   * 与 Canvas 完全相同的两步语义：先选中，再选相邻格即交换。
   *
   * 选中非相邻格时改选它，而不是报错——这是玩家改主意的正常操作。
   */
  private pick(state: GameState<Match3View>, at: Pos): void {
    if (!canAct(state)) return;

    const selected = this.selected;
    if (selected === null) {
      this.selected = at;
      this.paint();
      return;
    }
    if (posEquals(selected, at)) {
      this.selected = null;
      this.paint();
      return;
    }
    if (!isAdjacent(selected, at)) {
      this.selected = at;
      this.paint();
      return;
    }

    this.handler?.({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type: MATCH3_INTENT.swap,
      payload: { a: selected, b: at },
    });
  }
}
