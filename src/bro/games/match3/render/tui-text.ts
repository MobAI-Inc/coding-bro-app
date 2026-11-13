

import type { Pos, TileKind } from "../logic";
import type { Match3View } from "../view";
import { goalProgress, movesLeft } from "../view";

/**
 * 元素字符表。下标即 `TileKind`。
 *
 * 靠**字形**而非颜色区分元素（UI-DESIGN.md §9「颜色不作为唯一信息载体」）。
 * 三消要求玩家一眼分辨相邻元素是否同类，全靠颜色的话色觉障碍玩家根本无法
 * 完成基本操作——这不是体验打折，是玩不了。
 *
 * 六个字形两两不同族：实心菱形、三角、实心圆、方块、星、空心圆。原先第六位
 * 是 `♦`（U+2666），和第一位 `◆`（U+25C6）在多数等宽字体里就是同一个形状——
 * 那等于把这一对的区分权全交给颜色，正是上一段说的「玩不了」。换成 `○`
 * （U+25CB）后靠填充与轮廓区分，且它和 `●` 的实心/空心对比在任何字体下都成立。
 *
 * UI-DESIGN.md §6.2 的表已同步改掉，两处必须一致——末尾有测试直接读文档比对。
 */
export const TILE_GLYPHS = ["◆", "▲", "●", "■", "★", "○"] as const;

/** 元素字符间的分隔。半角空格，每格之间恰好一个。 */
const SEPARATOR = " ";

/**
 * 元素种类 → 字符。
 *
 * 越界抛错而不是取模回绕：回绕会让两种不同的元素显示成同一个字符，玩家
 * 看到「三个一样的却消不掉」，而盘面数据其实完全正确。这种 bug 从现象
 * 反推不到成因。字符表的长度就是 TUI 能承载的种类数上限。
 */
export function glyphOf(kind: TileKind): string {
  if (!Number.isInteger(kind) || kind < 0 || kind >= TILE_GLYPHS.length) {
    throw new RangeError(`没有对应字符的元素种类: ${kind}`);
  }
  return TILE_GLYPHS[kind];
}

/** 把盘面排成字符网格。每行等宽，行间用 `\n`。 */
export function renderBoardText(view: Match3View): string {
  const lines: string[] = [];
  for (let row = 0; row < view.height; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < view.width; col += 1) {
      cells.push(glyphOf(view.cells[row * view.width + col]));
    }
    lines.push(cells.join(SEPARATOR));
  }
  return lines.join("\n");
}

/**
 * 某格在 {@link renderBoardText} 结果里的字符下标。
 *
 * 每行等宽（元素与分隔符交替，末列无分隔符），所以直接算，不扫描字符串。
 */
export function cellTextOffset(width: number, p: Pos): number {
  const lineLength = width * 2 - 1;
  return p.row * (lineLength + 1) + p.col * 2;
}

/**
 * 最近一次交换消掉的全部格子的字符偏移，已去重并升序。
 *
 * 给 DOM 层加闪烁类用（UI-DESIGN.md §6.2「消除时字符闪烁」）。去重是必须的：
 * L 形的拐点会同时出现在横组和纵组里，同一个偏移套两次 span 会让那个字符
 * 在 DOM 里出现两遍，整行随之错位。
 */
export function clearedTextOffsets(view: Match3View): number[] {
  const offsets = new Set<number>();
  for (const step of view.steps) {
    for (const p of step.cleared) offsets.add(cellTextOffset(view.width, p));
  }
  return [...offsets].sort((a, b) => a - b);
}

/**
 * 字符进度条（UI-DESIGN.md §6.1）。
 *
 * 只在 `ratio` 确实到 1 时才画满：`Math.round` 会让 97% 显示成满格，玩家
 * 以为已经通关却还在继续玩，是最容易被投诉的一类显示错误。所以用 `floor`
 * 填充，再单独判断满格。
 */
export function renderProgressBar(ratio: number, width = 16): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const filled = clamped >= 1 ? width : Math.floor(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * 数据行：分数、进度、步数、最高连锁。
 *
 * 和盘面分开成独立一行，因此可以放心混用 ASCII——它不需要和字符网格对齐。
 */
export function renderStatsLine(view: Match3View): string {
  const bar = renderProgressBar(goalProgress(view));
  const chain = view.bestChain > 0 ? ` · 最高连锁 ×${view.bestChain}` : "";
  return (
    `分数 ${view.score}/${view.targetScore} ${bar} ` +
    `· 剩余 ${movesLeft(view)}/${view.moveLimit} 步${chain}`
  );
}

/**
 * 底部状态栏。
 *
 * UI-DESIGN.md §6.3 有一条硬性要求：状态栏列出的快捷键必须与当前真正生效的
 * 完全一致。所以这里同时接收 `canAct` 与 `selected`——没选中元素时列出
 * 「Esc 取消」是骗人，终局后列出「Enter」更是。
 */
export function renderStatusBar(
  view: Match3View,
  canAct: boolean,
  selected: Pos | null,
): string {
  if (view.outcome) {
    const { verdict, score, targetScore } = view.outcome;
    const verdictText =
      verdict === "cleared"
        ? `通关 ${score}/${targetScore}`
        : `未通关 ${score}/${targetScore}`;
    return `${verdictText} · q 退出`;
  }

  if (!canAct) return "等待服务端 · q 退出";

  const keys = selected
    ? `已选 (${selected.row + 1},${selected.col + 1}) · hjkl/方向键 移动 · Enter 与相邻元素交换 · Esc 取消 · q 退出`
    : "hjkl/方向键 移动 · Enter 选中 · q 退出";

  const warn = view.reshuffled ? " · 无子可动，盘面已重排" : "";
  return `${keys}${warn}`;
}
