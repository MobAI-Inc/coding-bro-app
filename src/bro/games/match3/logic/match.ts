/**
 * 消消乐规则引擎：匹配检测、消除、下落、补充、连锁。
 *
 * 三条设计约束，与内核契约（core/types.ts）一脉相承：
 *
 * 1. **纯函数、不可变。** 全部状态转换写成 `(state, action) => outcome`，
 *    不碰 DOM、不碰网络、不读时钟。原因不是洁癖：服务端要用同一份代码
 *    重放客户端的操作序列来验分，重放要求同一输入必然得到同一输出；
 *    任何隐藏状态（模块级变量、可变对象被就地改写）都会让重放漂移。
 *
 * 2. **随机只来自显式传入的 RNG 状态。** 见 rng.ts 开头。补充新元素是
 *    唯一的随机源，它的状态跟着 `Match3State` 走，因此对局快照足以完整
 *    还原后续所有补充。
 *
 * 3. **非法操作是正常流程。** 交换不合法时原样返回**同一个** state 对象
 *    （引用相等），调用方据此可以零成本跳过重绘与广播。这对应内核契约
 *    第三条：意图不是动作。
 */

import type { Cell, Grid, Pos, TileKind } from "./grid";
import {
  cellAt,
  inBounds,
  indexOf,
  isAdjacent,
  isFull,
  positionAt,
  posEquals,
  swapCells,
  withCells,
} from "./grid";
import type { RngState } from "./rng";
import { createRng, nextInt } from "./rng";

/** 构成一次消除所需的最小连续长度。三消之所以叫三消。 */
export const MIN_MATCH = 3;

/** 单个元素的基础分。连锁倍率在此之上叠乘，见 {@link scoreForStep}。 */
export const TILE_SCORE = 10;

/**
 * 单次结算允许的最大连锁层数。
 *
 * 这不是玩法规则，是防呆闸：若匹配检测与消除逻辑出现不一致（例如检测到
 * 匹配却没能清掉），结算循环会永不收敛，把服务端 worker 挂死。宁可抛错
 * 让这一局失败，也不能让一个 bug 拖垮整台机器。真实对局的连锁极少超过
 * 十层。
 */
export const MAX_CASCADE = 64;

/** 生成可玩盘面的最大重试次数。见 {@link createInitialState}。 */
export const MAX_GENERATE_ATTEMPTS = 64;

/** 盘面参数。 */
export interface Match3Config {
  readonly width: number;
  readonly height: number;
  /** 元素种类数。TUI 用 `◆▲●■★○` 呈现，故默认 6（UI-DESIGN.md §6.2）。 */
  readonly kinds: number;
}

/** 默认盘面：8×8 六种元素。 */
export const DEFAULT_CONFIG: Match3Config = { width: 8, height: 8, kinds: 6 };

/** 一组匹配：同一行或同一列上连续 ≥3 的同类元素。 */
export interface MatchGroup {
  readonly kind: TileKind;
  /** `row` = 横向匹配，`column` = 纵向匹配。 */
  readonly orientation: "row" | "column";
  readonly positions: readonly Pos[];
}

/** 连锁中的一层。 */
export interface CascadeStep {
  /** 层号，从 1 起。1 是交换直接造成的消除，≥2 是补充后自动触发的连锁。 */
  readonly chain: number;
  /** 本层检出的所有匹配组。L/T 形会同时出现横、纵两组。 */
  readonly groups: readonly MatchGroup[];
  /** 本层实际清除的格子，已按行主序去重——L 形的拐点不会被算两次。 */
  readonly cleared: readonly Pos[];
  readonly gained: number;
}

/**
 * 一局消消乐的完整状态。
 *
 * 直接作为内核 `GameState<T>` 的 `board` 下发。RNG 状态随之暴露给客户端
 * 是可接受的——同种子竞速下双方本就共享同一条补充序列，「提前知道下一
 * 个元素」对谁都一样。
 */
export interface Match3State {
  readonly config: Match3Config;
  readonly grid: Grid;
  readonly rng: RngState;
  readonly score: number;
  /** 已完成的合法交换次数。非法交换不计入。 */
  readonly moves: number;
}

/** 交换被拒绝的原因。分得细是为了让服务端能回具体提示而非一句「非法」。 */
export type SwapRejection =
  | "out_of_bounds"
  | "same_cell"
  | "not_adjacent"
  /** 相邻但交换后不产生任何匹配——按标准三消规则该交换回退。 */
  | "no_match";

/** 交换的结果。 */
export interface SwapOutcome {
  /** 被拒绝时为传入的原对象（引用相等），可用 `===` 判断盘面是否变过。 */
  readonly state: Match3State;
  readonly accepted: boolean;
  readonly rejection: SwapRejection | null;
  /** 连锁各层。被拒绝时为空数组。 */
  readonly steps: readonly CascadeStep[];
  /** 结算后是否因无子可动而重排了盘面。 */
  readonly reshuffled: boolean;
}


export type Match3Action = {
  readonly type: "swap";
  readonly a: Pos;
  readonly b: Pos;
};

/** 一次可行的交换。 */
export interface Move {
  readonly a: Pos;
  readonly b: Pos;
}

/**
 * 校验盘面参数。
 *
 * 三条下限都不是随意取的：宽高不足 3 则任何匹配都不可能形成；种类不足 3
 * 则初始盘面生成会走进死胡同——生成时最多需要同时排除「左边两个同类」
 * 与「上边两个同类」两种颜色，候选集必须还剩至少一个。
 */
function validateConfig(config: Match3Config): void {
  if (config.width < MIN_MATCH || config.height < MIN_MATCH) {
    throw new RangeError(`盘面至少 ${MIN_MATCH}×${MIN_MATCH}`);
  }
  if (config.kinds < MIN_MATCH) {
    throw new RangeError(
      `元素种类至少 ${MIN_MATCH} 种，否则无法生成无匹配盘面`,
    );
  }
}

/**
 * 扫描一条线（一行或一列）上的所有匹配。
 *
 * 传入的是坐标序列而非行列号，横向与纵向因此共用同一段游程扫描——两份
 * 几乎相同的循环最容易出现「改了横向忘了纵向」的偏差。
 */
function collectRuns(
  grid: Grid,
  line: readonly Pos[],
  orientation: MatchGroup["orientation"],
  out: MatchGroup[],
): void {
  let start = 0;
  for (let i = 1; i <= line.length; i++) {
    const prev = cellAt(grid, line[i - 1]);
    // 末尾用 null 作哨兵，让最后一段游程走同一条收尾分支
    const current = i < line.length ? cellAt(grid, line[i]) : null;
    if (current !== null && current === prev) continue;
    if (prev !== null && i - start >= MIN_MATCH) {
      out.push({ kind: prev, orientation, positions: line.slice(start, i) });
    }
    start = i;
  }
}

/**
 * 全盘扫描所有匹配组。
 *
 * 横向与纵向**分别**成组返回，而不是合并成一堆格子：L 形和 T 形一次消除
 * 同时构成横、纵两组，计分与特效都要知道「这是两组」而不只是「这是 5 个
 * 格子」。拐点格子只会被清除一次，去重在 {@link clearedPositions} 完成。
 *
 * 返回顺序固定为「先所有行、后所有列，各自从小到大」——顺序进了 CascadeStep
 * 就是要下发给客户端的数据，不确定的顺序会让同种子的两端渲染出不同动画。
 */
export function findMatches(grid: Grid): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (let row = 0; row < grid.height; row++) {
    const line: Pos[] = [];
    for (let col = 0; col < grid.width; col++) line.push({ row, col });
    collectRuns(grid, line, "row", groups);
  }
  for (let col = 0; col < grid.width; col++) {
    const line: Pos[] = [];
    for (let row = 0; row < grid.height; row++) line.push({ row, col });
    collectRuns(grid, line, "column", groups);
  }
  return groups;
}

/** 把若干匹配组摊平成去重后的待清除坐标，按行主序排列。 */
export function clearedPositions(
  grid: Grid,
  groups: readonly MatchGroup[],
): Pos[] {
  const indices = new Set<number>();
  for (const group of groups) {
    for (const p of group.positions) indices.add(indexOf(grid, p));
  }
  return [...indices].sort((x, y) => x - y).map((i) => positionAt(grid, i));
}

/**
 * 判断某格是否处在一段 ≥3 的同类游程中（横或纵）。
 *
 * 只看穿过该格的两条线，比全盘扫描快一个量级。用于交换合法性判定：
 * 交换只改动两个格子，新形成的匹配必然穿过其中之一，局部检查是完备的。
 * 连锁阶段不能用它——那时匹配可能出现在任何下落过的地方，必须全盘扫。
 */
export function hasMatchAt(grid: Grid, p: Pos): boolean {
  const kind = cellAt(grid, p);
  if (kind === null) return false;
  return (
    runLength(grid, p, kind, 0, 1) >= MIN_MATCH ||
    runLength(grid, p, kind, 1, 0) >= MIN_MATCH
  );
}

/** 沿给定方向双向延伸，统计包含 `p` 在内的同类游程长度。 */
function runLength(
  grid: Grid,
  p: Pos,
  kind: TileKind,
  dRow: number,
  dCol: number,
): number {
  let length = 1;
  for (const sign of [-1, 1]) {
    let row = p.row + dRow * sign;
    let col = p.col + dCol * sign;
    while (
      inBounds(grid, { row, col }) &&
      cellAt(grid, { row, col }) === kind
    ) {
      length++;
      row += dRow * sign;
      col += dCol * sign;
    }
  }
  return length;
}

/**
 * 交换这两格是否会产生匹配。不改变传入网格。
 *
 * 「交换后必须产生匹配，否则回退」是标准三消的核心规则，也是这款游戏
 * 唯一的策略深度来源——允许无意义交换等于允许玩家把盘面随意搓成想要的
 * 样子。
 */
export function wouldSwapMatch(grid: Grid, a: Pos, b: Pos): boolean {
  const swapped = swapCells(grid, a, b);
  return hasMatchAt(swapped, a) || hasMatchAt(swapped, b);
}

/** 枚举当前盘面上所有可行交换。 */
export function findAvailableMoves(grid: Grid): Move[] {
  const moves: Move[] = [];
  forEachCandidateSwap(grid, (a, b) => {
    if (wouldSwapMatch(grid, a, b)) moves.push({ a, b });
    return false;
  });
  return moves;
}

/** 盘面上是否还存在可行交换。命中即停，用于死局检测。 */
export function hasAvailableMove(grid: Grid): boolean {
  return forEachCandidateSwap(grid, (a, b) => wouldSwapMatch(grid, a, b));
}

/**
 * 遍历所有相邻格对，`visit` 返回 true 即提前结束。
 *
 * 每格只往右、往下各试一次：相邻关系是对称的，全方向遍历会把每对试两遍。
 */
function forEachCandidateSwap(
  grid: Grid,
  visit: (a: Pos, b: Pos) => boolean,
): boolean {
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const a = { row, col };
      if (col + 1 < grid.width && visit(a, { row, col: col + 1 })) return true;
      if (row + 1 < grid.height && visit(a, { row: row + 1, col })) return true;
    }
  }
  return false;
}

/** 把指定坐标清空为空洞。 */
export function clearCells(grid: Grid, positions: readonly Pos[]): Grid {
  return withCells(
    grid,
    positions.map((p) => [p, null] as const),
  );
}

/**
 * 下落：每列非空元素落到列底，空洞集中到列顶。
 *
 * 逐列重建而不是原地搬运：原地搬运需要同时维护读写两个游标，写指针追上
 * 读指针时会读到刚写过的值，是经典的越界一格错误。重建多分配一个小数组，
 * 换掉整类 bug。
 */
export function applyGravity(grid: Grid): Grid {
  const cells = grid.cells.slice();
  for (let col = 0; col < grid.width; col++) {
    const kept: Cell[] = [];
    for (let row = grid.height - 1; row >= 0; row--) {
      const value = cells[row * grid.width + col];
      if (value !== null) kept.push(value);
    }
    for (let row = grid.height - 1, k = 0; row >= 0; row--, k++) {
      cells[row * grid.width + col] = k < kept.length ? kept[k] : null;
    }
  }
  return { ...grid, cells };
}


export function refill(
  grid: Grid,
  rng: RngState,
  kinds: number,
): { grid: Grid; rng: RngState } {
  const cells = grid.cells.slice();
  let state = rng;
  for (let col = 0; col < grid.width; col++) {
    for (let row = 0; row < grid.height; row++) {
      const i = row * grid.width + col;
      if (cells[i] !== null) continue;
      const draw = nextInt(state, kinds);
      state = draw.state;
      cells[i] = draw.value;
    }
  }
  return { grid: { ...grid, cells }, rng: state };
}

/**
 * 本层连锁的得分。
 *
 * `消除数 × 基础分 × 层号`：层号直接做倍率，四层连锁的第四层单格值四倍。
 * 三消的乐趣在于布局引发的长连锁，线性倍率已足以让「摆连锁」优于「见三
 * 就消」；指数倍率会让单次爆发压过整局节奏，与限时竞速的定位不符。
 * L/T 形无需额外加成——它本来就多消了格子。
 */
export function scoreForStep(clearedCount: number, chain: number): number {
  return clearedCount * TILE_SCORE * chain;
}

/**
 * 反复「检测 → 消除 → 下落 → 补充」直到盘面稳定。
 *
 * 循环退出条件是全盘无匹配，因此返回的盘面对外总是稳定且填满的——渲染层
 * 拿到的永远是可交互状态，中间态只存在于 `steps` 里供播放动画。
 */
function cascade(
  config: Match3Config,
  startGrid: Grid,
  startRng: RngState,
  startScore: number,
): { grid: Grid; rng: RngState; score: number; steps: CascadeStep[] } {
  let grid = startGrid;
  let rng = startRng;
  let score = startScore;
  const steps: CascadeStep[] = [];

  for (let chain = 1; ; chain++) {
    const groups = findMatches(grid);
    if (groups.length === 0) break;
    if (chain > MAX_CASCADE) {
      throw new Error(`连锁超过 ${MAX_CASCADE} 层，疑似消除逻辑未收敛`);
    }

    const cleared = clearedPositions(grid, groups);
    const gained = scoreForStep(cleared.length, chain);
    score += gained;
    steps.push({ chain, groups, cleared, gained });

    grid = applyGravity(clearCells(grid, cleared));
    const filled = refill(grid, rng, config.kinds);
    grid = filled.grid;
    rng = filled.rng;
  }

  return { grid, rng, score, steps };
}

/**
 * 生成一个无既存匹配的盘面。
 *
 * 一次成型而非「随机填满后重试」：逐格填充时，把「会与左侧两格或上方两格
 * 凑成三连」的种类从候选中排除即可。任何三连都必然有一个最右/最下的收尾
 * 格，收尾格被堵死，三连就无从形成。重试法在种类少时可能要试很多轮，且
 * 轮数依赖随机结果，RNG 消耗量不可预测——对需要精确对齐序列的联机来说是
 * 额外的不确定性。
 *
 * 无论候选集剩几个，每格恰好消耗一次 RNG 取值，序列位置因此只与格数有关。
 */
export function generateBoard(
  config: Match3Config,
  rng: RngState,
): { grid: Grid; rng: RngState } {
  const { width, height, kinds } = config;
  const cells: Cell[] = new Array(width * height).fill(null);
  let state = rng;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const banned = new Set<TileKind>();
      if (col >= 2 && cells[i - 1] !== null && cells[i - 1] === cells[i - 2]) {
        banned.add(cells[i - 1] as TileKind);
      }
      if (
        row >= 2 &&
        cells[i - width] !== null &&
        cells[i - width] === cells[i - 2 * width]
      ) {
        banned.add(cells[i - width] as TileKind);
      }
      const candidates: TileKind[] = [];
      for (let k = 0; k < kinds; k++) {
        if (!banned.has(k)) candidates.push(k);
      }
      const draw = nextInt(state, candidates.length);
      state = draw.state;
      cells[i] = candidates[draw.value];
    }
  }

  return { grid: { width, height, cells }, rng: state };
}

/**
 * 生成既无既存匹配、又至少存在一个可行交换的盘面。
 *
 * 「至少一个可行交换」无法在逐格生成时廉价保证（它是全局性质），所以采用
 * 生成后检测、不合格就再生成一次的策略。重试沿用同一条 RNG 序列继续往下
 * 取值，不重置种子——重置会让两次尝试生成同一个死局，永远出不去。
 *
 * 达到 {@link MAX_GENERATE_ATTEMPTS} 仍失败则抛错。这在正常配置下不会发生
 * （8×8 六色的死局概率极低）；真发生说明配置本身病态（如 3×3 三色），而
 * 由于整个过程是确定的，同一份配置每次都会同样失败，属于可在配置阶段暴露
 * 的问题，不是运行期抖动。
 */
function generatePlayableBoard(
  config: Match3Config,
  rng: RngState,
): { grid: Grid; rng: RngState } {
  let state = rng;
  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const made = generateBoard(config, state);
    state = made.rng;
    if (hasAvailableMove(made.grid)) return { grid: made.grid, rng: state };
  }
  throw new Error(
    `连续 ${MAX_GENERATE_ATTEMPTS} 次未能生成可玩盘面，请检查盘面参数`,
  );
}

/**
 * 开局。
 *
 * 同一个 `seed` 与 `config` 必然得到完全相同的初始盘面与后续补充序列——
 * 这是异步竞速公平性的全部依据。种子由服务端按对局下发，字符串 matchId
 * 用 rng.ts 的 `hashSeed()` 转换。
 */
export function createInitialState(
  seed: number,
  config: Match3Config = DEFAULT_CONFIG,
): Match3State {
  validateConfig(config);
  const made = generatePlayableBoard(config, createRng(seed));
  return { config, grid: made.grid, rng: made.rng, score: 0, moves: 0 };
}

/**
 * 死局兜底：无可行交换时重排盘面。
 *
 * 重排采用「按当前 RNG 状态重新生成」而不是「打乱现有元素」。打乱要保持
 * 元素分布不变，而分布在同种子竞速里没有守恒意义（双方本就同分布）；重新
 * 生成能复用已经保证「无既存匹配 + 至少一个可行交换」的生成器，少一条需要
 * 单独验证的代码路径。
 */
export function ensurePlayable(state: Match3State): {
  state: Match3State;
  reshuffled: boolean;
} {
  if (hasAvailableMove(state.grid)) return { state, reshuffled: false };
  const made = generatePlayableBoard(state.config, state.rng);
  return {
    state: { ...state, grid: made.grid, rng: made.rng },
    reshuffled: true,
  };
}

/** 交换被拒绝时的统一返回：原状态原样返回，引用不变。 */
function reject(state: Match3State, rejection: SwapRejection): SwapOutcome {
  return { state, accepted: false, rejection, steps: [], reshuffled: false };
}

/**
 * 交换两个相邻元素，并结算由此引发的全部连锁。
 *
 * 合法性依次校验：在界内 → 不是同一格 → 四邻相接 → 交换后确实产生匹配。
 * 任一不满足即拒绝，`state` 原样返回（引用相等），盘面与分数纹丝不动。
 */
export function applySwap(state: Match3State, a: Pos, b: Pos): SwapOutcome {
  const { grid } = state;
  if (!inBounds(grid, a) || !inBounds(grid, b)) {
    return reject(state, "out_of_bounds");
  }
  if (posEquals(a, b)) return reject(state, "same_cell");
  if (!isAdjacent(a, b)) return reject(state, "not_adjacent");
  if (!wouldSwapMatch(grid, a, b)) return reject(state, "no_match");

  const settled = cascade(
    state.config,
    swapCells(grid, a, b),
    state.rng,
    state.score,
  );
  const playable = ensurePlayable({
    ...state,
    grid: settled.grid,
    rng: settled.rng,
    score: settled.score,
    moves: state.moves + 1,
  });

  return {
    state: playable.state,
    accepted: true,
    rejection: null,
    steps: settled.steps,
    reshuffled: playable.reshuffled,
  };
}

/**
 * 动作分发入口。
 *
 * 与内核契约对齐的唯一状态转换口：服务端收到 `InputIntent` 后转成
 * `Match3Action` 喂进来，客户端本地预演走同一个函数，两边逻辑不可能漂移。
 */
export function reduce(state: Match3State, action: Match3Action): SwapOutcome {
  switch (action.type) {
    case "swap":
      return applySwap(state, action.a, action.b);
    default: {
      const exhaustive: never = action.type;
      throw new Error(`未知动作: ${String(exhaustive)}`);
    }
  }
}

/**
 * 盘面是否处于合法的稳定态：填满、且无待消除的匹配。
 *
 * 服务端可用它做状态校验——收到客户端上报的盘面时先过一遍，不稳定的盘面
 * 说明对方少跑了结算或篡改过数据。
 */
export function isStable(grid: Grid): boolean {
  return isFull(grid) && findMatches(grid).length === 0;
}
