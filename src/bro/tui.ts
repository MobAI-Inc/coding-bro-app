/**
 * TUI 模式的公共显示件。
 *
 * 暗色下所有页面都是终端外观（UI-DESIGN.md §6）。这里放的是「多个页面都要
 * 画、且必须画得一样」的东西——两页的进度条一个 20 格一个 24 格，单看都对，
 * 放在一个应用里就是两套设计语言。
 */

/**
 * 字符进度条的格数。
 *
 * 固定长度是刻意的：长度随数据变的话，两行条没法互相比较，而 TUI 下
 * 「哪个窗口更紧张」正是靠上下两行条一眼看出来的。
 */
export const BAR_CELLS = 20;

/**
 * `[####................]` 这样的字符条。
 *
 * 上限为 0 时全空而不是全满：除零会得到 NaN，`"#".repeat(NaN)` 是空串，
 * 条会莫名其妙短一截而不是报错——一个不会崩、只会显示错的 bug，最难查。
 * 超额时封顶在满格：`repeat` 收到负数会直接抛异常，整页白屏。
 */
export function barChars(used: number, cap: number, cells = BAR_CELLS): string {
  const filled =
    cap > 0
      ? Math.max(0, Math.min(cells, Math.round((used / cap) * cells)))
      : 0;
  return `[${"#".repeat(filled)}${".".repeat(cells - filled)}]`;
}
