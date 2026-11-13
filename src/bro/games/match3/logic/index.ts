/**
 * 消消乐规则引擎对外出口。
 *
 * 只导出逻辑，不导出任何渲染物：Canvas 与 TUI 两套渲染器都从这里取状态，
 * 但规则不允许出现在渲染层（core/types.ts 约束一）。
 */

export * from "./grid";
export * from "./rng";
export * from "./match";
