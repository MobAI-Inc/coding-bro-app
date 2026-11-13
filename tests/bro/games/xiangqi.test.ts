/**
 * 中国象棋规则测试。
 *
 * 覆盖重点是「容易写错的边界」而不是「能走棋」：蹩马腿、塞象眼、炮架、
 * 兵卒过河、飞将、自杀着法。每条规则都配一正一反两个用例——只测正例的
 * 测试会在规则被整段删掉时依然全绿。
 *
 * 局面一律用 {@link positionFrom} 的稀疏表构造（`{ e0: "k" }`），不用手写
 * 长数组：局面写错时能一眼看出来，这在规则测试里比什么都重要。
 *
 * 分工要清楚：**perft 只验证着法生成**（对照外部公认计数，见文件末尾），
 * 它一次都不会调用 `getOutcome` / `isCheckmate` / `isStalemate`。因此终局
 * 判定——将死 vs 困毙 vs 继续、胜方归谁——完全依赖「胜负判定」一节里手写的
 * 局面，那些用例必须自己覆盖红胜与黑胜两个方向、以及车之外的将死型。
 *
 * 明确不在覆盖范围内（实现层也没做，属于对局层而非局面层）：长将 / 长捉判负、
 * 自然限着和棋、重复局面判和。这些需要着法历史，`Position` 里没有历史。
 */

import { describe, expect, it } from "vitest";
import type { Move, Position, Side } from "@/bro/games/xiangqi/logic";
import {
  INITIAL_FEN,
  applyMove,
  formatSquare,
  getOutcome,
  initialPosition,
  isAttackedBy,
  isCheckmate,
  isInCheck,
  isInPalace,
  isLegalMove,
  isStalemate,
  kingsFaceEachOther,
  legalMoves,
  parseFen,
  parseSquare,
  pieceAt,
  playMove,
  positionFrom,
  pseudoLegalMoves,
  pseudoLegalMovesFrom,
  square,
  toFen,
  withPiece,
} from "@/bro/games/xiangqi/logic";

/**
 * 构造测试局面。
 *
 * 默认补上双方将帅并**刻意错列**（d9 / f0）：将帅同列会触发飞将判定，
 * 让一个本该只考察马或炮的用例莫名其妙地失败。需要考察飞将时再显式覆盖。
 */
function board(
  placements: Record<string, string>,
  sideToMove: Side = "red",
): Position {
  return positionFrom(sideToMove, { d9: "K", f0: "k", ...placements });
}

function mv(from: string, to: string): Move {
  return { from: parseSquare(from), to: parseSquare(to) };
}

/** 某子的伪合法落点，排序后便于整表断言。 */
function targets(pos: Position, from: string): string[] {
  return pseudoLegalMovesFrom(pos, parseSquare(from))
    .map((m) => formatSquare(m.to))
    .sort();
}

/** 只看某一列上的落点。用于炮这类横向落点很多、只关心纵向表现的用例。 */
function targetsOnFile(pos: Position, from: string, file: string): string[] {
  return targets(pos, from).filter((t) => t.startsWith(file));
}

/** 某子的合法落点（已排除自杀与飞将）。 */
function legalTargets(pos: Position, from: string): string[] {
  return legalMoves(pos)
    .filter((m) => formatSquare(m.from) === from)
    .map((m) => formatSquare(m.to))
    .sort();
}

/** 全部合法着法，写作 `"起点-终点"`，排序后可整表断言。 */
function allLegal(pos: Position): string[] {
  return legalMoves(pos)
    .map((m) => `${formatSquare(m.from)}-${formatSquare(m.to)}`)
    .sort();
}

describe("棋盘与坐标", () => {
  it("初始局面 FEN 往返一致", () => {
    expect(toFen(initialPosition())).toBe(INITIAL_FEN);
  });

  it("初始局面棋子就位，红先", () => {
    const pos = initialPosition();
    expect(pieceAt(pos, parseSquare("a0"))).toEqual({
      type: "R",
      side: "black",
    });
    expect(pieceAt(pos, parseSquare("e9"))).toEqual({ type: "K", side: "red" });
    expect(pieceAt(pos, parseSquare("e6"))).toEqual({ type: "P", side: "red" });
    expect(pos.sideToMove).toBe("red");
  });

  it("FEN 走子方为 b 时轮到黑走", () => {
    expect(parseFen("4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1").sideToMove).toBe(
      "black",
    );
  });

  it("稀疏表构造的局面只含列出的棋子", () => {
    const pos = positionFrom("red", { e9: "K", e0: "k", b7: "N" });
    expect(pos.board.filter((p) => p !== null)).toHaveLength(3);
    expect(pieceAt(pos, parseSquare("b7"))).toEqual({
      type: "N",
      side: "red",
    });
  });

  it("坐标串往返一致，非法坐标抛错", () => {
    expect(formatSquare(parseSquare("i9"))).toBe("i9");
    expect(parseSquare("a0")).toEqual({ col: 0, row: 0 });
    expect(() => parseSquare("z3")).toThrow();
    expect(() => parseSquare("e10")).toThrow();
  });

  it("九宫按方划分 — 同一格对红是九宫、对黑不是", () => {
    expect(isInPalace(parseSquare("d9"), "red")).toBe(true);
    expect(isInPalace(parseSquare("d9"), "black")).toBe(false);
    expect(isInPalace(parseSquare("c9"), "red")).toBe(false);
  });

  it("空格没有着法", () => {
    expect(targets(board({}), "e5")).toEqual([]);
  });

  it("越界坐标读不到棋子 — 负列不会绕行到相邻行", () => {
    // squareIndex 是 row * 9 + col，col 传 -1 算出来正好是上一行的最后一格：
    // (-1, 5) → 44 → i4，(9, 4) → 45 → a5。pieceAt 的越界守卫一旦没了，
    // 「空格即可通行」类判断（马腿、象眼）就会读到隔壁行的子，
    // 症状是盘边的马象无缘无故被堵住，且只在特定列上出现，极难查。
    const pos = board({ i4: "R", a5: "p" });
    expect(pieceAt(pos, square(-1, 5))).toBeNull();
    expect(pieceAt(pos, square(9, 4))).toBeNull();
    // 公开入口同样要挡住：pseudoLegalMovesFrom 不自己判越界，靠的就是 pieceAt
    expect(pseudoLegalMovesFrom(pos, square(-1, 5))).toEqual([]);
  });

  it("整方伪合法着法默认取走子方，可显式指定另一方", () => {
    // 被攻击判定要在「不轮到对方」时枚举对方的着法，所以 side 参数必须能覆盖。
    // 默认值若写成 opponent(sideToMove)，红黑会整体对调而单点用例察觉不到。
    // 红：帅 3 步 + 车 17 步；黑：将只有 d1、e0 两步（c0 已出九宫）。
    const pos = positionFrom("red", { e9: "K", d0: "k", a5: "R" });
    expect(pseudoLegalMoves(pos)).toHaveLength(20);
    expect(pseudoLegalMoves(pos, "red")).toHaveLength(20);
    expect(pseudoLegalMoves(pos, "black")).toHaveLength(2);
  });

  it("withPiece 生成新局面，不动原局面也不换走子方", () => {
    // 摆子是「编辑局面」而非「走一步棋」，交换走子方会让残局构造凭空少一回合。
    const pos = positionFrom("red", { e9: "K", e0: "k" });
    const next = withPiece(pos, parseSquare("e5"), { type: "P", side: "red" });
    expect(pieceAt(next, parseSquare("e5"))).toEqual({
      type: "P",
      side: "red",
    });
    expect(pieceAt(pos, parseSquare("e5"))).toBeNull();
    expect(next.sideToMove).toBe("red");
  });
});

describe("FEN 解析", () => {
  it("省略走子方时缺省红先", () => {
    // 棋谱来源杂乱，很多只给子力分布。缺省值写反会让整盘棋从黑方开始，
    // 而单看局面完全正常——只有走子方这一个字段错。
    expect(parseFen("4k4/9/9/9/9/9/9/9/9/4K4").sideToMove).toBe("red");
    expect(parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").sideToMove).toBe(
      "red",
    );
  });

  it("兼容 h/e 方言 — 马写 h、象写 e 时解析结果相同，输出统一成 n/b", () => {
    // chessprogramming wiki 的中国象棋 perft 局面就是用 H/E 写的。
    // 解析端宽容、输出端统一：不认方言会让一半的公开测试局面直接解析失败。
    const dialect =
      "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1";
    expect(toFen(parseFen(dialect))).toBe(INITIAL_FEN);
  });

  it("格式非法时抛错 — FEN 来自程序而非玩家，静默容错只会把问题推远", () => {
    expect(() => parseFen("4k4/9/9/9/9/4K4")).toThrow(); // 行数不足
    expect(() => parseFen("4k4/9/9/9/9/9/9/9/9/8")).toThrow(); // 行宽不足
    expect(() => parseFen("4k4x/9/9/9/9/9/9/9/9/4K4")).toThrow(); // 未知棋子字符
    // 注意：整行**超宽**（如一行写满 10 个子）目前不抛错，多出来的子被静默丢弃，
    // 这是已知缺陷，此处不写断言把它当成正确行为固化下来。
  });

  it("positionFrom 遇到未知棋子字符抛错", () => {
    expect(() => positionFrom("red", { e9: "K", e0: "x" })).toThrow();
  });
});

describe("车", () => {
  it("四向滑行，遇敌子可吃、遇己方子止步", () => {
    // e3 黑卒（可吃并止步）、e8 己方兵（止步且不可吃）、b5 己方兵（横向止步）
    const pos = board({ e5: "R", e3: "p", e8: "P", b5: "P" });
    expect(targets(pos, "e5")).toEqual([
      "c5",
      "d5",
      "e3",
      "e4",
      "e6",
      "e7",
      "f5",
      "g5",
      "h5",
      "i5",
    ]);
  });

  it("不能越过挡路的子", () => {
    const pos = board({ e5: "R", e3: "p" });
    expect(targets(pos, "e5")).not.toContain("e2");
  });
});

describe("炮", () => {
  it("无炮架时走法同车，且不能吃子", () => {
    // e3 有黑卒，但 e5 与 e3 之间没有炮架 —— 炮只能停在 e4，不能吃 e3
    const pos = board({ e5: "C", e3: "p" });
    expect(targetsOnFile(pos, "e5", "e")).toEqual([
      "e4",
      "e6",
      "e7",
      "e8",
      "e9",
    ]);
  });

  it("隔恰好一个子可吃", () => {
    const pos = board({ e5: "C", e4: "P", e3: "p" });
    expect(targetsOnFile(pos, "e5", "e")).toEqual([
      "e3",
      "e6",
      "e7",
      "e8",
      "e9",
    ]);
  });

  it("炮架可以是敌方的子", () => {
    // 炮架归属不影响规则，只看「中间恰好一个子」
    const pos = board({ e5: "C", e4: "p", e3: "p" });
    expect(targetsOnFile(pos, "e5", "e")).toContain("e3");
  });

  it("隔两个子不能吃 — 越过炮架后只有第一个子是目标", () => {
    const pos = board({ e5: "C", e4: "P", e3: "n", e2: "p" });
    expect(targetsOnFile(pos, "e5", "e")).toContain("e3");
    expect(targetsOnFile(pos, "e5", "e")).not.toContain("e2");
  });

  it("炮架之后是己方子则不能吃，也不能继续往后找", () => {
    const pos = board({ e5: "C", e4: "p", e3: "P", e2: "n" });
    expect(targetsOnFile(pos, "e5", "e")).toEqual(["e6", "e7", "e8", "e9"]);
  });
});

describe("马", () => {
  it("空盘中央有八个落点", () => {
    expect(targets(board({ e5: "N" }), "e5")).toEqual([
      "c4",
      "c6",
      "d3",
      "d7",
      "f3",
      "f7",
      "g4",
      "g6",
    ]);
  });

  it("蹩马腿 — 直线相邻格有子，堵住该方向的两个落点", () => {
    // e4 是 e5 正上方的直线相邻格，堵住 d3 与 f3；其余六个方向不受影响
    const pos = board({ e5: "N", e4: "P" });
    expect(targets(pos, "e5")).toEqual(["c4", "c6", "d7", "f7", "g4", "g6"]);
  });

  it("对角相邻格有子不蹩马腿 — 把马腿写成对角格是最常见的实现错误", () => {
    const pos = board({ e5: "N", d4: "P" });
    expect(targets(pos, "e5")).toHaveLength(8);
  });

  it("蹩马腿不分敌我 — 敌方的子照样堵", () => {
    const pos = board({ e5: "N", e4: "p" });
    expect(targets(pos, "e5")).not.toContain("f3");
  });

  it("落点有己方子则不可落，有敌子则可吃", () => {
    expect(targets(board({ e5: "N", f7: "P" }), "e5")).not.toContain("f7");
    expect(targets(board({ e5: "N", f7: "p" }), "e5")).toContain("f7");
  });
});

describe("象 / 相", () => {
  it("走田字四个方向", () => {
    expect(targets(board({ e7: "B" }), "e7")).toEqual(["c5", "c9", "g5", "g9"]);
  });

  it("塞象眼 — 田字中心有子则该方向不可走，其余方向不受影响", () => {
    // d6 是 e7→c5 的田字中心
    const pos = board({ e7: "B", d6: "P" });
    expect(targets(pos, "e7")).toEqual(["c9", "g5", "g9"]);
  });

  it("红象不过河 — 越过河界的落点被排除", () => {
    // c5 是红方最靠前的象位，往前两格（row 3）已过河
    const pos = board({ c5: "B" });
    expect(targets(pos, "c5")).toEqual(["a7", "e7"]);
  });

  it("黑象不过河 — 方向相反，判定同样成立", () => {
    const pos = board({ c4: "b" });
    expect(targets(pos, "c4")).toEqual(["a2", "e2"]);
  });
});

describe("士 / 仕", () => {
  it("九宫内斜走一格", () => {
    const pos = positionFrom("red", { e9: "K", f0: "k", e8: "A" });
    expect(targets(pos, "e8")).toEqual(["d7", "d9", "f7", "f9"]);
  });

  it("不能直走", () => {
    const pos = positionFrom("red", { e9: "K", f0: "k", e8: "A" });
    expect(targets(pos, "e8")).not.toContain("e7");
    expect(targets(pos, "e8")).not.toContain("d8");
  });

  it("不出九宫 — 九宫角上的士只剩一个落点", () => {
    const pos = positionFrom("red", { e9: "K", f0: "k", d7: "A" });
    expect(targets(pos, "d7")).toEqual(["e8"]);
  });
});

describe("将 / 帅", () => {
  it("九宫内直走一格，不能斜走", () => {
    const pos = positionFrom("red", { e8: "K", d0: "k" });
    expect(targets(pos, "e8")).toEqual(["d8", "e7", "e9", "f8"]);
  });

  it("不出九宫", () => {
    // d7 是九宫左前角：向左出列、向前出行，都不允许
    const pos = positionFrom("red", { d7: "K", f0: "k" });
    expect(targets(pos, "d7")).toEqual(["d8", "e7"]);
  });
});

describe("兵 / 卒", () => {
  it("红兵未过河只能向前", () => {
    const pos = board({ e6: "P" });
    expect(targets(pos, "e6")).toEqual(["e5"]);
  });

  it("红兵过河后可横走", () => {
    const pos = board({ e4: "P" });
    expect(targets(pos, "e4")).toEqual(["d4", "e3", "f4"]);
  });

  it("红兵过河后仍不能后退", () => {
    expect(targets(board({ e4: "P" }), "e4")).not.toContain("e5");
  });

  it("黑卒方向相反 — 未过河只能向前", () => {
    expect(targets(board({ e3: "p" }), "e3")).toEqual(["e4"]);
  });

  it("黑卒过河后可横走但不能后退", () => {
    const pos = board({ e5: "p" });
    expect(targets(pos, "e5")).toEqual(["d5", "e6", "f5"]);
    expect(targets(pos, "e5")).not.toContain("e4");
  });

  it("到底线的兵只能横走 — 无路可退也不许退", () => {
    expect(targets(board({ a0: "P" }), "a0")).toEqual(["b0"]);
  });

  it("可吃敌子，不可吃己方子", () => {
    const pos = board({ e4: "P", e3: "p", d4: "P" });
    expect(targets(pos, "e4")).toEqual(["e3", "f4"]);
  });
});

describe("飞将", () => {
  it("同列且中间无子即为照面", () => {
    expect(kingsFaceEachOther(positionFrom("red", { e9: "K", e0: "k" }))).toBe(
      true,
    );
  });

  it("中间有子则不照面", () => {
    const pos = positionFrom("red", { e9: "K", e0: "k", e5: "P" });
    expect(kingsFaceEachOther(pos)).toBe(false);
  });

  it("不同列不照面", () => {
    expect(kingsFaceEachOther(positionFrom("red", { d9: "K", e0: "k" }))).toBe(
      false,
    );
  });

  it("走开挡在将门上的子是非法着法 — 马的八个方向全被封死", () => {
    // 马是唯一的遮挡，无论跳向哪里都会让双将照面
    const pos = positionFrom("red", { e9: "K", e0: "k", e5: "N" });
    expect(legalTargets(pos, "e5")).toEqual([]);
    expect(isLegalMove(pos, mv("e5", "d3"))).toBe(false);
  });

  it("另有子遮挡时，同一匹马的八个方向都可走", () => {
    // 与上一例只差 e2 这一个黑卒：马跳开后仍有子挡在将门上
    const pos = positionFrom("red", { e9: "K", e0: "k", e5: "N", e2: "p" });
    expect(legalTargets(pos, "e5")).toHaveLength(8);
  });

  it("将不能横移到与对方将同列", () => {
    const pos = positionFrom("red", { d9: "K", e0: "k" });
    expect(isLegalMove(pos, mv("d9", "e9"))).toBe(false);
    expect(isLegalMove(pos, mv("d9", "d8"))).toBe(true);
  });

  it("黑方同样受限", () => {
    const pos = positionFrom("black", { e9: "K", d0: "k" });
    expect(isLegalMove(pos, mv("d0", "e0"))).toBe(false);
    expect(isLegalMove(pos, mv("d0", "d1"))).toBe(true);
  });

  it("将帅上下颠倒的构造局面同样判定 — 扫描区间不能写死方向", () => {
    // positionFrom 不校验将的位置，残局编辑与测试完全可能把红帅摆在上方。
    // 若扫描区间写成「从黑将行到红帅行」，颠倒时区间为空，中间明明有子
    // 也会返回「无子相隔」= 照面，于是一堆合法着法被判非法。
    expect(kingsFaceEachOther(positionFrom("red", { e0: "K", e9: "k" }))).toBe(
      true,
    );
    const blocked = positionFrom("red", { e0: "K", e9: "k", e5: "P" });
    expect(kingsFaceEachOther(blocked)).toBe(false);
  });

  it("缺一方将帅时不判照面，也不能崩", () => {
    // 残局构造漏摆将是常态。这里必须返回 false 而不是抛错，
    // 否则「只摆几个子看走法」的用例会在毫不相干的地方炸掉。
    expect(kingsFaceEachOther(positionFrom("red", { e9: "K" }))).toBe(false);
    expect(kingsFaceEachOther(positionFrom("red", { e0: "k" }))).toBe(false);
  });
});

describe("自杀着法", () => {
  it("被牵制的子不能离开牵制线", () => {
    // 黑车 e2 与红帅 e9 同列，红马 e7 是唯一遮挡：马一动，红方即被将军
    const pos = positionFrom("red", { e9: "K", d0: "k", e7: "N", e2: "r" });
    expect(isInCheck(pos, "red")).toBe(false);
    // 牵制只在合法层生效，生成层照样吐出八个落点——这是刻意的分层，
    // 若生成阶段就判自杀会「生成 → 判自杀 → 生成对方着法」无限递归
    expect(targets(pos, "e7")).toHaveLength(8);
    expect(legalTargets(pos, "e7")).toEqual([]);
  });

  it("牵制线上没有敌方车时，同一匹马自由行动", () => {
    // 与上一例只差黑车所在的列
    const pos = positionFrom("red", { e9: "K", d0: "k", e7: "N", a2: "r" });
    expect(legalTargets(pos, "e7")).toHaveLength(8);
  });

  it("将不能走到被攻击的格子", () => {
    // 黑车控制 d 列，红帅可以走 e8 / f9，唯独不能走 d9
    const pos = positionFrom("red", { e9: "K", d0: "k", d2: "r" });
    expect(legalTargets(pos, "e9")).toEqual(["e8", "f9"]);
  });

  it("将不能走进炮的射程 — 炮对空格不生成着法，判定必须落子后再做", () => {
    // 炮的吃子着法只指向「炮架之后的第一个子」，空格上压根没有落点：
    // 走子前问「d9 被黑方攻击吗」得到的是 false。合法性因此必须在
    // 落子后的局面上判——提前判会让帅大摇大摆走进炮口，而车马兵的用例
    // 一个都察觉不到，因为只有炮有这个「先占位才被攻击」的特性。
    const pos = positionFrom("red", { e9: "K", f0: "k", d1: "c", d5: "p" });
    expect(isAttackedBy(pos, parseSquare("d9"), "black")).toBe(false);
    expect(isLegalMove(pos, mv("e9", "d9"))).toBe(false);
    expect(isLegalMove(pos, mv("e9", "e8"))).toBe(true);
  });
});

describe("将军与应将", () => {
  it("识别将军", () => {
    const pos = positionFrom("black", { e0: "k", f9: "K", e5: "R" });
    expect(isInCheck(pos, "black")).toBe(true);
    expect(isInCheck(pos, "red")).toBe(false);
  });

  it("被将军时只有解将的着法合法 — 避将与垫将", () => {
    // 红车 e5 沿 e 列将军。黑方只有两条路：将走 d0，或车 a2 垫到 e2。
    // f0 看似也能避将，但会与红帅 f9 照面，因此非法。
    const pos = positionFrom("black", { e0: "k", f9: "K", e5: "R", a2: "r" });
    expect(allLegal(pos)).toEqual(["a2-e2", "e0-d0"]);
  });

  it("被将军时可以吃掉将军的子", () => {
    // 红车 e1 贴脸将军：黑车可吃、黑将也可吃，或走 d0 避开
    const pos = positionFrom("black", { e0: "k", f9: "K", e1: "R", a1: "r" });
    expect(allLegal(pos)).toEqual(["a1-e1", "e0-d0", "e0-e1"]);
    expect(isCheckmate(pos)).toBe(false);
  });

  it("垫将后不再被将军", () => {
    const pos = positionFrom("black", { e0: "k", f9: "K", e5: "R", a2: "r" });
    const after = playMove(pos, mv("a2", "e2"));
    expect(after).not.toBeNull();
    expect(isInCheck(after!, "black")).toBe(false);
  });

  it("炮的将军可以靠「拆炮架」解除 — 象棋独有的应将手段", () => {
    // 红炮 e7 以黑马 e4 为炮架照将 e0。车马兵的将军只能靠避/吃/垫化解，
    // 炮多一条：把炮架挪走，将军当场消失。黑马跳到哪都离开 e 列，
    // 因此八个方向全部合法；黑将只剩 f0（d0 会与红帅 d9 照面）。
    const pos = positionFrom("black", { e0: "k", d9: "K", e7: "C", e4: "n" });
    expect(isInCheck(pos, "black")).toBe(true);
    expect(isCheckmate(pos)).toBe(false);
    expect(allLegal(pos)).toEqual([
      "e0-f0",
      "e4-c3",
      "e4-c5",
      "e4-d2",
      "e4-d6",
      "e4-f2",
      "e4-f6",
      "e4-g3",
      "e4-g5",
    ]);
  });

  it("缺将的构造局面不判将军 — 否则残局摆错会被掩盖成将死", () => {
    // isInCheck 找不到将时返回 false。若返回 true，任何漏摆将的测试局面
    // 都会被判成「被将军且无合法着法」= 将死，构造错误就永远浮不出来，
    // 而排查方向会被引到规则实现上，完全跑偏。
    const pos = positionFrom("red", { e5: "R", e0: "k" });
    expect(isInCheck(pos, "red")).toBe(false);
    expect(getOutcome(pos)).toEqual({ kind: "ongoing" });
  });
});

describe("胜负判定", () => {
  it("将死 — 双车错，退无可退", () => {
    // R a0 控制第 0 行（含 d0 / f0），R a1 控制第 1 行（含 e1）
    const pos = positionFrom("black", { e0: "k", f9: "K", a0: "R", a1: "R" });
    expect(isCheckmate(pos)).toBe(true);
    expect(isStalemate(pos)).toBe(false);
    expect(getOutcome(pos)).toEqual({ kind: "checkmate", winner: "red" });
  });

  it("少一只车就不是将死 — 黑将可以退到第 1 行", () => {
    const pos = positionFrom("black", { e0: "k", f9: "K", a0: "R" });
    expect(isCheckmate(pos)).toBe(false);
    expect(allLegal(pos)).toEqual(["e0-e1"]);
  });

  it("困毙 — 未被将军但无着可走，中国象棋判负而非和棋", () => {
    // 黑将 d0 不在攻击线上，但 d1（车 a1 控行）与 e0（车 e5 控列）都去不了
    const pos = positionFrom("black", { d0: "k", f9: "K", a1: "R", e5: "R" });
    expect(isInCheck(pos, "black")).toBe(false);
    expect(isStalemate(pos)).toBe(true);
    expect(isCheckmate(pos)).toBe(false);
    expect(getOutcome(pos)).toEqual({ kind: "stalemate", winner: "red" });
  });

  it("困毙不限于光杆将 — 手上有子但子也动不了，照样判负", () => {
    // 上一例只剩一只将，容易让「无着可走」退化成「将无路可走」。
    // 这里黑方还有一只象 c0：两只象眼 b1 / d1 都被红车塞住，象是死子。
    // 黑将 e0 的三个方向各由一条不同的规则封死——d0 被车 d1 控列、
    // e1 被车 d1 控行、f0 会与红帅 f9 照面（飞将也算封死手段之一）。
    const pos = positionFrom("black", {
      e0: "k",
      f9: "K",
      c0: "b",
      b1: "R",
      d1: "R",
    });
    expect(isInCheck(pos, "black")).toBe(false);
    expect(allLegal(pos)).toEqual([]);
    expect(getOutcome(pos)).toEqual({ kind: "stalemate", winner: "red" });
  });

  it("黑方也能赢 — 胜方取决于走子方，不是写死红胜", () => {
    // 上面所有终局用例都是红胜，胜方即使硬编码成 "red" 也全绿。
    // 这里把双车错整个红黑对调：红帅 e9 被黑方双车锁死。
    const pos = positionFrom("red", { e9: "K", d0: "k", a9: "r", a8: "r" });
    expect(isCheckmate(pos)).toBe(true);
    expect(getOutcome(pos)).toEqual({ kind: "checkmate", winner: "black" });
  });

  it("马后炮将死 — 将死判定不只认车", () => {
    // 红炮 e9 以自家马 e2 为炮架照将 e0，同一只马又控住 d0 / f0 两个逃点，
    // e1 仍在炮的射线上。三条退路各由「炮翻山」与「马走日」两种规则封死，
    // 只用车摆出来的将死局面验证不到这一层。
    const pos = positionFrom("black", { e0: "k", f8: "K", e9: "C", e2: "N" });
    expect(isInCheck(pos, "black")).toBe(true);
    expect(isCheckmate(pos)).toBe(true);
    expect(getOutcome(pos)).toEqual({ kind: "checkmate", winner: "red" });
  });

  it("有着可走则对局继续", () => {
    expect(getOutcome(initialPosition())).toEqual({ kind: "ongoing" });
  });
});

describe("状态转换", () => {
  it("初始局面双方各有 44 着 — 与公认值对齐的整体回归", () => {
    const pos = initialPosition();
    expect(legalMoves(pos)).toHaveLength(44);
    expect(legalMoves({ ...pos, sideToMove: "black" })).toHaveLength(44);
  });

  it("走子不修改原局面，并交换走子方", () => {
    const pos = initialPosition();
    const next = applyMove(pos, mv("e6", "e5"));

    expect(toFen(pos)).toBe(INITIAL_FEN);
    expect(next.board).not.toBe(pos.board);
    expect(next.sideToMove).toBe("black");
    expect(pieceAt(next, parseSquare("e5"))).toEqual({
      type: "P",
      side: "red",
    });
    expect(pieceAt(next, parseSquare("e6"))).toBeNull();
  });

  it("非法着法返回 null，而不是抛错 —— 拒绝是正常流程", () => {
    const pos = initialPosition();
    expect(playMove(pos, mv("e6", "e7"))).toBeNull();
    expect(playMove(pos, mv("e3", "e4"))).toBeNull();
    expect(playMove(pos, mv("e5", "e4"))).toBeNull();
  });

  it("同一输入重复调用结果一致 — 无隐藏状态", () => {
    const pos = initialPosition();
    expect(allLegal(pos)).toEqual(allLegal(pos));
    expect(toFen(pos)).toBe(INITIAL_FEN);
  });
});

/**
 * 逐层枚举合法着法并计数（perft）。
 *
 * 上面的用例都是「我认为规则是这样」的自证；perft 对的是**外部公认数字**
 * ——chessprogramming wiki 的 Chinese Chess Perft Results 页（数据来自
 * Duhamel 2013 与 Korzh 2021 的 TalkChess 帖），下面每个数字都逐一核对过
 * 该页表格，不是跑本实现跑出来再抄回来的。任何一条规则宽一格或紧一格，
 * 深层计数就对不上。手写用例挑不出的组合错误——某个方向的蹩马腿写反、
 * 炮在盘边的越界处理——会在这里暴露。
 *
 * **perft 管不到的部分**：它只递归 `legalMoves`，从不调用 `getOutcome` /
 * `isCheckmate` / `isStalemate`。终局判定（将死 vs 困毙 vs 继续、胜方归属）
 * 一个节点都没覆盖，只能靠上面「胜负判定」里的手写局面。
 */
function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  return legalMoves(pos).reduce(
    (sum, move) => sum + perft(applyMove(pos, move), depth - 1),
    0,
  );
}

describe("perft — 对照公认计数", () => {
  it("初始局面 1..3 层", () => {
    const pos = initialPosition();
    expect(perft(pos, 1)).toBe(44);
    expect(perft(pos, 2)).toBe(1920);
    expect(perft(pos, 3)).toBe(79666);
  });

  it("中局测试局面 1..3 层 — 炮阵密集，专治炮架与蹩马腿", () => {
    // 公认调试局面（wiki Position 2）：b7/c7/d7 三炮相邻，
    // 任何炮架判断的偏差都会立刻放大
    const pos = parseFen(
      "r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2BAKAB2 w - - 0 1",
    );
    expect(perft(pos, 1)).toBe(38);
    expect(perft(pos, 2)).toBe(1128);
    expect(perft(pos, 3)).toBe(43929);
  });

  it("应将测试局面 1..4 层 — 将军链路深，且顺带跑通 E/H 方言", () => {
    // wiki Position 4，原文即用 E/H 方言书写，这里照抄不改：
    // 一来省得手工转写出错，二来 FEN 方言支持在这条上也被真正用到。
    // 双方互有将军，前三层的初始局面根本走不到「解将后又被将军」这种链路，
    // 所以这条特意跑到第 4 层。
    const pos = parseFen("5a3/3k5/3aR4/9/5r3/5h3/9/3A1A3/5K3/2EC2E2 w - - 0 1");
    expect(perft(pos, 1)).toBe(25);
    expect(perft(pos, 2)).toBe(424);
    expect(perft(pos, 3)).toBe(9850);
    expect(perft(pos, 4)).toBe(202884);
  }, 30_000);
});
