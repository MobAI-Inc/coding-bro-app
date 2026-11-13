/**
 * 台球的传输层视图。
 *
 * 服务端下发这个结构，不是 `EightBallState`。差别刻意：
 *
 * - `turn` 被删了。轮到谁由 `GameState.activeSeat` 表达，两处都存必然有一天
 *   对不上（围棋在 `toPlay` 与 `activeSeat` 上踩过）。
 * - 球位从定点数换成浮点。定点数是**演算**的要求（两端逐位一致），渲染不需要
 *   ——Canvas 的坐标本来就是浮点。在视图层换掉，渲染器就不必再引入 fixed.ts，
 *   也就不可能在渲染代码里手滑做定点数运算污染演算。
 * - 多了 `myGroup` / `targets` / `lastShot`。规则引擎不需要，界面需要。
 *
 * 单位：位置用**米**，与 table.ts 一致；布局层负责换算成像素。
 */

import type { GameState } from "../core/types";
import type { BallGroup, Foul } from "./logic/rules";
import type { StrikeParams } from "./logic/solver";

/** 一颗球在视图里的样子。 */
export interface BallView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly pocketed: boolean;
}

/** 上一杆的结果，用于结算提示与回放。 */
export interface ShotView {
  readonly foul: Foul | null;
  readonly pocketed: readonly number[];
  /** 击球方座位。提示语要说清是谁犯的规。 */
  readonly seat: number;
}

export interface BilliardsView {
  readonly balls: readonly BallView[];
  /** 64 fps authoritative samples for replaying the latest shot. */
  readonly motion?: readonly (readonly BallView[])[] | null;
  /** 本机座位的球组。台面开放时为 `null`。 */
  readonly myGroup: BallGroup | null;
  /** 本机这一杆的合法目标球。界面据此画瞄准提示。 */
  readonly targets: readonly number[];
  readonly ballInHand: boolean;
  readonly broken: boolean;
  readonly lastShot: ShotView | null;
  readonly winner: number | null;
}

export type BilliardsSnapshot = GameState<BilliardsView>;

/**
 * 击球意图。载荷就是 `StrikeParams` 本身。
 *
 * 这是「不传状态，传输入」的落地：客户端上报的是**这一杆怎么打**（角度、力度、
 * 塞点），不是「球滚到哪了」。服务端用同一套定点数解算器算出结果。载荷因此只有
 * 四个整数，且天然无法伪造球位。
 */
export type StrikePayload = StrikeParams;

/** 摆球意图。持球在手时用，坐标是米。 */
export interface PlacePayload {
  readonly x: number;
  readonly y: number;
}

export const BILLIARDS_INTENT = {
  strike: "billiards/strike",
  place: "billiards/place",
} as const;
