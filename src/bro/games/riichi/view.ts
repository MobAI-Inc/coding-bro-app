/**
 * 立直麻将的传输层视图。
 *
 * 服务端下发的是这个结构，不是 `RoundState`。差别不只是「少几个字段」——
 * 这里有一条硬约束：**别家的手牌不能下发**。
 *
 * 麻将与围棋、象棋不同：那两个游戏的全部信息都在明面上，视图删字段只是为了
 * 少传点东西；麻将删的是**对手的底牌**。把 `RoundState` 直接下发出去，装个
 * 抓包工具就能看穿三家手牌 —— 匹配制下对手是陌生人，这等于把作弊入口敞开。
 * 所以视图里别家只有「还剩几张」这个数字，牌本身连传都不传。
 *
 * 同理，牌山、王牌、里宝牌指示牌一律不下发。里宝牌只在终局那一刻随
 * `result` 一起给 —— 提前给出去，立直的人就能算出自己有没有里宝。
 */

import type { Meld, Tile136, Tile34 } from "./logic";
import type { RoundEndReason, RoundResult, Seat } from "./match/round";
import type { GameState } from "../core/types";

/** 别家的公开信息。手牌只给张数。 */
export interface OpponentView {
  readonly seat: Seat;
  /** 手牌张数。牌本身不下发。 */
  readonly handCount: number;
  readonly melds: readonly Meld[];
  readonly discards: readonly Tile136[];
  readonly points: number;
  readonly riichi: boolean;
}

/** 自己的信息。只有这一份带真手牌。 */
export interface SelfView {
  readonly seat: Seat;
  readonly hand: readonly Tile136[];
  readonly melds: readonly Meld[];
  readonly discards: readonly Tile136[];
  readonly points: number;
  readonly riichi: boolean;
  /** 刚摸进来的那张，界面据此把它单独摆在手牌右侧。 */
  readonly drawn: Tile136 | null;
  /** 现在能不能自摸。 */
  readonly canTsumo: boolean;
  /** 现在能不能荣和。 */
  readonly canRon: boolean;
  /** 能不能宣告立直。 */
  readonly canRiichi: boolean;
  /** 打哪些牌能保持听牌。界面标出来，不替玩家做决定。 */
  readonly tenpaiDiscards: readonly Tile136[];
  /** 听牌张。没听牌是空数组。 */
  readonly waits: readonly Tile34[];
  /** 是否振听。振听时界面要把「荣」按钮灰掉并说明原因。 */
  readonly furiten: boolean;
}

export interface RiichiView {
  readonly self: SelfView;
  /** 三个对手，按座位顺时针从自己的下家起。 */
  readonly opponents: readonly OpponentView[];
  /** 已翻开的宝牌指示牌。里宝牌不在这里 —— 终局才给。 */
  readonly doraIndicators: readonly Tile136[];
  /** 牌山剩余张数。 */
  readonly wallRemaining: number;
  readonly roundWind: Tile34;
  readonly dealer: Seat;
  readonly honba: number;
  readonly riichiSticks: number;
  /** 刚打出的那张，等待响应时有值。 */
  readonly lastDiscard: { readonly tile: Tile136; readonly from: Seat } | null;
  /** 终局结果。未终局为 null。 */
  readonly result: RoundResult | null;
  /** 终局时才下发的里宝牌指示牌。未终局为空数组。 */
  readonly uraDoraIndicators: readonly Tile136[];
}

export type RiichiSnapshot = GameState<RiichiView>;

/** 打牌意图。`riichi` 为真表示同时宣告立直。 */
export interface DiscardPayload {
  readonly tile: Tile136;
  readonly riichi?: boolean;
}

/** 立直麻将的四种意图。吃碰杠接上后在这里加。 */
export const RIICHI_INTENT = {
  discard: "riichi/discard",
  tsumo: "riichi/tsumo",
  ron: "riichi/ron",
  pass: "riichi/pass",
} as const;

/** 终局原因的中文说法。 */
export const END_REASON_TEXT: Record<RoundEndReason, string> = {
  tsumo: "自摸",
  ron: "荣和",
  exhaustive_draw: "荒牌流局",
};
