/**
 * 围棋规则引擎。
 *
 * 纯函数、不可变。服务端权威裁定与客户端即时预测共用同一份实现。
 */

export type { Board, BoardSize, Player, Stone } from "./board";
export {
  BLACK,
  EMPTY,
  WHITE,
  createBoard,
  inBounds,
  neighbors,
  opponent,
  stoneAt,
  toCoord,
  toIndex,
} from "./board";

export type { Group } from "./group";
export { collectGroup, countLiberties, findCaptured, isEye } from "./group";

export type { GoState, PlayResult, RejectReason } from "./rules";
export { createGame, isLegal, pass, play } from "./rules";

export type { Score } from "./score";
export { scoreGame } from "./score";
