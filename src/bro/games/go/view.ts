/**
 * 围棋的传输层视图。
 *
 * 服务端下发的是这个结构，不是 `GoState`。两者刻意不同：
 *
 * - `GoState.toPlay` 被删掉了。轮到谁由 `GameState.activeSeat` 表达，
 *   座位号才是内核认识的概念。两处都存「该谁走」必然有一天对不上。
 * - 多了 `lastMove` 与 `score`。规则引擎不需要它们，渲染层需要——
 *   最后一手的标记和终局比分是显示用的，不参与裁定。
 *
 * 座位与颜色的映射固定：0 号座黑先，1 号座白后。
 */

import type { BoardSize, Player, Score, Stone } from "./logic";
import { BLACK, WHITE } from "./logic";
import type { GameState } from "../core/types";

/** 黑棋的座位号。围棋只有两个座位，黑先。 */
export const SEAT_BLACK = 0;
/** 白棋的座位号。 */
export const SEAT_WHITE = 1;

export interface GoView {
  readonly size: BoardSize;
  /** 按行主序排列的交叉点。长度为 size²。 */
  readonly cells: readonly Stone[];
  /** 当前劫点，渲染层据此把该点画成禁着。 */
  readonly koPoint: number | null;
  readonly captures: { readonly black: number; readonly white: number };
  /** 最后一手的落点，用于标记。虚手或开局为 `null`。 */
  readonly lastMove: number | null;
  /** 连续虚手数。界面据此提示「对方虚手，再虚一手即终局」。 */
  readonly passes: number;
  /** 终局比分。未终局为 `null`。 */
  readonly score: Score | null;
}

export type GoSnapshot = GameState<GoView>;

/** 座位号转棋色。 */
export function playerOfSeat(seat: number): Player {
  return seat === SEAT_BLACK ? BLACK : WHITE;
}

/** 棋色转座位号。 */
export function seatOfPlayer(player: Player): number {
  return player === BLACK ? SEAT_BLACK : SEAT_WHITE;
}

/** 落子意图。`index` 是交叉点下标，非行列——与棋盘内部表示一致，少一次转换。 */
export interface PlacePayload {
  readonly index: number;
}

/** 围棋的两种意图类型。 */
export const GO_INTENT = {
  place: "go/place",
  pass: "go/pass",
} as const;
