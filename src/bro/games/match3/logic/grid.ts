/**
 * 消消乐网格表示与坐标工具。
 *
 * 两个贯穿全模块的选择，先说清楚原因：
 *
 * 1. **一维行主序数组，而非二维数组。** 不可变更新是这套引擎的硬约束
 *    （见 match.ts），一维数组复制只需一次 `slice()`；二维数组必须逐行
 *    复制，一旦漏掉某行，两个「不同」的盘面就会共享同一个行引用——改 A
 *    影响 B。这类隐式共享在确定性系统里最难查：症状是「同种子偶尔不一
 *    致」，而复现要靠特定的消除顺序。结构上堵死它比靠自觉便宜。
 *
 * 2. **元素类型是数字而不是 `◆▲●■★○` 字符。** 逻辑层不认识符号——符号
 *    是渲染层的事（UI-DESIGN.md §6.2 的 TUI 字符表只是六种渲染，不是六
 *    种元素）。数字还让 PRNG 取值退化成一次取模，无需查表。
 */

/** 元素种类。取值 `0 .. kinds-1`，含义由渲染层决定。 */
export type TileKind = number;

/**
 * 格子内容。`null` 表示空洞。
 *
 * 空洞只在「消除后、补充前」这一瞬存在。对外可见的稳定盘面永远是满的，
 * 因此渲染层不需要处理空格——它只在下落动画的中间帧里出现。
 */
export type Cell = TileKind | null;

/** 坐标。`row` 自上而下、`col` 自左而右，均从 0 起。 */
export interface Pos {
  readonly row: number;
  readonly col: number;
}

/**
 * 网格。
 *
 * `cells` 行主序展开：`index = row * width + col`。整个对象被视为不可变，
 * 任何「修改」都返回新对象。
 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Cell[];
}

/** 构造坐标。纯粹为了让调用处比对象字面量短。 */
export function pos(row: number, col: number): Pos {
  return { row, col };
}

/** 坐标是否落在网格内。 */
export function inBounds(grid: Grid, p: Pos): boolean {
  return p.row >= 0 && p.row < grid.height && p.col >= 0 && p.col < grid.width;
}

/** 坐标转一维下标。不校验边界，调用方需先过 {@link inBounds}。 */
export function indexOf(grid: Grid, p: Pos): number {
  return p.row * grid.width + p.col;
}

/** 一维下标转坐标。 */
export function positionAt(grid: Grid, index: number): Pos {
  return { row: Math.floor(index / grid.width), col: index % grid.width };
}

/**
 * 读取格子内容。
 *
 * 越界抛 `RangeError` 而不是返回 `null`：`null` 已经表示「空洞」，用它
 * 兼表「不存在」会让匹配扫描把界外当成空格静默吞掉——那是一类不会报错、
 * 只会算错分的 bug。
 */
export function cellAt(grid: Grid, p: Pos): Cell {
  if (!inBounds(grid, p)) {
    throw new RangeError(`坐标越界: (${p.row}, ${p.col})`);
  }
  return grid.cells[indexOf(grid, p)];
}

/** 按下标函数生成网格。 */
export function createGrid(
  width: number,
  height: number,
  fill: (p: Pos) => Cell,
): Grid {
  const cells: Cell[] = new Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      cells[row * width + col] = fill({ row, col });
    }
  }
  return { width, height, cells };
}

/**
 * 批量写入并返回新网格。原网格不变。
 *
 * 做成批量而非单格：一次消除动辄改十几格，逐格调用会产生十几个中间数组，
 * 且每个中间态都是「消了一半」的非法盘面，调试时极易被误读。
 */
export function withCells(
  grid: Grid,
  updates: Iterable<readonly [Pos, Cell]>,
): Grid {
  const cells = grid.cells.slice();
  for (const [p, value] of updates) {
    cells[indexOf(grid, p)] = value;
  }
  return { ...grid, cells };
}

/** 交换两格，返回新网格。 */
export function swapCells(grid: Grid, a: Pos, b: Pos): Grid {
  return withCells(grid, [
    [a, cellAt(grid, b)],
    [b, cellAt(grid, a)],
  ]);
}

/** 两个坐标是否相同。 */
export function posEquals(a: Pos, b: Pos): boolean {
  return a.row === b.row && a.col === b.col;
}

/** 是否四邻相接（曼哈顿距离为 1）。对角线不算相邻。 */
export function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

/** 网格是否已填满（无空洞）。稳定盘面必须满足。 */
export function isFull(grid: Grid): boolean {
  return grid.cells.every((c) => c !== null);
}

/** 从二维行数组构造网格。用于测试夹具与盘面反序列化。 */
export function gridFromRows(rows: readonly (readonly Cell[])[]): Grid {
  const height = rows.length;
  const width = height === 0 ? 0 : rows[0].length;
  if (rows.some((r) => r.length !== width)) {
    throw new Error("每行长度必须一致");
  }
  return { width, height, cells: rows.flat() };
}

/** 导出为二维行数组。用于断言与序列化，逻辑内部不使用。 */
export function gridToRows(grid: Grid): Cell[][] {
  const rows: Cell[][] = [];
  for (let row = 0; row < grid.height; row++) {
    rows.push(grid.cells.slice(row * grid.width, (row + 1) * grid.width));
  }
  return rows;
}

/** 逐格比较两个网格。同种子竞速的一致性校验靠它。 */
export function gridEquals(a: Grid, b: Grid): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  return a.cells.every((cell, i) => cell === b.cells[i]);
}
