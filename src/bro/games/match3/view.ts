

import type { Grid, Pos, TileKind } from "./logic";

import type { GameState } from "../core/types";

/** 玩家座位号。单人闯关，没有第二个座位，也没有对手。 */
export const SEAT_PLAYER = 0;


export const DEFAULT_MOVE_LIMIT = 25;


export const DEFAULT_TARGET_SCORE = 2600;

/** 一局的目标口径。服务端下发，客户端不可协商。 */
export interface Match3Goal {
  readonly moveLimit: number;
  readonly targetScore: number;
}

export const DEFAULT_GOAL: Match3Goal = {
  moveLimit: DEFAULT_MOVE_LIMIT,
  targetScore: DEFAULT_TARGET_SCORE,
};

/** 终局判定。只有这两种，没有「进行中」——进行中就是 `outcome === null`。 */
export type Match3Verdict = "cleared" | "failed";

/** 终局结算。积分入账读的是这个结构，不是 `score` 本身。 */
export interface Match3Outcome {
  readonly verdict: Match3Verdict;
  readonly score: number;
  readonly targetScore: number;
  readonly movesUsed: number;
  /** 全局最高连锁层数。展示用，不参与判定。 */
  readonly bestChain: number;
}

/**
 * 连锁中的一层，剪裁成渲染层要用的部分。
 *
 * `chain` 既是层号也是倍率（引擎口径）。渲染层显示「×3」用的就是它，
 * 不必知道 `gained = 消除数 × 基础分 × 层号` 这条公式。
 */
export interface Match3Step {
  readonly chain: number;
  /** 本层清掉的格子。动画照着它放消除特效。 */
  readonly cleared: readonly Pos[];
  readonly gained: number;
  /** 本层的匹配组数。L/T 形一次算两组，展示「几连」时要用。 */
  readonly groups: number;
}

export interface Match3View {
  readonly width: number;
  readonly height: number;
  /** 元素种类数。渲染层据此决定用几种形状/字符，不写死 6。 */
  readonly kinds: number;
  /**
   * 行主序展开的盘面，长度 width×height。
   *
   * 类型是 `TileKind` 而不是引擎的 `Cell`（可为 `null`）：对外可见的盘面
   * 永远是稳定态，空洞只存在于结算过程中。渲染层因此不必处理空格。
   * 这个收窄由 {@link viewCellsOf} 在服务端出口处把关。
   */
  readonly cells: readonly TileKind[];
  readonly score: number;
  readonly targetScore: number;
  readonly movesUsed: number;
  readonly moveLimit: number;
  /**
   * 本局种子。
   *
   * 下发它不是为了让客户端自己生成盘面——盘面由服务端算好下发。它是**存证**：
   * 玩家申诉「这局是不是坑我」时，服务端凭 `matchId + seed` 能一格不差地复现
   * 整局。客户端拿它只做展示。
   */
  readonly seed: number;
  /** 最近一次成功交换的两格。渲染层据此高亮起手位置。 */
  readonly lastSwap: readonly [Pos, Pos] | null;
  /** 最近一次交换引发的全部连锁层。空数组表示还没走过一步。 */
  readonly steps: readonly Match3Step[];
  /** 本局至今的最高连锁层数。 */
  readonly bestChain: number;
  /** 最近一次交换后是否因死局而重排了盘面。要提示玩家，否则盘面凭空全变很吓人。 */
  readonly reshuffled: boolean;
  /** 终局结算。未终局为 `null`。 */
  readonly outcome: Match3Outcome | null;
}

export type Match3Snapshot = GameState<Match3View>;

/** 交换意图的载荷。两个坐标由客户端给，合法性由服务端裁定。 */
export interface SwapPayload {
  readonly a: Pos;
  readonly b: Pos;
}

/**
 * 消消乐只有一种意图。
 *
 * 注意这里**没有** `restart` / `reseed` 之类的意图：重开一局意味着重新付
 * 入场费，那是大厅的事，不是对局内的操作。把重开做成对局内意图，等于给了
 * 玩家一个免费重摇盘面的按钮。
 */
export const MATCH3_INTENT = {
  swap: "match3/swap",
} as const;

/** 剩余步数。由 `moveLimit - movesUsed` 现算，不在视图里存第二份。 */
export function movesLeft(view: Match3View): number {
  return Math.max(0, view.moveLimit - view.movesUsed);
}

/** 本次交换的总得分。连锁各层之和，界面上那个「+240」用的就是它。 */
export function totalGained(steps: readonly Match3Step[]): number {
  return steps.reduce((sum, step) => sum + step.gained, 0);
}

/**
 * 目标完成度，`[0, 1]`。
 *
 * 上限截到 1：进度条不能画出格子，而超额得分在「通关即终局」的口径下
 * 也不产生额外意义。
 */
export function goalProgress(view: Match3View): number {
  if (view.targetScore <= 0) return 1;
  return Math.min(1, view.score / view.targetScore);
}

/**
 * 把引擎网格收窄成视图盘面。
 *
 * 遇到空洞直接抛错而不是填个默认值：稳定盘面出现 `null` 意味着结算循环
 * 少跑了一轮（或者哪次改动漏了补充），那是会让分数算错的 bug。静默填补
 * 会把它变成「偶尔某格显示怪怪的」，几乎不可能被归因。
 */
export function viewCellsOf(grid: Grid): TileKind[] {
  return grid.cells.map((cell, index) => {
    if (cell === null) {
      throw new Error(`盘面第 ${index} 格为空洞，说明结算未收敛`);
    }
    return cell;
  });
}
