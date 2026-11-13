/**
 * 「选起点 → 选终点」的交互状态机。
 *
 * 围棋一步就落定，没有这个文件；象棋要两步，而两个渲染器（鼠标点击、键盘
 * Enter）走的是同一套语义。写两份必然分叉——最常见的分叉是「点自己另一个子
 * 到底是换选还是取消」，两边给出不同答案，用户在切主题后会觉得棋盘换了脾气。
 *
 * 这里是纯函数：进的是视图 + 当前选中点 + 被点的格子，出的是一个动作。
 * 不碰 DOM，不发意图，因此能逐条断言。
 *
 * 注意它**不做规则判断**：能不能走完全查 `view.legalMoves` 这张服务端下发的
 * 表（见 view.ts 的说明）。这里只负责「点这一下算什么操作」。
 */

import type { Side } from "../logic";
import type { ViewMove, XiangqiView } from "../view";

/** 一次点选的结果。 */
export type TapAction =
  /** 什么都不做。点在空处或对方子上时如此。 */
  | { readonly kind: "none" }
  /** 选中某格的子。 */
  | { readonly kind: "select"; readonly at: number }
  /** 取消当前选择。 */
  | { readonly kind: "clear" }
  /** 走子。渲染器据此上报意图，合法性最终仍由服务端裁定。 */
  | { readonly kind: "move"; readonly move: ViewMove };

/**
 * 从某格出发的全部合法落点。
 *
 * `from` 为 `null`（未选中）时返回空集合，调用方不必自己判空。
 */
export function targetsFrom(
  view: XiangqiView,
  from: number | null,
): Set<number> {
  if (from === null) return new Set();
  const out = new Set<number>();
  for (const move of view.legalMoves) {
    if (move.from === from) out.add(move.to);
  }
  return out;
}

/**
 * 点一下某格该发生什么。
 *
 * 判定顺序是有讲究的：
 *
 * 1. 点已选中的那一格 → 取消。给用户一条明确的反悔路径。
 * 2. 点合法落点 → 走子。
 * 3. 点己方另一个子 → 改选它，而不是「取消」。象棋里挑子挑错是常事，
 *    每次都要先点空处取消再重选，操作数翻倍。
 * 4. 其余（空格、对方子）→ 有选中就取消，没选中就什么都不做。
 *
 * 第 2 与第 3 不会冲突：合法落点上不可能站着己方子（吃子只吃对方）。
 *
 * @param mySide 本机玩家执哪一色。观战为 `null`，此时任何点选都不成立——
 *   观战者能选子就等于能发意图，那是服务端要拒的东西，不该在这里放行。
 */
export function resolveTap(
  view: XiangqiView,
  mySide: Side | null,
  selected: number | null,
  at: number,
): TapAction {
  if (mySide === null) return { kind: "none" };

  if (selected !== null && selected === at) return { kind: "clear" };

  if (selected !== null && targetsFrom(view, selected).has(at)) {
    return { kind: "move", move: { from: selected, to: at } };
  }

  const piece = view.board[at];
  if (piece != null && piece.side === mySide) return { kind: "select", at };

  return selected !== null ? { kind: "clear" } : { kind: "none" };
}

/**
 * 光标/视线的默认落点：本方的将或帅。
 *
 * 取棋盘正中在象棋里没有意义（那是河界上方的空点）；落在自家将上，玩家一眼
 * 就知道方向感是对的，也是残局里最常要看的一格。找不到将（残局构造、观战）
 * 时退回棋盘正中。
 */
export function defaultCursor(view: XiangqiView, mySide: Side | null): number {
  if (mySide !== null) {
    const at = view.board.findIndex(
      (p) => p != null && p.type === "K" && p.side === mySide,
    );
    if (at >= 0) return at;
  }
  return Math.floor(view.board.length / 2);
}
