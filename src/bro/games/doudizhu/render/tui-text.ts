

import type { Bid, Card, CardId } from "../logic";
import { RANK_JOKER_BIG, canPass, formatCards, isValidBid } from "../logic";
import type { DoudizhuView } from "../view";
import { bidOfSeat, slotOfSeat } from "../view";
import {
  SELECTION_TEXT,
  cardsByIds,
  checkSelection,
  patternToBeat,
} from "./selection";

/** 花色字符。花色本身就是区分标志，不靠颜色（UI-DESIGN.md §9）。 */
export const SUIT_GLYPH = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
} as const;

/** 王没有花色，用汉字直说，比任何符号都不容易认错。 */
export const JOKER_LABEL = { small: "小王", big: "大王" } as const;

/** 行动中/待机的标记。同宽的一对字符，行首对齐不受字体影响。 */
export const TURN_GLYPH = { active: "●", idle: "○" } as const;

/**
 * 一张牌的字符表示。
 *
 * 点数复用规则引擎的 {@link formatCards}，不另立一张点数表——两张表迟早
 * 会分叉，而分叉的表现是「界面上显示的牌和实际出的牌不是同一张」。
 */
export function cardLabel(card: Card): string {
  const suit = card.suit;
  // suit 为 null 是王的唯一特征，比按 rank 判断少一个魔数
  if (suit === null) {
    return card.rank === RANK_JOKER_BIG ? JOKER_LABEL.big : JOKER_LABEL.small;
  }
  return `${SUIT_GLYPH[suit]}${formatCards([card])}`;
}

/** 一串牌。空串返回空字符串，由调用方决定说什么。 */
export function cardsLabel(cards: readonly Card[]): string {
  return cards.map(cardLabel).join(" ");
}

/** 座位在画面上的说法。 */
const SLOT_TEXT = { self: "本家", left: "上家", right: "下家" } as const;

/**
 * 一家的状态行。
 *
 * 叫分阶段显示叫了几分，出牌阶段显示本轮出了什么。两个阶段是两套信息，
 * 混在一行里说会同时显示「叫 2 分」和「不要」，玩家读不出现在在干嘛。
 */
export function renderSeatLine(
  view: DoudizhuView,
  seat: number,
  anchor: number | null,
  activeSeat: number | null,
): string {
  const seatView = view.seats[seat];
  const marker = seat === activeSeat ? TURN_GLYPH.active : TURN_GLYPH.idle;
  const role = seatView.isLandlord
    ? "地主"
    : view.landlord === null
      ? "待定"
      : "农民";
  const head = `${marker} ${SLOT_TEXT[slotOfSeat(seat, anchor)]} ${role} ${seatView.cardsLeft} 张`;

  if (view.stage === "bidding") {
    const bid = bidOfSeat(view, seat);
    if (bid === null) return head;
    return `${head} · ${bid === 0 ? "不叫" : `叫 ${bid} 分`}`;
  }

  const action = seatView.lastAction;
  if (action === null) return head;
  return action.kind === "pass"
    ? `${head} · 不要`
    : `${head} · 出 ${cardsLabel(action.cards)}`;
}

/** 底牌行。亮牌前只说张数——说了张数以外的任何东西都是泄底。 */
export function renderBottomLine(view: DoudizhuView): string {
  const { count, cards } = view.bottom;
  return cards === null
    ? `底牌 ${count} 张 · 未亮`
    : `底牌 ${cardsLabel(cards)}`;
}

/** 出牌区。自由出牌时说清楚「该谁领出」，否则玩家会一直等上家。 */
export function renderTrickLine(
  view: DoudizhuView,
  anchor: number | null,
): string {
  if (view.stage === "bidding") return "叫地主中";
  if (view.toBeat === null) return "新一轮 · 由本轮先手领出";
  const who = SLOT_TEXT[slotOfSeat(view.toBeat.seat, anchor)];
  return `待压 ${cardsLabel(view.toBeat.cards)}（${who}）`;
}

/** 当前可以叫的分。3 分封顶后返回空数组，界面据此收起叫分键。 */
export function availableBids(view: DoudizhuView): Bid[] {
  return ([0, 1, 2, 3] as const).filter((bid) => isValidBid(view.bids, bid));
}

/**
 * 底部状态栏。
 *
 * UI-DESIGN.md §6.3 的硬性要求：**列出的快捷键必须与当前真正生效的完全
 * 一致**。所以这里把每一个键都过一遍条件：
 *
 * - 叫分键只列 `isValidBid` 认的那几个（别人叫了 2，你就只能叫 3）
 * - `Enter 出牌` 只在当前选牌真的能出的时候才列
 * - `p 不出` 只在 `canPass` 为真时才列——自己领出的那一轮不能过
 *
 * 少了这些条件，状态栏会写着「Enter 出牌」而按下去毫无反应，玩家只会
 * 以为程序卡了。
 */
export function renderStatusBar(
  view: DoudizhuView,
  canAct: boolean,
  selection: readonly CardId[],
): string {
  const info = statusInfo(view);

  if (view.stage === "over") {
    return `${info} · ${renderResultLine(view)} · q 退出`;
  }
  if (!canAct) return `${info} · 等待其他玩家 · q 退出`;

  if (view.stage === "bidding") {
    const bids = availableBids(view);
    const call = bids.filter((b) => b > 0);
    const keys = [
      call.length > 0 ? `${call.join("/")} 叫分` : null,
      bids.includes(0) ? "0 不叫" : null,
    ].filter((k): k is string => k !== null);
    return `${info} · ${keys.join(" · ")} · q 退出`;
  }

  const toBeat = patternToBeat(view);
  const picked = cardsByIds(view.hand, selection);
  const verdict = checkSelection(picked, toBeat);

  const keys = [
    view.hand.length > 0 ? "h/l 选牌 · 空格 选中" : null,
    verdict.ok ? "Enter 出牌" : null,
    canPass(toBeat) ? "p 不出" : null,
    picked.length > 0 ? "Esc 清空" : null,
    "q 退出",
  ].filter((k): k is string => k !== null);

  const hint =
    !verdict.ok && verdict.problem !== "empty"
      ? ` · ${SELECTION_TEXT[verdict.problem]}`
      : "";

  return `${info} · ${keys.join(" · ")}${hint}`;
}

/** 局面信息段：手上几张、底分多少、倍数多少。 */
function statusInfo(view: DoudizhuView): string {
  const parts = [`手牌 ${view.hand.length} 张`];
  if (view.bid !== null) parts.push(`底分 ${view.bid}`);
  if (view.multiplier !== null) parts.push(`倍数 ${view.multiplier}`);
  if (view.bombs > 0 || view.rocket) {
    parts.push(`炸 ${view.bombs + (view.rocket ? 1 : 0)}`);
  }
  return parts.join(" · ");
}

/** 终局一句话。没有结果时返回空串，调用方不该走到这里。 */
export function renderResultLine(view: DoudizhuView): string {
  const result = view.result;
  if (result === null) return "";
  const side = result.winnerSide === "landlord" ? "地主胜" : "农民胜";
  const spring =
    result.spring === "landlord"
      ? " · 春天"
      : result.spring === "farmer"
        ? " · 反春"
        : "";
  return `${side} · ${result.multiplier} 倍${spring}`;
}
