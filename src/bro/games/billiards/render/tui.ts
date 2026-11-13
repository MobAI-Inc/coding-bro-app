/**
 * TUI 渲染器（暗色模式）。
 *
 * 全键盘。理由同围棋那份：字符格宽度在不同字体下并不统一，从像素反推格位必然
 * 偏差，与其给一个偶尔点错的鼠标不如不给。
 *
 * 台球比围棋多一层：击球有两个连续量（角度、力度），键盘要能连续调。这里用
 * `h/l` 转角度、`j/k` 调力度，都是本地状态 —— 它们不进快照，也不因对手出杆
 * 而重置（重置会让你刚调好的角度平白丢掉）。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { BilliardsView } from "../view";
import { BILLIARDS_INTENT } from "../view";
import { powerToFixed } from "./layout";
import {
  GRID_COLS,
  GRID_ROWS,
  cellToMeters,
  metersToCell,
  renderStatusBar,
  renderTableText,
} from "./tui-text";

/** 一次按键转多少 brad。16384/64 = 256，转一圈要 64 下，够细也不至于按到手酸。 */
const ANGLE_STEP = 256;
/** 一次按键调多少力度（归一值）。 */
const POWER_STEP = 0.05;

export class TuiBilliardsRenderer implements GameRenderer<BilliardsView> {
  readonly mode: RenderMode = "tui";

  private root: HTMLElement | null = null;
  private tableEl: HTMLPreElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<BilliardsView> | null = null;

  private aimBrad = 0;
  private power = 0.5;
  /** 摆球光标。持球在手时才用得上，首次进入落到台面中心。 */
  private cursor = {
    col: Math.floor(GRID_COLS / 2),
    row: Math.floor(GRID_ROWS / 2),
  };

  mount(container: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "tui bro-billiards-tui";
    root.tabIndex = 0;

    const table = document.createElement("pre");
    table.className = "tui-grid bro-billiards-tui__table";
    const status = document.createElement("div");
    status.className = "bro-billiards-tui__status";

    root.append(table, status);
    container.append(root);
    root.addEventListener("keydown", this.onKeyDown);

    this.root = root;
    this.tableEl = table;
    this.statusEl = status;
    root.focus();
  }

  render(state: GameState<BilliardsView>): void {
    if (!this.tableEl || !this.statusEl) return;
    this.latest = state;

    const view = state.board;
    const inHand = view.ballInHand && canAct(state);

    this.tableEl.textContent = renderTableText(view, {
      aimBrad: inHand ? undefined : this.aimBrad,
      cursor: inHand ? this.cursor : null,
    });
    this.statusEl.textContent = renderStatusBar(view, canAct(state), {
      brad: this.aimBrad,
      power: this.power,
    });
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    this.root?.removeEventListener("keydown", this.onKeyDown);
    this.root?.remove();
    this.root = null;
    this.tableEl = null;
    this.statusEl = null;
    this.handler = null;
    this.latest = null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const state = this.latest;
    if (!state || !canAct(state)) return;

    const inHand = state.board.ballInHand;
    const key = event.key;

    if (inHand) {
      const moved = this.moveCursor(key);
      if (moved) {
        event.preventDefault();
        this.render(state);
        return;
      }
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        const { x, y } = cellToMeters(this.cursor.col, this.cursor.row);
        this.emit(state, BILLIARDS_INTENT.place, { x, y });
      }
      return;
    }

    switch (key) {
      case "h":
      case "ArrowLeft":
        event.preventDefault();
        this.aimBrad = (this.aimBrad - ANGLE_STEP + 16384) % 16384;
        this.render(state);
        return;
      case "l":
      case "ArrowRight":
        event.preventDefault();
        this.aimBrad = (this.aimBrad + ANGLE_STEP) % 16384;
        this.render(state);
        return;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        this.power = Math.min(1, this.power + POWER_STEP);
        this.render(state);
        return;
      case "j":
      case "ArrowDown":
        event.preventDefault();
        this.power = Math.max(0, this.power - POWER_STEP);
        this.render(state);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        this.emit(state, BILLIARDS_INTENT.strike, {
          angle: this.aimBrad,
          power: powerToFixed(this.power),
          offsetX: 0,
          offsetY: 0,
        });
        return;
      default:
        return;
    }
  };

  /** 移动摆球光标。返回是否真的动了 —— 没动就别拦掉按键。 */
  private moveCursor(key: string): boolean {
    const { col, row } = this.cursor;
    switch (key) {
      case "h":
      case "ArrowLeft":
        if (col === 0) return false;
        this.cursor = { col: col - 1, row };
        return true;
      case "l":
      case "ArrowRight":
        if (col === GRID_COLS - 1) return false;
        this.cursor = { col: col + 1, row };
        return true;
      case "k":
      case "ArrowUp":
        if (row === 0) return false;
        this.cursor = { col, row: row - 1 };
        return true;
      case "j":
      case "ArrowDown":
        if (row === GRID_ROWS - 1) return false;
        this.cursor = { col, row: row + 1 };
        return true;
      default:
        return false;
    }
  }

  private emit(
    state: GameState<BilliardsView>,
    type: string,
    payload: unknown,
  ): void {
    if (!this.handler) return;
    this.handler({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type,
      payload,
    });
  }
}

/** 导出给测试用：把球位换成字符格。 */
export { metersToCell };
