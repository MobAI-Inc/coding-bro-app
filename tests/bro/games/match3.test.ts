/**
 * 消消乐规则引擎测试。
 *
 * 权重最高的一组是「确定性」——同种子异步竞速（OSS-REUSE.md §7）里，两名
 * 玩家拿到的初始盘面与补充序列必须逐格相同，否则比分不可比，玩法本身不
 * 成立。其余用例围绕三消的四类规则边界：同时横竖匹配、交换合法性、下落、
 * 连锁计数。
 */

import { describe, expect, it } from "vitest";
import type {
  Cell,
  Grid,
  Match3Action,
  Match3State,
} from "@/bro/games/match3/logic";
import {
  DEFAULT_CONFIG,
  TILE_SCORE,
  applyGravity,
  applySwap,
  cellAt,
  clearCells,
  clearedPositions,
  createInitialState,
  createRng,
  ensurePlayable,
  findAvailableMoves,
  findMatches,
  gridEquals,
  gridFromRows,
  gridToRows,
  hasAvailableMove,
  hashSeed,
  isFull,
  isStable,
  nextFloat,
  nextInt,
  nextUint32,
  pos,
  posEquals,
  reduce,
  refill,
  scoreForStep,
} from "@/bro/games/match3/logic";

/** 夹具里的字符与元素种类一一对应，`.` 为空洞。字符只是可读性，不进逻辑。 */
const SYMBOLS = "ABCDEF";

/** 用字符行构造网格，让夹具在源码里就长得像盘面。 */
function board(rows: readonly string[]): Grid {
  return gridFromRows(
    rows.map((row) =>
      [...row.replace(/ /g, "")].map<Cell>((ch) => {
        if (ch === ".") return null;
        const kind = SYMBOLS.indexOf(ch);
        if (kind < 0) throw new Error(`未知元素字符: ${ch}`);
        return kind;
      }),
    ),
  );
}

/** 网格转回字符行，断言失败时能直接看出盘面差在哪。 */
function show(grid: Grid): string[] {
  return gridToRows(grid).map((row) =>
    row.map((cell) => (cell === null ? "." : SYMBOLS[cell])).join(""),
  );
}

/** 把夹具网格包成完整状态。`kinds` 取 5，覆盖 A~E。 */
function stateOf(grid: Grid, seed = 1): Match3State {
  return {
    config: { width: grid.width, height: grid.height, kinds: 5 },
    grid,
    rng: createRng(seed),
    score: 0,
    moves: 0,
  };
}

/**
 * 连锁夹具。
 *
 * 交换 (0,2)A 与 (1,2)D 后 row1 变成 `B A A A B`，横向三连；清掉 (1,1..3)
 * 后 col1 的 `C` 从 row0 落下，与下方两个 `C` 接上，触发第二层连锁。
 *
 * 注意第二层的**规模**是随补充结果变的：seed=1 时顶上补进来的又是一个 `C`，
 * 于是第二层实际清的是四连而不是三连。凡是断言第二层坐标或分数的用例，都
 * 隐含钉住了 seed=1 这条补充序列，换种子就要重算——不要把它们当成与 RNG
 * 无关的纯规则断言。
 */
const CASCADE_BOARD = ["BCAED", "BADAB", "ACBCE", "ECDBA", "CBEDC"];

/**
 * 纵向合法交换夹具。
 *
 * 把 (1,0) 的 `C` 横着换进 (1,1)，col1 的 row1~3 接成 `C C C`；row1 换完是
 * `E C D A B`，没有任何横向游程。唯一的匹配是纵向的。
 */
const VERTICAL_ONLY_BOARD = ["ABDEA", "CEDAB", "BCADE", "DCEAB", "ABDEC"];

describe("确定性 — 同种子异步竞速的前提", () => {
  /** 用固定策略（永远选第一个可行交换）走完整流程，操作序列也由盘面唯一决定。 */
  function playout(seed: number, moveCount: number) {
    let state = createInitialState(seed);
    const log: string[] = [];
    for (let i = 0; i < moveCount; i++) {
      const moves = findAvailableMoves(state.grid);
      expect(moves.length).toBeGreaterThan(0);
      const outcome = applySwap(state, moves[0].a, moves[0].b);
      expect(outcome.accepted).toBe(true);
      log.push(`${outcome.steps.length}/${outcome.state.score}`);
      state = outcome.state;
    }
    return { state, log };
  }

  it("同种子跑两遍完整流程 — 盘面逐格相同，分数与补充序列也相同", () => {
    const first = playout(20260820, 25);
    const second = playout(20260820, 25);

    expect(show(first.state.grid)).toEqual(show(second.state.grid));
    expect(first.state.score).toBe(second.state.score);
    // RNG 状态相同 => 之后每一次补充都会取到同一个元素
    expect(first.state.rng).toBe(second.state.rng);
    // 每一步的连锁层数与累计分都对得上，而不只是终局凑巧一致
    expect(first.log).toEqual(second.log);
    expect(first.state.score).toBeGreaterThan(0);
  });

  it("不同种子给出不同盘面", () => {
    const a = createInitialState(1);
    const b = createInitialState(2);
    expect(gridEquals(a.grid, b.grid)).toBe(false);
  });

  it("同一 matchId 字符串推出同一盘面", () => {
    const seed = hashSeed("match-7f3a91");
    expect(hashSeed("match-7f3a91")).toBe(seed);
    expect(hashSeed("match-7f3a92")).not.toBe(seed);
    expect(show(createInitialState(seed).grid)).toEqual(
      show(createInitialState(hashSeed("match-7f3a91")).grid),
    );
  });

  it("同一状态重复结算得到同一结果 — 状态转换是纯函数", () => {
    const state = stateOf(board(CASCADE_BOARD));
    const before = show(state.grid);

    const first = applySwap(state, pos(0, 2), pos(1, 2));
    const second = applySwap(state, pos(0, 2), pos(1, 2));

    expect(show(first.state.grid)).toEqual(show(second.state.grid));
    expect(first.state.score).toBe(second.state.score);
    expect(first.steps.length).toBe(second.steps.length);
    // 传入的 state 没有被就地改写
    expect(show(state.grid)).toEqual(before);
    expect(state.score).toBe(0);
  });

  it("补充序列可复现 — 同样的空洞与同样的 RNG 状态填出同样的元素", () => {
    const holed = board(["..A", ".BC", "DEF"]);
    const first = refill(holed, createRng(99), 6);
    const second = refill(holed, createRng(99), 6);

    expect(show(first.grid)).toEqual(show(second.grid));
    expect(first.rng).toBe(second.rng);
    expect(isFull(first.grid)).toBe(true);
    // 已有元素不被覆盖
    expect(show(first.grid)[2]).toBe("DEF");
  });
});

describe("跨实现一致性 — 协议级黄金向量", () => {
  /*
   * 这一组锁的不是「实现自洽」，而是「换一种语言重写也要一模一样」。同种子
   * 竞速的公平性最终落在这里：服务端若改用 Go/Rust 重写结算，这些向量就是
   * 对表口径。改 PRNG 算法、改补充遍历顺序、改生成顺序都会让它们失败——那
   * 时该做的是同步升协议版本，而不是顺手把期望值改掉。
   */

  it("mulberry32 输出与公开参考实现逐位一致", () => {
    let state = createRng(1);
    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      const draw = nextUint32(state);
      state = draw.state;
      values.push(draw.value);
    }
    expect(values).toEqual([2693262067, 11749833, 2265367787, 4213581821]);
  });

  it("补充按「先列后行」消耗随机序列", () => {
    // 改成先行后列的话，同一批空洞会拿到序列里不同位置的值，这行期望即失守
    const filled = refill(board(["..A", ".BC", "DEF"]), createRng(99), 6);
    expect(show(filled.grid)).toEqual(["AEA", "BBC", "DEF"]);
  });

  it("初始盘面生成顺序固定", () => {
    expect(show(createInitialState(20260820).grid)).toEqual([
      "CBFBEDFC",
      "CCDACFAB",
      "AFFAFEDD",
      "DEABFCEF",
      "ABAFBBEB",
      "ABFFADBF",
      "DCCACDAD",
      "EEFBFAAE",
    ]);
    expect(
      show(createInitialState(7, { width: 5, height: 4, kinds: 4 }).grid),
    ).toEqual(["ACCDD", "ABDBA", "CDCAB", "BCCBA"]);
  });

  it("一次交换的完整结算结果 — 消除、下落、补充的合成顺序被钉死", () => {
    /*
     * 单独测下落、单独测补充都盖不住这三步的**合成**。把 `applyGravity` 与
     * `clearCells` 的调用顺序对调（先落后清，元素原地悬空等着被补掉）之后，
     * 连锁层数、每层分数、最终稳定性全都不变，只有逐格比对才看得出来。
     *
     * 期望值是照着协议自己推的，不是从实现里抄的：seed=1 的 mulberry32 前
     * 七个输出对 5 取模是 [2,3,2,1,3,2,4]，即 C D C B D C E。第一层清掉
     * row1 的 `A A A`，col1~col3 各落一格，顶上三个空洞按「先列后行」依次
     * 补 C D C；col1 因此接成 `C C C C` 四连，第二层清掉它，再补 B D C E。
     * 全程恰好补了 7 格，所以 RNG 正好从 1 走到第七步的状态。
     */
    const before = stateOf(board(CASCADE_BOARD));
    const outcome = applySwap(before, pos(0, 2), pos(1, 2));

    expect(show(outcome.state.grid)).toEqual([
      "BBDCD",
      "BDDEB",
      "ACBCE",
      "EEDBA",
      "CBEDC",
    ]);
    expect(outcome.steps.map((s) => s.gained)).toEqual([30, 80]);
    expect(outcome.state.score).toBe(110);
    // 补了 7 格就该消耗 7 个随机数，且新状态必须回写进 state——不回写的话
    // 下一步交换会重放同一串补充，两端盘面从第二步起就分叉。
    expect(outcome.state.rng).toBe(4231026100);
    expect(outcome.state.rng).not.toBe(before.rng);
  });
});

describe("PRNG", () => {
  it("同一状态取值结果相同 — 状态外置，不藏可变闭包", () => {
    const state = createRng(7);
    expect(nextUint32(state)).toEqual(nextUint32(state));
  });

  it("状态推进后序列不重复", () => {
    let state = createRng(7);
    const values: number[] = [];
    for (let i = 0; i < 5; i++) {
      const draw = nextUint32(state);
      state = draw.state;
      values.push(draw.value);
    }
    expect(new Set(values).size).toBe(5);
  });

  it("相邻种子给出不同序列", () => {
    expect(nextUint32(createRng(1)).value).not.toBe(
      nextUint32(createRng(2)).value,
    );
  });

  it("nextFloat 落在 [0,1)", () => {
    let state = createRng(123);
    for (let i = 0; i < 200; i++) {
      const draw = nextFloat(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      state = draw.state;
    }
  });

  it("nextInt 覆盖全部取值且分布大致均匀", () => {
    let state = createRng(4242);
    const buckets = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const draw = nextInt(state, 6);
      buckets[draw.value]++;
      state = draw.state;
    }
    // 只挡「永远返回 0」「只返回两三种」这类坏实现，不做统计学检验
    for (const count of buckets) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it("非法上界报错", () => {
    expect(() => nextInt(createRng(1), 0)).toThrow(RangeError);
  });

  it("hashSeed 与 FNV-1a 32 位公开测试向量逐位对齐", () => {
    // 只测「同串同值、异串异值」的话，换掉 FNV 质数、换掉偏移基数、漏掉无
    // 符号截断，三种改法全都测不出来——本实现自洽，只是跟别的语言算出来的
    // 不是同一个数。matchId → 种子这一步一旦跨端不一致，两名玩家会各自开出
    // 一副毫不相干的盘面，而两边都认为自己是对的。
    expect(hashSeed("")).toBe(0x811c9dc5);
    // 这两个向量都超过 2^31，顺带钉住「返回 uint32 而非有符号数」
    expect(hashSeed("a")).toBe(3826002220);
    expect(hashSeed("foobar")).toBe(3214735720);
    expect(hashSeed("match-7f3a91")).toBe(1325673570);
  });
});

describe("网格不变式 — 服务端校验的底座", () => {
  it("有空洞的盘面不是稳定态", () => {
    // isStable 是服务端收到对局上报盘面时的第一道闸：不稳定 = 对方少跑了
    // 结算或改过数据。isFull 若写反（every 写成 some），带空洞的半成品盘面
    // 会被当成合法结算结果放行，而后续所有校验都建立在这个前提上。
    const holed = board(["AB.", "CDE", "FAB"]);
    expect(isFull(holed)).toBe(false);
    expect(isStable(holed)).toBe(false);
  });

  it("填满但还有待消除匹配的盘面也不是稳定态", () => {
    expect(isStable(board(["AAAB", "BCDE", "CDEA", "DEAB"]))).toBe(false);
  });

  it("越界读格子抛错，而不是静默当成空洞", () => {
    // null 已经表示「空洞」。越界也返回 null 的话，匹配扫描会把界外当空格
    // 悄悄吞掉——不报错，只算错分，是最难查的一类。
    const grid = board(["AB", "CD"]);
    expect(() => cellAt(grid, pos(-1, 0))).toThrow(RangeError);
    expect(() => cellAt(grid, pos(0, -1))).toThrow(RangeError);
    expect(() => cellAt(grid, pos(2, 0))).toThrow(RangeError);
    expect(() => cellAt(grid, pos(0, 2))).toThrow(RangeError);
  });

  it("元素序列相同但形状不同的盘面不算相等", () => {
    // 同种子竞速的一致性校验靠 gridEquals。只逐格比 cells 而不比宽高的话，
    // 3×2 与 2×3 会被判成同一副盘面，尺寸错乱反而查不出来。
    expect(gridEquals(board(["ABC", "DEF"]), board(["AB", "CD", "EF"]))).toBe(
      false,
    );
  });
});

describe("匹配检测", () => {
  it("横向三连", () => {
    const groups = findMatches(board(["BAAAB"]));
    expect(groups).toHaveLength(1);
    expect(groups[0].orientation).toBe("row");
    expect(groups[0].positions).toHaveLength(3);
  });

  it("纵向三连", () => {
    const groups = findMatches(board(["A", "A", "A", "B"]));
    expect(groups).toHaveLength(1);
    expect(groups[0].orientation).toBe("column");
    expect(groups[0].positions.map((p) => p.row)).toEqual([0, 1, 2]);
  });

  it("两个都不到三连则不成立", () => {
    expect(findMatches(board(["AABAA", "BBABB"]))).toHaveLength(0);
  });

  it("四连算一组而不是两组", () => {
    const groups = findMatches(board(["ABBBB"]));
    expect(groups).toHaveLength(1);
    expect(groups[0].positions).toHaveLength(4);
  });

  it("同一行的两段不同元素分别成组", () => {
    const groups = findMatches(board(["AAABBB"]));
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.kind)).toEqual([0, 1]);
  });

  it("空洞打断游程", () => {
    expect(findMatches(board(["AA.A"]))).toHaveLength(0);
  });

  it("连成片的空洞本身不算一组匹配", () => {
    // 「消除后、补充前」的中间态盘面整列都是空的。游程扫描若不排除 null，
    // 这些中间态会凭空多出「匹配」：渲染层拿去就是一段无中生有的消除动画，
    // isStable 拿去校验就会把正常盘面判成篡改。
    //
    // 说明白一点：现在 collectRuns 里有两道防线——`current !== null` 让空洞
    // 根本无法延长游程，`prev !== null` 再挡一次。变异测试证实单独去掉后者
    // 全绿（它在当前写法下是够不着的冗余），只有把前者也放宽成
    // `current === prev` 时，这条用例才会变红。所以它防的不是今天的实现，
    // 是「以后有人为了别的需求动了 continue 条件」那一天。
    expect(findMatches(board(["A...A"]))).toHaveLength(0);
    expect(findMatches(board(["A.", "B.", "C.", "D."]))).toHaveLength(0);
  });

  it("待清除坐标按行主序排列，与检出顺序无关", () => {
    // 检出顺序固定是「先所有行、后所有列」，而这个夹具的横向组（row3，下标
    // 12~14）比纵向组（col0，下标 0~12）靠后，去重集合的插入顺序天然是乱的。
    // 这串坐标要原样下发给客户端播消除动画，顺序不定就意味着同种子的两端播
    // 出不同的次序，回放与录像也对不上。
    const grid = board(["ABCD", "ABDC", "ACBD", "AAAB"]);
    const cleared = clearedPositions(grid, findMatches(grid));
    expect(cleared.map((p) => `${p.row},${p.col}`)).toEqual([
      "0,0",
      "1,0",
      "2,0",
      "3,0",
      "3,1",
      "3,2",
    ]);
  });

  it("L 形 — 横竖两组都要检出，拐点只消除一次", () => {
    const grid = board(["AAAB", "ABCD", "ACDB", "BDCA"]);
    const groups = findMatches(grid);

    expect(groups.map((g) => g.orientation).sort()).toEqual(["column", "row"]);
    // 两组共 6 个坐标，拐点 (0,0) 被两组共用 —— 去重后是 5 格，计分不能算 6
    expect(clearedPositions(grid, groups)).toHaveLength(5);
    expect(show(clearCells(grid, clearedPositions(grid, groups)))).toEqual([
      "...B",
      ".BCD",
      ".CDB",
      "BDCA",
    ]);
  });

  it("T 形 — 交叉点在中间同样检出两组", () => {
    const grid = board(["BABC", "AAAB", "BABC"]);
    const groups = findMatches(grid);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.orientation).sort()).toEqual(["column", "row"]);
    expect(clearedPositions(grid, groups)).toHaveLength(5);
  });
});

describe("交换合法性", () => {
  const state = stateOf(board(CASCADE_BOARD));

  it("夹具本身是稳定盘面 — 无既存匹配且填满", () => {
    expect(isStable(state.grid)).toBe(true);
  });

  it("产生匹配的相邻交换被接受，分数与步数前进", () => {
    const outcome = applySwap(state, pos(0, 2), pos(1, 2));
    expect(outcome.accepted).toBe(true);
    expect(outcome.rejection).toBeNull();
    expect(outcome.state.score).toBeGreaterThan(0);
    expect(outcome.state.moves).toBe(1);
  });

  it("只形成纵向匹配的交换同样合法 — 合法性判定不能只看横向", () => {
    // 上一条用例形成的是横向三连，只查横向的实现照样能通过；这条把 C 横着
    // 换进 col1，唯一的匹配是纵向的，才真正逼出「横竖都要查」
    const vertical = stateOf(board(VERTICAL_ONLY_BOARD));
    expect(isStable(vertical.grid)).toBe(true);

    const outcome = applySwap(vertical, pos(1, 0), pos(1, 1));
    expect(outcome.accepted).toBe(true);
    expect(outcome.steps[0].groups).toHaveLength(1);
    expect(outcome.steps[0].groups[0].orientation).toBe("column");
    expect(outcome.steps[0].cleared.map((p) => p.row)).toEqual([1, 2, 3]);
  });

  it("匹配只围绕第一个坐标形成时同样合法 — 两端都要查", () => {
    // 上面两条里成三连的都是第二个坐标那一端，只查 b 端的实现照样全绿。把
    // 同一步反过来写：C 落到 a=(1,1) 接成纵向三连，b=(1,0) 拿到的 E 哪条线
    // 都不成组，匹配只穿过 a。漏掉这一端的话，玩家「拖左边那格去凑」永远被
    // 判无效，而「拖右边那格来凑」有效——同一步棋换个拖法结果不一样。
    const vertical = stateOf(board(VERTICAL_ONLY_BOARD));
    const outcome = applySwap(vertical, pos(1, 1), pos(1, 0));

    expect(outcome.accepted).toBe(true);
    expect(outcome.steps[0].groups[0].orientation).toBe("column");
    expect(outcome.steps[0].cleared.map((p) => p.row)).toEqual([1, 2, 3]);
  });

  it("可行交换枚举包含只形成纵向匹配的一步", () => {
    const moves = findAvailableMoves(board(VERTICAL_ONLY_BOARD));
    expect(
      moves.some((m) => posEquals(m.a, pos(1, 0)) && posEquals(m.b, pos(1, 1))),
    ).toBe(true);
  });

  it("唯一可行交换是上下对调时不能漏枚举", () => {
    // 枚举每格只往右、往下各试一次。「往下」那半边写漏了，横向有解的盘面
    // 照样能过——上一条测的也是横向对调。这个盘面唯一的一步是把 (2,2) 与
    // (3,2) 上下对调（换完 row2 成 `A A A C`），纵向那半边一漏，盘面立刻被
    // 误判成死局，玩家会看到整片盘面莫名其妙重排。
    const grid = board(["DCAC", "ABBA", "AADC", "CDAD"]);
    expect(isStable(grid)).toBe(true);
    expect(hasAvailableMove(grid)).toBe(true);
    expect(findAvailableMoves(grid)).toEqual([{ a: pos(2, 2), b: pos(3, 2) }]);
  });

  it("唯一可行交换贴着最右两列时不能漏枚举", () => {
    // 边界上的那一步最容易被 `col + 1 < width` 之类的偏差吃掉，而盘面中央
    // 有解时根本看不出来。这里唯一的一步是 (1,2) 与 (1,3) 对调，让 col2 的
    // 下三格接成 `A A A`——它同时压着最右一列和纵向成组两个边界。
    const grid = board(["ACBC", "ADBA", "BCAC", "CBAB"]);
    expect(isStable(grid)).toBe(true);
    expect(hasAvailableMove(grid)).toBe(true);
    expect(findAvailableMoves(grid)).toEqual([{ a: pos(1, 2), b: pos(1, 3) }]);
  });

  it("相邻但交换后无匹配 — 拒绝且盘面原样返回", () => {
    const outcome = applySwap(state, pos(0, 0), pos(0, 1));
    expect(outcome.accepted).toBe(false);
    expect(outcome.rejection).toBe("no_match");
    // 引用相等：调用方可用 === 判断「什么都没发生」，跳过重绘与广播
    expect(outcome.state).toBe(state);
    expect(outcome.state.moves).toBe(0);
    expect(show(outcome.state.grid)).toEqual(CASCADE_BOARD);
  });

  it("隔一格不算相邻", () => {
    const outcome = applySwap(state, pos(0, 0), pos(0, 2));
    expect(outcome.rejection).toBe("not_adjacent");
    expect(outcome.state).toBe(state);
  });

  it("对角线不算相邻", () => {
    // 若换成「就近即可交换」，(0,2) 的 A 能斜着换到 (1,1)，同样凑出 row1 三连
    const outcome = applySwap(state, pos(0, 2), pos(1, 1));
    expect(outcome.rejection).toBe("not_adjacent");
    expect(outcome.state).toBe(state);
  });

  it("自己和自己交换", () => {
    expect(applySwap(state, pos(2, 2), pos(2, 2)).rejection).toBe("same_cell");
  });

  it("越界坐标先于相邻判定被拦下", () => {
    // (0,-1) 与 (0,0) 的曼哈顿距离恰好是 1，越界检查若放在后面就会读到界外
    expect(applySwap(state, pos(0, 0), pos(0, -1)).rejection).toBe(
      "out_of_bounds",
    );
    expect(applySwap(state, pos(0, 0), pos(5, 0)).rejection).toBe(
      "out_of_bounds",
    );
  });

  it("reduce 与 applySwap 等价 — 服务端与客户端走同一条转换", () => {
    const viaAction = reduce(state, {
      type: "swap",
      a: pos(0, 2),
      b: pos(1, 2),
    });
    const viaCall = applySwap(state, pos(0, 2), pos(1, 2));
    expect(show(viaAction.state.grid)).toEqual(show(viaCall.state.grid));
    expect(viaAction.state.score).toBe(viaCall.state.score);
  });

  it("reduce 收到未知动作直接抛错，而不是猜着执行", () => {
    // 动作是从网络进来的，type 不在白名单里说明协议版本对不上或包被改过。
    // 兜底分支若静默当成交换（或静默返回原状态），一个畸形包要么直接改动
    // 盘面，要么让客户端与服务端在「这一步算不算数」上产生分歧。
    expect(() =>
      reduce(state, { type: "explode" } as unknown as Match3Action),
    ).toThrow(/未知动作/);
  });
});

describe("下落", () => {
  it("空位不连续时上方元素依次落到列底且保持相对次序", () => {
    const fallen = applyGravity(board(["A", ".", "C", ".", "D"]));
    expect(show(fallen)).toEqual([".", ".", "A", "C", "D"]);
  });

  it("整列被消空则保持空，等待补充", () => {
    const fallen = applyGravity(board(["A.B", "..C", "D.E"]));
    expect(show(fallen)).toEqual(["..B", "A.C", "D.E"]);
  });

  it("无空洞时盘面不变", () => {
    const grid = board(["AB", "CD"]);
    expect(show(applyGravity(grid))).toEqual(["AB", "CD"]);
  });

  it("底部空洞把整列拉下来", () => {
    expect(show(applyGravity(board(["A", "B", "."])))).toEqual([".", "A", "B"]);
  });
});

describe("连锁", () => {
  /*
   * 这里有一处**测不到**的地方，先说清楚，免得看着覆盖率以为盖住了：
   *
   * cascade 里的 MAX_CASCADE 防呆闸从外部 API 触发不到。它要求「检测到匹配
   * 却没能清掉」，而这在实现自洽时永远不成立——单独把闸门拆掉，下面这些用例
   * 一条都不会红。用多点变异验证过：把 clearCells 一并去掉（制造不收敛）之后，
   * 有闸门是干净地抛「连锁超过 64 层」，没闸门是跑满两分钟把 Node 堆撑爆
   * （OOM 崩进程）。也就是说闸门是活代码、确实在兜底，只是它兜的那个场景要
   * 引擎先有第二个 bug 才到得了，没法从这一层写用例。
   */
  const outcome = applySwap(
    stateOf(board(CASCADE_BOARD)),
    pos(0, 2),
    pos(1, 2),
  );

  it("第一层是交换直接造成的消除", () => {
    expect(outcome.steps[0].chain).toBe(1);
    expect(outcome.steps[0].groups).toHaveLength(1);
    expect(outcome.steps[0].cleared).toHaveLength(3);
  });

  it("下落后接上的三连触发第二层", () => {
    expect(outcome.steps.length).toBeGreaterThanOrEqual(2);
    const second = outcome.steps[1];
    expect(second.chain).toBe(2);
    // col1 的 C 从 row0 落到 row1，与 row2、row3 的 C 接上；seed=1 时补进
    // 顶上的又是一个 C，于是实际清掉的是 row0~row3 四连。
    //
    // 这里必须写精确相等：早先写成 arrayContaining([1,2,3]) 时，四连、三连
    // 甚至「压根没下落、只是空洞被补成了 C」都能一律通过——断言看着很具体，
    // 实际只要求「这几行在里面」。
    const column = second.groups.find((g) => g.orientation === "column");
    expect(column?.kind).toBe(SYMBOLS.indexOf("C"));
    expect(column?.positions.map((p) => `${p.row},${p.col}`)).toEqual([
      "0,1",
      "1,1",
      "2,1",
      "3,1",
    ]);
  });

  it("层号连续递增，可直接用于计分倍率", () => {
    expect(outcome.steps.map((s) => s.chain)).toEqual(
      outcome.steps.map((_, i) => i + 1),
    );
    for (const step of outcome.steps) {
      expect(step.gained).toBe(scoreForStep(step.cleared.length, step.chain));
    }
    expect(outcome.state.score).toBe(
      outcome.steps.reduce((sum, s) => sum + s.gained, 0),
    );
  });

  it("连锁层越深单格得分越高", () => {
    expect(scoreForStep(3, 2)).toBe(3 * TILE_SCORE * 2);
    expect(scoreForStep(3, 2)).toBeGreaterThan(scoreForStep(3, 1));
  });

  it("结算后盘面回到稳定态 — 无空洞、无待消除匹配", () => {
    expect(isStable(outcome.state.grid)).toBe(true);
  });
});

describe("初始盘面", () => {
  it("100 个种子都不含预置匹配、填满、且至少有一个可行交换", () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createInitialState(seed);
      expect(isStable(state.grid), `seed=${seed} 开局即自动消除`).toBe(true);
      expect(hasAvailableMove(state.grid), `seed=${seed} 开局即死局`).toBe(
        true,
      );
    }
  });

  it("盘面尺寸与种类受配置约束", () => {
    const state = createInitialState(5, { width: 6, height: 7, kinds: 4 });
    expect(state.grid.width).toBe(6);
    expect(state.grid.height).toBe(7);
    expect(state.grid.cells.every((c) => c !== null && c >= 0 && c < 4)).toBe(
      true,
    );
  });

  it("默认盘面是 8×8 六色", () => {
    expect(DEFAULT_CONFIG).toEqual({ width: 8, height: 8, kinds: 6 });
  });

  it("盘面过小或种类过少直接报错，而不是生成到超时", () => {
    expect(() =>
      createInitialState(1, { width: 2, height: 8, kinds: 6 }),
    ).toThrow(RangeError);
    // 高度同样要校验：只查宽不查高的话，8×2 会一路跑到生成器里，生出一副
    // 永远凑不出三连的盘面，然后卡在「找不到可行交换」上重试到抛错
    expect(() =>
      createInitialState(1, { width: 8, height: 2, kinds: 6 }),
    ).toThrow(RangeError);
    // 只有两种元素时，「排除左两格 + 排除上两格」可能把候选集清空
    expect(() =>
      createInitialState(1, { width: 8, height: 8, kinds: 2 }),
    ).toThrow(RangeError);
  });

  it("生成会消耗随机序列，重试也接着往下取", () => {
    // 生成不推进 RNG 的话有两处塌方：开局后第一次补充会重放生成盘面用过的
    // 那串值，补出来的元素与初始盘面强相关；重试还会一遍遍生成同一副死局，
    // 直到 64 次上限抛错——而且是确定地抛错，配置一旦踩中就永远开不了局。
    expect(createInitialState(20260820).rng).not.toBe(createRng(20260820));
    // 3×3 三色下死局很常见：seed=16 要连生成 5 次才拿到可玩盘面
    const retried = createInitialState(16, { width: 3, height: 3, kinds: 3 });
    expect(isStable(retried.grid)).toBe(true);
    expect(hasAvailableMove(retried.grid)).toBe(true);
  });
});

describe("死局", () => {
  /**
   * `(row + col) % 3` 条纹盘面必然无子可动，可以直接证明：任意一行或一列的
   * 连续三格都是 `k, k+1, k+2 (mod 3)`，两两不同。一次交换只往某条线的三格
   * 窗口里换进一个新值，窗口内最多凑出两个相同，永远到不了三连。
   */
  const deadlock = gridFromRows(
    Array.from({ length: 6 }, (_, row) =>
      Array.from({ length: 6 }, (_, col) => (row + col) % 3),
    ),
  );

  /** 死局态。分数与步数取非零值，用来盯住「重排不该清算它们」。 */
  const deadlockState = (seed: number): Match3State => ({
    config: { width: 6, height: 6, kinds: 5 },
    grid: deadlock,
    rng: createRng(seed),
    score: 120,
    moves: 4,
  });

  it("识别出无可行交换的盘面", () => {
    expect(findMatches(deadlock)).toHaveLength(0);
    expect(hasAvailableMove(deadlock)).toBe(false);
    expect(findAvailableMoves(deadlock)).toHaveLength(0);
  });

  it("有子可动的盘面不会被误判", () => {
    expect(hasAvailableMove(board(CASCADE_BOARD))).toBe(true);
  });

  it("重排后盘面可玩，且重排本身是确定的", () => {
    const state = deadlockState(31);

    const once = ensurePlayable(state);
    const twice = ensurePlayable(state);

    expect(once.reshuffled).toBe(true);
    expect(isStable(once.state.grid)).toBe(true);
    expect(hasAvailableMove(once.state.grid)).toBe(true);
    // 重排只换盘面，不清算分数与步数
    expect(once.state.score).toBe(120);
    expect(once.state.moves).toBe(4);
    // 同一状态重排两次结果一致，否则重连后双方盘面会分叉
    expect(show(once.state.grid)).toEqual(show(twice.state.grid));
  });

  it("重排跟着当前 RNG 状态走，而不是回到某个固定种子", () => {
    // 「重排两次结果一致」用固定种子照样成立，所以上一条测不出这里。固定
    // 种子的后果是随机序列每次重排都被拉回原点：之后所有补充重复上一轮，
    // 且任何对局在任何时刻重排都撞出同一副盘面。
    const from31 = ensurePlayable(deadlockState(31));
    const from32 = ensurePlayable(deadlockState(32));
    expect(show(from31.state.grid)).not.toEqual(show(from32.state.grid));
    // 重排取过随机数，状态必须往前走，否则下一次重排原地打转
    expect(from31.state.rng).not.toBe(createRng(31));
  });

  it("尚有可行交换时不重排 — 原状态原样返回", () => {
    const state = stateOf(board(CASCADE_BOARD));
    const outcome = ensurePlayable(state);
    expect(outcome.reshuffled).toBe(false);
    expect(outcome.state).toBe(state);
  });

  it("交换结算完陷入死局时自动兜底重排", () => {
    // applySwap 结算完必须再过一遍死局检测。这条接线断掉不会有任何症状：
    // 盘面照样稳定、分数照样对、outcome 照样 accepted——玩家只是从此再也
    // 走不动，而服务端认为一切正常。3×3 三色下死局很常见，seed=0 的开局
    // 只有一步可走，走完就是死局。
    const tiny = createInitialState(0, { width: 3, height: 3, kinds: 3 });
    const [move] = findAvailableMoves(tiny.grid);

    const outcome = applySwap(tiny, move.a, move.b);

    expect(outcome.accepted).toBe(true);
    expect(outcome.reshuffled).toBe(true);
    expect(hasAvailableMove(outcome.state.grid)).toBe(true);
    expect(isStable(outcome.state.grid)).toBe(true);
    // 兜底重排不影响这一步该得的分
    expect(outcome.state.score).toBe(3 * TILE_SCORE);
  });
});
