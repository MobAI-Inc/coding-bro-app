/**
 * 选牌的合法性判定与提示文案。
 *
 * 纯函数，三个消费者共用：Canvas 渲染器、TUI 状态栏、对局页的按钮区。
 * 放在渲染层是因为它回答的是**显示问题**——「这手牌现在能不能点出牌」。
 * 真正的裁定仍在服务端（core/types.ts 约束 2），这里算错了顶多是按钮该
 * 亮的时候没亮，不会让非法的牌真的出出去。
 *
 * 「牌型不符」与「压不过」要分开说，这是 `isComparable` 在规则引擎里存在的
 * 唯一理由：玩家拿一对 A 去压一个单张 3，提示「你的牌太小」会把他绕进去，
 * 他会以为要找更大的对子。
 */

import type { Card, CardId, Pattern } from "../logic";
import { canBeat, identifyPattern, isComparable } from "../logic";
import type { DoudizhuView } from "../view";

/** 选牌出不去的原因。稳定标识，文案另配。 */
export type SelectionProblem =
  /** 一张没选。 */
  | "empty"
  /** 凑不成任何牌型。 */
  | "unknown_pattern"
  /** 牌型或长度与上家不符，压根不可比。 */
  | "mismatch"
  /** 同型同长，但点数不够大。 */
  | "too_small";

export type SelectionVerdict =
  | { readonly ok: true; readonly pattern: Pattern }
  | { readonly ok: false; readonly problem: SelectionProblem };

/** 判定当前选牌能不能出。`toBeat` 为 `null` 表示本轮由自己领出。 */
export function checkSelection(
  cards: readonly Card[],
  toBeat: Pattern | null,
): SelectionVerdict {
  if (cards.length === 0) return { ok: false, problem: "empty" };

  const pattern = identifyPattern(cards);
  if (pattern === null) return { ok: false, problem: "unknown_pattern" };
  if (canBeat(pattern, toBeat)) return { ok: true, pattern };

  // 走到这里必然有上家牌型（canBeat 对 null 恒为真），可以安全地问「可比吗」
  return {
    ok: false,
    problem: isComparable(pattern, toBeat as Pattern)
      ? "too_small"
      : "mismatch",
  };
}

/**
 * 提示文案。
 *
 * `empty` 没有文案：一张牌都没选时按钮本来就是灰的，再弹一句「你没选牌」
 * 是在骂用户。提示只在他做了事而做不成时出现。
 */
export const SELECTION_TEXT: Record<SelectionProblem, string> = {
  empty: "",
  unknown_pattern: "这几张凑不成牌型",
  mismatch: "牌型不符，要跟上家一样的牌型和张数",
  too_small: "压不过上家",
};

/** 要显示给玩家的一句话。可以出、或无须提示时返回 `null`。 */
export function selectionHint(
  cards: readonly Card[],
  toBeat: Pattern | null,
): string | null {
  const verdict = checkSelection(cards, toBeat);
  if (verdict.ok) return null;
  return SELECTION_TEXT[verdict.problem] || null;
}

/**
 * 视图里待压的牌型。
 *
 * 视图只带牌不带牌型（见 view.ts），这里当场识别。多算一次的代价，换来
 * 「牌型」与「牌」不可能对不上。
 */
export function patternToBeat(view: DoudizhuView): Pattern | null {
  if (view.toBeat === null) return null;
  return identifyPattern(view.toBeat.cards);
}

/**
 * 按 id 从手牌里取牌，顺序跟手牌走。
 *
 * 跟手牌顺序而不是跟选中顺序：牌型识别与顺序无关，但序列化结果会不同，
 * 而「同一手牌两种写法」在日志与断言里是纯粹的噪音。
 * 找不到的 id 被忽略——它只会来自过期的选中状态（牌已经出掉了）。
 */
export function cardsByIds(
  hand: readonly Card[],
  ids: readonly CardId[],
): Card[] {
  const wanted = new Set(ids);
  return hand.filter((card) => wanted.has(card.id));
}

/**
 * 持有选牌状态的渲染器。
 *
 * 选牌是**渲染器的本地视觉状态**，和围棋的光标、悬停同性质：它不进快照，
 * 也不该因为对手出牌而被服务端重置。但对局页要拿它来决定「出牌」按钮亮不
 * 亮、提示说什么，所以两个渲染器都得按同一个口子把它交出来。
 *
 * 让 React 持有选牌、再灌回渲染器也能做，但那样每次点牌都要绕一圈
 * 「渲染器 → React → 渲染器」，中间任何一次没同步上就会出现「牌看着是选中
 * 的，点出牌却说你没选牌」。状态只有一份，就不存在同步问题。
 */
export interface SelectionSource {
  /** 选牌变化时回调。挂上时不会立即触发。 */
  onSelectionChange(handler: (ids: readonly CardId[]) => void): void;
  /** 当前选中的牌 id，顺序跟手牌走。 */
  selection(): readonly CardId[];
  /** 切换一张仍在当前手牌中的牌，并立即同步视觉与上层按钮状态。 */
  toggleSelection(id: CardId): void;
  clearSelection(): void;
}
