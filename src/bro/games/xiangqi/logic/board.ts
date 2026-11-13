/**
 * 中国象棋棋盘表示与坐标工具。
 *
 * 棋盘 9 列 × 10 行，红方在下（row 9 一侧）、黑方在上（row 0 一侧）。
 * 行序刻意与 FEN 的书写顺序一致（FEN 第一段先写 row 0，即黑方底线），
 * 这样 FEN 往返不需要翻转行序——若反过来把红方定在 row 0，每次读写 FEN
 * 都要做一次镜像，而镜像漏做一处就是难查的错位 bug。
 *
 * 局面用一维数组（索引 `row * 9 + col`）而非二维数组：不可变更新只需一次
 * `slice`，二维数组要逐行复制，容易写成浅拷贝而让新旧局面共享行。
 *
 * 本文件（以及 moves/rules）全部是纯函数：不改入参、不读时钟、不取随机数。
 * 这套规则将来要在服务端（权威）与客户端（预测）跑同一份，任何隐藏状态或
 * 副作用都会让两边分叉，而分叉在对局中表现为「我明明走了这步」的争议。
 */

/** 对局双方。红先。 */
export type Side = "red" | "black";

/**
 * 棋子种类。红黑同型用同一个标识（如「相」与「象」都是 `B`）——它们规则
 * 完全相同，区分只在显示层，规则层区分只会让每处判断都要写两遍。
 */
export type PieceType =
  /** 将 / 帅 */
  | "K"
  /** 士 / 仕 */
  | "A"
  /** 象 / 相 */
  | "B"
  /** 马 */
  | "N"
  /** 车 */
  | "R"
  /** 炮 */
  | "C"
  /** 兵 / 卒 */
  | "P";

export interface Piece {
  readonly type: PieceType;
  readonly side: Side;
}

/** 棋盘坐标。`col` 0..8 从黑方视角自左向右，`row` 0..9 自黑方底线向红方底线。 */
export interface Square {
  readonly col: number;
  readonly row: number;
}

/**
 * 局面快照。
 *
 * 只含「重演棋盘所必需」的信息：子力分布 + 该谁走。回合数、历史着法不放在
 * 这里——它们属于对局记录，规则判定用不到，混进来会让局面比较（如判重复）
 * 失去意义。
 */
export interface Position {
  readonly board: readonly (Piece | null)[];
  readonly sideToMove: Side;
}

export const FILES = 9;
export const RANKS = 10;
export const BOARD_SIZE = FILES * RANKS;

/** 河界在 row 4 与 row 5 之间：row 0..4 属黑方，row 5..9 属红方。 */
const BLACK_LAST_ROW = 4;

/** 九宫的列范围。红黑相同，只有行范围不同。 */
const PALACE_MIN_COL = 3;
const PALACE_MAX_COL = 5;
const RED_PALACE_MIN_ROW = 7;
const BLACK_PALACE_MAX_ROW = 2;

/** 初始局面的 FEN。 */
export const INITIAL_FEN =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

const FILE_LETTERS = "abcdefghi";

/**
 * FEN 字符到棋子种类。
 *
 * 同时接受两种 FEN 方言：马写 `n`(knight) 或 `h`(horse)，象写 `b`(bishop)
 * 或 `e`(elephant)。棋谱来源杂乱，解析端宽容、输出端统一，比要求所有上游
 * 都改用同一方言现实。
 */
const CHAR_TO_TYPE: Readonly<Record<string, PieceType>> = {
  k: "K",
  a: "A",
  b: "B",
  e: "B",
  n: "N",
  h: "N",
  r: "R",
  c: "C",
  p: "P",
};

/** 全部 90 个格子，按索引顺序。供需要遍历棋盘的判定（如被攻击查询）使用。 */
export const ALL_SQUARES: readonly Square[] = Object.freeze(
  Array.from({ length: BOARD_SIZE }, (_, i) =>
    Object.freeze({ col: i % FILES, row: Math.floor(i / FILES) }),
  ),
);

/** 构造坐标。不校验是否在盘内——越界判断交给 {@link isOnBoard}。 */
export function square(col: number, row: number): Square {
  return { col, row };
}

/** 坐标是否在棋盘内。 */
export function isOnBoard(sq: Square): boolean {
  return sq.col >= 0 && sq.col < FILES && sq.row >= 0 && sq.row < RANKS;
}

/** 坐标转一维索引。调用方需自行保证坐标在盘内。 */
export function squareIndex(sq: Square): number {
  return sq.row * FILES + sq.col;
}

/** 两个坐标是否指同一格。`Square` 是值对象，不能用 `===` 比较。 */
export function sameSquare(a: Square, b: Square): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * 读取某格的棋子，空格或越界返回 `null`。
 *
 * 越界返回 `null`（而非抛错）让滑行类着法生成可以先读后判，但也埋了个坑：
 * 「越界」与「空格」不可区分。凡是把「空格」当作可通过的判断（如蹩马腿的
 * 马腿格），必须先确认目标格在盘内，见 moves.ts 中马的生成。
 */
export function pieceAt(pos: Position, sq: Square): Piece | null {
  if (!isOnBoard(sq)) return null;
  return pos.board[squareIndex(sq)];
}

/** 另一方。 */
export function opponent(side: Side): Side {
  return side === "red" ? "black" : "red";
}

/** 该方「向前」在 row 上的增量。红方在下，向前是 row 减小。 */
export function forwardStep(side: Side): number {
  return side === "red" ? -1 : 1;
}

/** 坐标是否在该方的九宫内。 */
export function isInPalace(sq: Square, side: Side): boolean {
  if (!isOnBoard(sq)) return false;
  if (sq.col < PALACE_MIN_COL || sq.col > PALACE_MAX_COL) return false;
  return side === "red"
    ? sq.row >= RED_PALACE_MIN_ROW
    : sq.row <= BLACK_PALACE_MAX_ROW;
}

/**
 * 该坐标对该方而言是否已过河。
 *
 * 注意这是「相对于哪一方」的判断：row 3 对黑方是自家地界，对红方却是过了河。
 * 写成绝对的「上半区/下半区」是常见错误，会让黑方的兵卒与象的规则整体镜像失效。
 */
export function hasCrossedRiver(sq: Square, side: Side): boolean {
  return side === "red" ? sq.row <= BLACK_LAST_ROW : sq.row > BLACK_LAST_ROW;
}

/** 生成在某格放置（或清除，传 `null`）棋子后的新局面。原局面不被修改。 */
export function withPiece(
  pos: Position,
  sq: Square,
  piece: Piece | null,
): Position {
  const board = pos.board.slice();
  board[squareIndex(sq)] = piece;
  return { board, sideToMove: pos.sideToMove };
}

/** 找到某方的将/帅。棋子被吃或测试局面未摆将时返回 `null`。 */
export function findKing(pos: Position, side: Side): Square | null {
  for (const sq of ALL_SQUARES) {
    const piece = pos.board[squareIndex(sq)];
    if (piece !== null && piece.type === "K" && piece.side === side) return sq;
  }
  return null;
}

/**
 * 解析坐标串，如 `"e0"`（黑方底线的将位）、`"a9"`（红方左侧角上的车位）。
 *
 * 列用 a..i，行直接用 0..9 的行号——不采用传统棋谱的「炮二平五」，那套记法
 * 依赖走子方视角，红黑同一句话指向不同格子，用作内部坐标只会制造歧义。
 */
export function parseSquare(text: string): Square {
  const col = text.length === 2 ? FILE_LETTERS.indexOf(text[0]) : -1;
  const row = Number(text.slice(1));
  const sq = square(col, row);
  if (col < 0 || !Number.isInteger(row) || !isOnBoard(sq)) {
    throw new Error(`非法坐标: ${text}`);
  }
  return sq;
}

/** 坐标转字符串，{@link parseSquare} 的逆。 */
export function formatSquare(sq: Square): string {
  return `${FILE_LETTERS[sq.col]}${sq.row}`;
}

/** FEN 字符转棋子。大写为红、小写为黑。无法识别时返回 `null`。 */
function pieceFromChar(char: string): Piece | null {
  const type = CHAR_TO_TYPE[char.toLowerCase()];
  if (type === undefined) return null;
  return { type, side: char === char.toUpperCase() ? "red" : "black" };
}

/** 棋子转 FEN 字符。 */
function charFromPiece(piece: Piece): string {
  return piece.side === "red" ? piece.type : piece.type.toLowerCase();
}

/**
 * 解析 FEN 局面串。
 *
 * 只读前两段（子力分布、走子方），其余段（吃子计数、回合数）忽略：规则判定
 * 用不到，强行解析反而会因上游格式不齐而抛错。走子方缺省为红。
 *
 * @throws 格式非法时抛错。FEN 由程序或棋谱提供，不是玩家输入，格式错属于
 * 缺陷而非正常流程，静默容错只会把问题推到更远处。
 */
export function parseFen(fen: string): Position {
  const [layout, sideField] = fen.trim().split(/\s+/);
  const ranks = layout?.split("/") ?? [];
  if (ranks.length !== RANKS) {
    throw new Error(`FEN 应有 ${RANKS} 行，实际 ${ranks.length} 行: ${fen}`);
  }

  const board: (Piece | null)[] = new Array(BOARD_SIZE).fill(null);
  ranks.forEach((rank, row) => {
    let col = 0;
    for (const char of rank) {
      if (char >= "1" && char <= "9") {
        col += Number(char);
        continue;
      }
      const piece = pieceFromChar(char);
      if (piece === null) throw new Error(`FEN 含未知棋子 '${char}': ${fen}`);
      if (col >= FILES) break;
      board[row * FILES + col] = piece;
      col += 1;
    }
    if (col !== FILES) {
      throw new Error(`FEN 第 ${row} 行宽度为 ${col}，应为 ${FILES}: ${fen}`);
    }
  });

  return { board, sideToMove: sideField === "b" ? "black" : "red" };
}

/** 序列化为 FEN。与 {@link parseFen} 往返一致。 */
export function toFen(pos: Position): string {
  const ranks: string[] = [];
  for (let row = 0; row < RANKS; row += 1) {
    let rank = "";
    let empty = 0;
    for (let col = 0; col < FILES; col += 1) {
      const piece = pos.board[row * FILES + col];
      if (piece === null) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        rank += String(empty);
        empty = 0;
      }
      rank += charFromPiece(piece);
    }
    if (empty > 0) rank += String(empty);
    ranks.push(rank);
  }
  const side = pos.sideToMove === "red" ? "w" : "b";
  return `${ranks.join("/")} ${side} - - 0 1`;
}

/** 初始局面。 */
export function initialPosition(): Position {
  return parseFen(INITIAL_FEN);
}

/**
 * 用「坐标 → FEN 字符」的稀疏表构造局面。
 *
 * 残局与测试局面多数只有几个子，用 FEN 写要数一长串数字（`4k4/9/...`），
 * 数错一位就是完全不同的局面且极难看出。稀疏表直接写 `{ e0: "k" }`，
 * 错了也是显式的。
 *
 * @example positionFrom("red", { e9: "K", e0: "k", b7: "N" })
 */
export function positionFrom(
  sideToMove: Side,
  placements: Readonly<Record<string, string>>,
): Position {
  const board: (Piece | null)[] = new Array(BOARD_SIZE).fill(null);
  for (const [key, char] of Object.entries(placements)) {
    const piece = pieceFromChar(char);
    if (piece === null) throw new Error(`未知棋子 '${char}' @ ${key}`);
    board[squareIndex(parseSquare(key))] = piece;
  }
  return { board, sideToMove };
}
