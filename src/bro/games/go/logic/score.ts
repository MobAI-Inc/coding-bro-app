/**
 * 终局计分（中国规则数子法）。
 *
 * 一方得分 = 盘上活子数 + 己方独占的空点数。
 *
 * **前提：死子已被提净。** 这是标准终局流程——双方连续虚手前会先把
 * 明显的死子提掉或达成一致。自动判定死活需要完整的死活分析（实践中
 * 要靠 KataGo 这类引擎），不属于规则引擎的职责。若在死子仍在盘上时
 * 调用本函数，结果会偏向死子的一方，这是已知且刻意的限制。
 */

import type { Board, Player } from "./board";
import { BLACK, EMPTY, WHITE, neighbors } from "./board";

export interface Score {
  readonly [BLACK]: number;
  readonly [WHITE]: number;
  /** 贴目后的净胜方。平局为 `null`。 */
  readonly winner: Player | null;
  /** 黑领先的目数（负数表示白领先），已计入贴目。 */
  readonly margin: number;
}

/**
 * 数子计分。
 *
 * @param board 终局棋盘
 * @param komi 贴目，中国规则常用 7.5（半目可避免平局）
 */
export function scoreGame(board: Board, komi = 7.5): Score {
  let black = 0;
  let white = 0;

  for (const cell of board.cells) {
    if (cell === BLACK) black += 1;
    else if (cell === WHITE) white += 1;
  }

  for (const region of emptyRegions(board)) {
    // 只被单一颜色包围的空区才算该方的地；双方都能触及的是公气，不计分
    if (region.owner === BLACK) black += region.points.size;
    else if (region.owner === WHITE) white += region.points.size;
  }

  const margin = black - (white + komi);
  return {
    [BLACK]: black,
    [WHITE]: white,
    winner: margin > 0 ? BLACK : margin < 0 ? WHITE : null,
    margin,
  };
}

interface EmptyRegion {
  readonly points: ReadonlySet<number>;
  /** 独占该区的一方；双方都接触则为 `null`（公气）。 */
  readonly owner: Player | null;
}

/** 把所有空点按连通性切分成区域，并判定各区归属。 */
function emptyRegions(board: Board): EmptyRegion[] {
  const seen = new Set<number>();
  const regions: EmptyRegion[] = [];

  for (let start = 0; start < board.cells.length; start += 1) {
    if (board.cells[start] !== EMPTY || seen.has(start)) continue;

    const points = new Set<number>([start]);
    const borders = new Set<Player>();
    const stack = [start];
    seen.add(start);

    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of neighbors(board.size, current)) {
        const cell = board.cells[next];
        if (cell === EMPTY) {
          if (!points.has(next)) {
            points.add(next);
            seen.add(next);
            stack.push(next);
          }
        } else {
          borders.add(cell as Player);
        }
      }
    }

    regions.push({
      points,
      owner: borders.size === 1 ? [...borders][0] : null,
    });
  }

  return regions;
}
