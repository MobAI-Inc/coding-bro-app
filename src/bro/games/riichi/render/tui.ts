/**
 * 立直麻将：TUI 渲染器（暗色模式）。
 *
 * 与围棋那版同构：只做键盘，光标是渲染器本地状态、不进服务端快照。
 *
 * 麻将比围棋多一个光标必须处理的问题：**手牌张数会变**。打出一张后手牌从 14
 * 张变 13 张，原本指着第 13 张的光标就悬空了。所以每次 render 都把光标夹回
 * 合法范围 —— 不夹的话玩家会看到光标消失，或者按 Enter 打出一张不存在的牌。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { RiichiView } from "../view";
import { RIICHI_INTENT } from "../view";
import { renderTable } from "./tui-text";

export class TuiRiichiRenderer implements GameRenderer<RiichiView> {
  readonly mode: RenderMode = "tui";

  private root: HTMLElement | null = null;
  private screenEl: HTMLPreElement | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<RiichiView> | null = null;
  /** 手牌光标。首帧落在最后一张（刚摸的那张）。 */
  private cursor = 0;

  mount(container: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "tui bro-riichi-tui";
    root.tabIndex = 0;

    const screen = document.createElement("pre");
    screen.className = "tui-grid bro-riichi-tui__screen";
    root.append(screen);
    container.append(root);

    root.addEventListener("keydown", this.onKeyDown);

    this.root = root;
    this.screenEl = screen;
    root.focus();
  }

  render(state: GameState<RiichiView>): void {
    if (!this.screenEl) return;
    this.latest = state;

    const hand = state.board.self.hand;
    // 手牌张数会变（打出一张就少一张），光标必须跟着夹回来
    this.cursor = Math.min(
      Math.max(0, this.cursor),
      Math.max(0, hand.length - 1),
    );

    this.screenEl.textContent = renderTable(
      state.board,
      canAct(state),
      this.cursor,
    );
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.root?.removeEventListener("keydown", this.onKeyDown);
    this.root?.remove();
    this.root = null;
    this.screenEl = null;
    this.handler = null;
    this.latest = null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const state = this.latest;
    if (!state) return;
    const hand = state.board.self.hand;

    switch (event.key) {
      case "h":
      case "ArrowLeft":
        event.preventDefault();
        this.cursor = Math.max(0, this.cursor - 1);
        this.render(state);
        return;
      case "l":
      case "ArrowRight":
        event.preventDefault();
        this.cursor = Math.min(hand.length - 1, this.cursor + 1);
        this.render(state);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        this.emit(state, RIICHI_INTENT.discard, { tile: hand[this.cursor] });
        return;
      case "R":
        // 大写 R 才是立直：立直不可撤销，误按一次代价是一局的走向。
        // 小写 r 留给荣和 —— 两者都是「确认型」操作，但荣和永远只是好事。
        event.preventDefault();
        this.emit(state, RIICHI_INTENT.discard, {
          tile: hand[this.cursor],
          riichi: true,
        });
        return;
      case "r":
        event.preventDefault();
        this.emit(state, RIICHI_INTENT.ron, {});
        return;
      case "t":
        event.preventDefault();
        this.emit(state, RIICHI_INTENT.tsumo, {});
        return;
      case "p":
        event.preventDefault();
        this.emit(state, RIICHI_INTENT.pass, {});
        return;
      default:
    }
  };

  private emit(
    state: GameState<RiichiView>,
    type: string,
    payload: unknown,
  ): void {
    if (!this.handler || !canAct(state)) return;
    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type,
      payload,
    });
  }
}
