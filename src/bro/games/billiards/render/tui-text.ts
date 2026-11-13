

import type { BallGroup, Foul } from "../logic/rules";
import type { BilliardsView } from "../view";
import { TABLE_HALF_LENGTH_M, TABLE_HALF_WIDTH_M } from "./layout";

/** 字符网格尺寸。列:行 = 4:1，见文件头。 */
export const GRID_COLS = 44;
export const GRID_ROWS = 11;

export const GLYPH = {
  cue: "○",
  empty: " ",
  aim: "·",
  cursor: "+",
  pocket: "o",
  rail: "-",
  side: "|",
} as const;

/** 号码球字符。1~15 → ①~⑮。 */
export function ballGlyph(id: number): string {
  if (id === 0) return GLYPH.cue;
  if (id >= 1 && id <= 20) return String.fromCharCode(0x2460 + id - 1);
  return "?";
}

/** 台面坐标（米）→ 字符格。越界的坐标会被夹进网格内。 */
export function metersToCell(
  x: number,
  y: number,
): { col: number; row: number } {
  const u = (x + TABLE_HALF_LENGTH_M) / (TABLE_HALF_LENGTH_M * 2);
  const v = (y + TABLE_HALF_WIDTH_M) / (TABLE_HALF_WIDTH_M * 2);
  return {
    col: clamp(Math.floor(u * GRID_COLS), 0, GRID_COLS - 1),
    row: clamp(Math.floor(v * GRID_ROWS), 0, GRID_ROWS - 1),
  };
}

/** 字符格 → 台面坐标（米）。取格心，摆球时用。 */
export function cellToMeters(
  col: number,
  row: number,
): { x: number; y: number } {
  const u = (col + 0.5) / GRID_COLS;
  const v = (row + 0.5) / GRID_ROWS;
  return {
    x: u * TABLE_HALF_LENGTH_M * 2 - TABLE_HALF_LENGTH_M,
    y: v * TABLE_HALF_WIDTH_M * 2 - TABLE_HALF_WIDTH_M,
  };
}

export interface TableTextOptions {
  /** 瞄准角度，brad。给了就画一条射线。 */
  readonly aimBrad?: number;
  /** 摆球光标所在字符格。持球在手时给。 */
  readonly cursor?: { col: number; row: number } | null;
}

/**
 * 把台面排成字符网格。
 *
 * 顺序有讲究：先铺瞄准线，再放球，最后放光标 —— 后写的盖掉先写的。球被瞄准线
 * 盖住就看不出台面上还剩几颗，那比看不见瞄准线严重得多。
 */
export function renderTableText(
  view: BilliardsView,
  options: TableTextOptions = {},
): string {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => GLYPH.empty),
  );

  const cue = view.balls.find((b) => b.id === 0 && !b.pocketed);
  if (options.aimBrad !== undefined && cue) {
    paintAim(grid, cue.x, cue.y, options.aimBrad);
  }

  for (const ball of view.balls) {
    if (ball.pocketed) continue;
    const { col, row } = metersToCell(ball.x, ball.y);
    grid[row][col] = ballGlyph(ball.id);
  }

  if (options.cursor) {
    const { col, row } = options.cursor;
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      grid[row][col] = GLYPH.cursor;
    }
  }

  const border = horizontalRail();
  const body = grid.map(
    (cells, row) => `${sideRail(row)}${cells.join("")}${sideRail(row)}`,
  );
  return [border, ...body, border].join("\n");
}

/** 上下库边。角袋与中袋的位置用 `o` 标出来。 */
function horizontalRail(): string {
  const cells: string[] = [];
  for (let col = 0; col < GRID_COLS; col += 1) {
    const isPocket =
      col === 0 ||
      col === GRID_COLS - 1 ||
      col === Math.floor(GRID_COLS / 2) ||
      col === Math.floor(GRID_COLS / 2) - 1;
    cells.push(isPocket ? GLYPH.pocket : GLYPH.rail);
  }
  return `${GLYPH.pocket}${cells.join("")}${GLYPH.pocket}`;
}

function sideRail(_row: number): string {
  return GLYPH.side;
}

/**
 * 画瞄准射线。
 *
 * 只是一条直线，**不算反弹也不算碰撞** —— 它是「我往哪个方向打」的提示，不是
 * 弹道预测。给一条会拐弯但拐得不准的线，比给一条明摆着是直的线更容易骗人。
 */
function paintAim(
  grid: string[][],
  cueX: number,
  cueY: number,
  brad: number,
): void {
  const radians = (brad / 16384) * Math.PI * 2;
  const stepM = (TABLE_HALF_LENGTH_M * 2) / GRID_COLS;
  const dx = Math.cos(radians) * stepM;
  const dy = Math.sin(radians) * stepM;

  let x = cueX;
  let y = cueY;
  for (let i = 0; i < GRID_COLS; i += 1) {
    x += dx;
    y += dy;
    if (Math.abs(x) > TABLE_HALF_LENGTH_M || Math.abs(y) > TABLE_HALF_WIDTH_M) {
      return;
    }
    const { col, row } = metersToCell(x, y);
    grid[row][col] = GLYPH.aim;
  }
}

/** 力度条。`[████░░░░░░]` 加百分比。 */
export function renderPowerBar(ratio: number, width = 10): string {
  const clamped = clamp(ratio, 0, 1);
  const filled = Math.round(clamped * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.round(
    clamped * 100,
  )
    .toString()
    .padStart(3, " ")}%`;
}

/** brad → 度，保留一位。状态栏显示用。 */
export function bradToDegrees(brad: number): string {
  return `${(((((brad % 16384) + 16384) % 16384) / 16384) * 360).toFixed(1)}°`;
}

const FOUL_LABEL: Record<Foul, string> = {
  cue_pocketed: "母球落袋",
  no_contact: "空杆",
  wrong_first_contact: "打错球",
  no_rail: "无球吃库",
  illegal_break: "开球不合法",
};

const GROUP_LABEL: Record<BallGroup, string> = {
  solids: "全色 ①-⑦",
  stripes: "花色 ⑨-⑮",
};

/**
 * 底部状态栏。
 *
 * 与围棋同一条硬要求（UI-DESIGN.md §6.3）：列出的快捷键必须与当前真正生效的
 * 完全一致。所以 `canAct` 和 `ballInHand` 都要读 —— 轮不到你时不能写「Enter
 * 出杆」，持球在手时也不能，那时 Enter 是摆球。
 */
export function renderStatusBar(
  view: BilliardsView,
  canAct: boolean,
  aim: { brad: number; power: number },
): string {
  if (view.winner !== null) {
    return `终局 · 座位 ${view.winner} 胜 · q 退出`;
  }

  const group = view.myGroup ? GROUP_LABEL[view.myGroup] : "台面开放";
  const last = view.lastShot;
  const lastText = last
    ? last.foul
      ? ` · 上杆 ${FOUL_LABEL[last.foul]}`
      : last.pocketed.length > 0
        ? ` · 上杆进 ${last.pocketed.map(ballGlyph).join("")}`
        : ""
    : "";

  if (!canAct) return `${group}${lastText} · 等待对手 · q 退出`;

  if (view.ballInHand) {
    return `${group}${lastText} · 持球在手 · hjkl/方向键 移动 · Enter 摆球 · q 退出`;
  }

  return (
    `${group}${lastText} · 角度 ${bradToDegrees(aim.brad)} · 力度 ${renderPowerBar(aim.power)}` +
    ` · h/l 转向 · j/k 力度 · Enter 出杆 · q 退出`
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
