/**
 * 围棋规则引擎测试。
 *
 * 局面用 ASCII 图直接书写：`.` 空、`X` 黑、`O` 白。这不是为了好看——
 * 围棋的边界情况（扑、劫、假眼）全都关乎棋形，写成下标数组的话谁也
 * 看不出测的是什么形，出错时也无从判断是实现错了还是局面搭错了。
 */

import { describe, expect, it } from "vitest";
import {
  BLACK,
  EMPTY,
  WHITE,
  collectGroup,
  countLiberties,
  createGame,
  isEye,
  pass,
  play,
  scoreGame,
  toIndex,
} from "@/bro/games/go/logic";
import type { Board, BoardSize, GoState, Player } from "@/bro/games/go/logic";

/**
 * 从 ASCII 图构造棋盘。
 *
 * @example
 * ```
 * boardOf(`
 *   . X .
 *   X O X
 *   . X .
 * `)
 * ```
 */
function boardOf(art: string): Board {
  const rows = art
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const size = rows.length as BoardSize;
  if (rows.some((r) => r.length !== size)) {
    throw new Error("棋盘必须是正方形，检查 ASCII 图各行长度");
  }
  const cells = rows.flat().map((c) => {
    if (c === "X") return BLACK;
    if (c === "O") return WHITE;
    if (c === ".") return EMPTY;
    throw new Error(`未知字符: ${c}`);
  });
  return { size, cells };
}

/** 以给定局面构造对局状态。 */
function gameOf(art: string, over: Partial<GoState> = {}): GoState {
  return { ...createGame(), board: boardOf(art), ...over };
}

/** 把棋盘还原成 ASCII，便于断言整体棋形而非逐点比较。 */
function render(board: Board): string {
  const out: string[] = [];
  for (let r = 0; r < board.size; r += 1) {
    const row: string[] = [];
    for (let c = 0; c < board.size; c += 1) {
      const s = board.cells[r * board.size + c];
      row.push(s === BLACK ? "X" : s === WHITE ? "O" : ".");
    }
    out.push(row.join(" "));
  }
  return out.join("\n");
}

/** 落子并断言成功，返回新状态。 */
function playOk(
  state: GoState,
  player: Player,
  row: number,
  col: number,
): GoState {
  const result = play(state, player, row, col);
  if (!result.ok) throw new Error(`预期落子成功，实际被拒: ${result.reason}`);
  return result.state;
}

describe("气的计算", () => {
  it("中央单子四气", () => {
    const board = boardOf(`
      . . .
      . X .
      . . .
    `);
    expect(countLiberties(board, toIndex(3, 1, 1))).toBe(4);
  });

  it("边上单子三气，角上单子两气 — 邻接不含对角", () => {
    const board = boardOf(`
      X . .
      . . .
      . . X
    `);
    expect(countLiberties(board, toIndex(3, 0, 0))).toBe(2);

    const edge = boardOf(`
      . X .
      . . .
      . . .
    `);
    expect(countLiberties(edge, toIndex(3, 0, 1))).toBe(3);
  });

  it("同一空点被串中多子共用时只算一气", () => {
    // 拐角形：(1,1) 同时紧邻 (0,1) 与 (1,0)，两颗子都属同一串。
    // 直线形试不出这个 bug——横向相邻的两子没有公共的正交邻点。
    const board = boardOf(`
      X X .
      X . .
      . . .
    `);
    const group = collectGroup(board, toIndex(3, 0, 0));
    expect(group.stones.size).toBe(3);
    // 逐子累加是 4（(1,1) 被数两次），去重后为 3
    expect(group.liberties.size).toBe(3);
  });

  it("共用气导致的虚假安全 — 打吃判定的经典错误", () => {
    // 白三子仅剩 (1,1) 一气，已处打吃。若把共用气重复计数会读成两气，
    // 界面与 AI 都会以为这块棋还安全。
    const board = boardOf(`
      O O X
      O . .
      X . .
    `);
    expect(countLiberties(board, toIndex(3, 0, 0))).toBe(1);

    const next = playOk(
      gameOf(
        `
      O O X
      O . .
      X . .
    `,
        { toPlay: BLACK },
      ),
      BLACK,
      1,
      1,
    );
    expect(next.captures[BLACK]).toBe(3);
  });

  it("对角相邻不算一串", () => {
    const board = boardOf(`
      X . .
      . X .
      . . .
    `);
    expect(collectGroup(board, toIndex(3, 0, 0)).stones.size).toBe(1);
  });
});

describe("提子", () => {
  it("提掉角上被围的单子", () => {
    const state = gameOf(
      `
      O X .
      . . .
      . . .
    `,
      { toPlay: BLACK },
    );
    // 角上白子只剩 (1,0) 一气，堵住即提
    const next = playOk(state, BLACK, 1, 0);
    expect(next.board.cells[toIndex(3, 0, 0)]).toBe(EMPTY);
    expect(next.captures[BLACK]).toBe(1);
  });

  it("整块一起提，不是只提相邻那一颗", () => {
    const state = gameOf(
      `
      . X X X .
      X O O O X
      X O . O X
      X O O O X
      . X X X .
    `,
      { toPlay: BLACK },
    );
    const next = playOk(state, BLACK, 2, 2);
    expect(render(next.board)).toBe(
      [
        ". X X X .",
        "X . . . X",
        "X . X . X",
        "X . . . X",
        ". X X X .",
      ].join("\n"),
    );
    expect(next.captures[BLACK]).toBe(8);
  });

  it("只提无气的串，相邻但仍有气的串不动", () => {
    const state = gameOf(
      `
      . X . . .
      X O . O X
      . X . . .
      . . . . .
      . . . . .
    `,
      { toPlay: BLACK },
    );
    // (1,2) 同时紧邻两块白：左边那块就此断气，右边那块还有 (0,3)(2,3) 两气
    const next = playOk(state, BLACK, 1, 2);
    expect(next.board.cells[toIndex(5, 1, 1)]).toBe(EMPTY);
    expect(next.board.cells[toIndex(5, 1, 3)]).toBe(WHITE);
    expect(next.captures[BLACK]).toBe(1);
  });
});

describe("自杀禁着", () => {
  it("填入对方眼位内部属于自杀", () => {
    const state = gameOf(
      `
      . O .
      O . O
      . O .
    `,
      { toPlay: BLACK },
    );
    const result = play(state, BLACK, 1, 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("suicide");
  });

  it("落子使己方整串无气也属于自杀", () => {
    const state = gameOf(
      `
      . O O .
      O X . O
      . O O .
      . . . .
    `,
      { toPlay: BLACK },
    );
    // 补在 (1,2) 后黑两子连成一串且四周皆白，整串无气
    const result = play(state, BLACK, 1, 2);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("suicide");
  });

  it("扑 — 落子瞬间无气但提掉对方，合法", () => {
    // 这是求值顺序错误时必然踩中的用例：若先判自杀再提子，此手会被误拒
    const state = gameOf(
      `
      . X O .
      X O . O
      . X O .
      . . . .
    `,
      { toPlay: BLACK },
    );
    const result = play(state, BLACK, 1, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 落下的黑子本身无气，但它提掉了 (1,1) 的白子，于是获得气
    expect(result.captured).toBe(1);
    expect(result.state.board.cells[toIndex(4, 1, 1)]).toBe(EMPTY);
    expect(result.state.board.cells[toIndex(4, 1, 2)]).toBe(BLACK);
  });
});

describe("劫争", () => {
  /** 标准劫形。白提黑一子后，黑不能立即回提。 */
  const koShape = `
    . X O . .
    X . X O .
    . X O . .
    . . . . .
    . . . . .
  `;

  it("提一子且自身仅一气时形成劫点", () => {
    const state = gameOf(koShape, { toPlay: WHITE });
    const next = playOk(state, WHITE, 1, 1);
    expect(next.captures[WHITE]).toBe(1);
    // 被提的 (1,2) 成为劫点
    expect(next.koPoint).toBe(toIndex(5, 1, 2));
  });

  it("黑不能立即回提", () => {
    const afterWhite = playOk(gameOf(koShape, { toPlay: WHITE }), WHITE, 1, 1);
    const result = play(afterWhite, BLACK, 1, 2);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("ko");
  });

  it("他处落子一手后劫解除，可以回提", () => {
    const afterWhite = playOk(gameOf(koShape, { toPlay: WHITE }), WHITE, 1, 1);
    const blackElsewhere = playOk(afterWhite, BLACK, 4, 4);
    const whiteElsewhere = playOk(blackElsewhere, WHITE, 4, 0);
    expect(play(whiteElsewhere, BLACK, 1, 2).ok).toBe(true);
  });

  it("提两子不成劫 — 对方无法立即回提，不需要禁着", () => {
    const state = gameOf(
      `
      . X X . .
      X O O . .
      . X X . .
      . . . . .
      . . . . .
    `,
      { toPlay: BLACK },
    );
    const next = playOk(state, BLACK, 1, 3);
    expect(next.captures[BLACK]).toBe(2);
    expect(next.koPoint).toBeNull();
  });

  it("提一子但落子方自身多气时不成劫", () => {
    const state = gameOf(
      `
      . X . . .
      X O . . .
      . X . . .
      . . . . .
      . . . . .
    `,
      { toPlay: BLACK },
    );
    // 黑在 (1,2) 提掉白子，但这颗黑子有四口气，白就算回提也不会循环
    const result = play(state, BLACK, 1, 2);
    expect(result.ok && result.captured).toBe(1);
    expect(result.ok && result.state.koPoint).toBeNull();
  });

  it("虚手解除劫争", () => {
    const afterWhite = playOk(gameOf(koShape, { toPlay: WHITE }), WHITE, 1, 1);
    expect(afterWhite.koPoint).not.toBeNull();
    const afterPass = pass(afterWhite, BLACK);
    expect(afterPass.ok && afterPass.state.koPoint).toBeNull();
  });
});

describe("落子基本约束", () => {
  it("不能下在已有子的点", () => {
    const state = gameOf(
      `
      X . .
      . . .
      . . .
    `,
      { toPlay: WHITE },
    );
    const result = play(state, WHITE, 0, 0);
    expect(result.ok === false && result.reason).toBe("occupied");
  });

  it("越界被拒", () => {
    const result = play(createGame(9), BLACK, 9, 0);
    expect(result.ok === false && result.reason).toBe("out_of_bounds");
  });

  it("不是自己的回合不能下", () => {
    const result = play(createGame(9), WHITE, 0, 0);
    expect(result.ok === false && result.reason).toBe("not_your_turn");
  });

  it("落子不修改原状态 — 服务端与客户端共用推演，就地修改会污染局面", () => {
    const state = createGame(9);
    const before = render(state.board);
    play(state, BLACK, 4, 4);
    expect(render(state.board)).toBe(before);
    expect(state.toPlay).toBe(BLACK);
  });
});

describe("终局", () => {
  it("连续两次虚手终局", () => {
    const first = pass(createGame(9), BLACK);
    expect(first.ok && first.state.finished).toBe(false);
    const second = first.ok ? pass(first.state, WHITE) : null;
    expect(second?.ok && second.state.finished).toBe(true);
  });

  it("终局后不能再落子", () => {
    const first = pass(createGame(9), BLACK);
    const second = first.ok ? pass(first.state, WHITE) : null;
    if (!second?.ok) throw new Error("setup failed");
    const result = play(second.state, BLACK, 0, 0);
    expect(result.ok === false && result.reason).toBe("game_over");
  });

  it("中间落子会重置虚手计数", () => {
    const passed = pass(createGame(9), BLACK);
    if (!passed.ok) throw new Error("setup failed");
    const played = playOk(passed.state, WHITE, 4, 4);
    expect(played.consecutivePasses).toBe(0);
  });
});

describe("计分（数子法）", () => {
  it("子数加独占空点", () => {
    const board = boardOf(`
      X X O O
      X X O O
      X X O O
      X X O O
    `);
    const score = scoreGame(board, 0);
    expect(score[BLACK]).toBe(8);
    expect(score[WHITE]).toBe(8);
    expect(score.winner).toBeNull();
  });

  it("被单色包围的空点归该方", () => {
    const board = boardOf(`
      . X . .
      X X . .
      . . . .
      . . . .
    `);
    // (0,0) 只与黑相邻，归黑；其余空区触及边界但不触及白，也归黑
    const score = scoreGame(board, 0);
    expect(score[BLACK]).toBe(16);
  });

  it("双方都接触的空区是公气，不计给任何一方", () => {
    const board = boardOf(`
      X . O .
      X . O .
      X . O .
      X . O .
    `);
    const score = scoreGame(board, 0);
    // 中间一列黑白都接触，是公气不计分；最右一列只接触白，归白
    expect(score[BLACK]).toBe(4);
    expect(score[WHITE]).toBe(8);
  });

  it("贴目计入胜负，半目避免平局", () => {
    const board = boardOf(`
      X X O O
      X X O O
      X X O O
      X X O O
    `);
    const score = scoreGame(board, 7.5);
    expect(score.winner).toBe(WHITE);
    expect(score.margin).toBe(-7.5);
  });
});

describe("眼位判定", () => {
  it("四邻与对角皆己方为真眼", () => {
    const board = boardOf(`
      X X X .
      X . X .
      X X X .
      . . . .
    `);
    expect(isEye(board, toIndex(4, 1, 1), BLACK)).toBe(true);
  });

  it("中央容许一个对角被占，仍是真眼", () => {
    const board = boardOf(`
      O X X .
      X . X .
      X X X .
      . . . .
    `);
    expect(isEye(board, toIndex(4, 1, 1), BLACK)).toBe(true);
  });

  it("中央对角被占两处即为假眼 — 只看四邻会误判", () => {
    const board = boardOf(`
      O X O .
      X . X .
      X X X .
      . . . .
    `);
    expect(isEye(board, toIndex(4, 1, 1), BLACK)).toBe(false);
  });

  it("角上对角全己方为真眼 — 界外的对角不该计入", () => {
    const board = boardOf(`
      . X . .
      X X . .
      . . . .
      . . . .
    `);
    expect(isEye(board, toIndex(4, 0, 0), BLACK)).toBe(true);
  });

  it("角上唯一的对角被占即为假眼", () => {
    const board = boardOf(`
      . X . .
      X O . .
      . . . .
      . . . .
    `);
    expect(isEye(board, toIndex(4, 0, 0), BLACK)).toBe(false);
  });

  it("已有子的点不是眼", () => {
    const board = boardOf(`
      X X X .
      X X X .
      X X X .
      . . . .
    `);
    expect(isEye(board, toIndex(4, 1, 1), BLACK)).toBe(false);
  });
});
