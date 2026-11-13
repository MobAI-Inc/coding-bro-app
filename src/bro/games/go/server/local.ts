/**
 * 本地对局服务端（占位实现）。
 *
 * 这是真服务端的替身，不是「客户端算分」的后门。它存在的意义是让整条
 * 链路——意图上报 → 权威裁定 → 快照下发 → 渲染——现在就能跑起来并被
 * 测试，等服务端就绪时把这一个类换成 WebSocket 客户端即可，渲染器、
 * 会话、页面一行都不用改。
 *
 * 因此它刻意遵守服务端的全部行为约定：
 *
 * - 自己持有权威 `GoState`，不接受客户端传来的局面
 * - 校验 `basedOnVersion`，拒绝基于过期局面的意图
 * - 校验座位，拒绝替别人走棋
 * - 拒绝时不下发新快照，只回一个错误——客户端界面不会因为非法操作而变化
 *
 * 上线后本文件只应出现在开发与测试路径里。真实对局的裁定必须在服务端，
 * 匹配制下对手是陌生人，客户端裁定等于把作弊入口敞开。
 */

import type { GameState, InputIntent } from "../../core/types";
import type { BoardSize, GoState } from "../logic";
import { createGame, pass, play, scoreGame, toCoord } from "../logic";
import type { GoView, PlacePayload } from "../view";
import { GO_INTENT, seatOfPlayer } from "../view";

/** 意图被拒的原因。透传给界面用于提示，不影响状态。 */
export interface Rejection {
  readonly reason: string;
  readonly detail?: string;
}

export interface LocalGoServerOptions {
  readonly size?: BoardSize;
  readonly matchId?: string;
  /** 本机玩家占哪个座位。另一座位留给对手（人或 AI）。 */
  readonly mySeat?: number;
  readonly komi?: number;
  readonly onSnapshot: (snapshot: GameState<GoView>) => void;
  readonly onReject?: (rejection: Rejection) => void;
}

export class LocalGoServer {
  private state: GoState;
  private version = 0;
  private lastMove: number | null = null;

  private readonly matchId: string;
  private readonly mySeat: number;
  private readonly komi: number;
  private readonly onSnapshot: (snapshot: GameState<GoView>) => void;
  private readonly onReject: (rejection: Rejection) => void;

  constructor(options: LocalGoServerOptions) {
    this.state = createGame(options.size ?? 19);
    this.matchId = options.matchId ?? "local";
    this.mySeat = options.mySeat ?? 0;
    this.komi = options.komi ?? 7.5;
    this.onSnapshot = options.onSnapshot;
    this.onReject = options.onReject ?? (() => {});
  }

  /** 下发首帧快照。对应真服务端撮合成功后的开局推送。 */
  start(): void {
    this.emit();
  }

  /**
   * 处理一条意图。
   *
   * 合法则推进状态并下发新快照；非法则只回错误，状态与版本都不动——
   * 版本一旦因非法操作而前进，客户端的 `basedOnVersion` 校验就失去意义。
   */
  submit(intent: InputIntent): void {
    if (intent.matchId !== this.matchId) {
      return this.onReject({ reason: "wrong_match" });
    }
    if (intent.basedOnVersion !== this.version) {
      // 客户端基于旧局面操作。多发生在网络抖动后补发，属正常流程。
      return this.onReject({
        reason: "stale_version",
        detail: `客户端基于 v${intent.basedOnVersion}，当前 v${this.version}`,
      });
    }

    const seat = seatOfPlayer(this.state.toPlay);
    if (seat !== this.mySeat) {
      return this.onReject({ reason: "not_your_turn" });
    }

    const result =
      intent.type === GO_INTENT.pass
        ? pass(this.state, this.state.toPlay)
        : intent.type === GO_INTENT.place
          ? this.applyPlace(intent.payload as PlacePayload)
          : null;

    if (result === null) {
      return this.onReject({ reason: "unknown_intent", detail: intent.type });
    }
    if (!result.ok) {
      return this.onReject({ reason: result.reason });
    }

    this.state = result.state;
    this.lastMove =
      intent.type === GO_INTENT.place
        ? (intent.payload as PlacePayload).index
        : null;
    this.version += 1;
    this.emit();
  }

  /**
   * 代替对手走一手。
   *
   * 只在本地开发与测试里用——真服务端的对手来自匹配，不由客户端驱动。
   */
  playAsOpponent(index: number | "pass"): void {
    const player = this.state.toPlay;
    if (seatOfPlayer(player) === this.mySeat) return;

    const result =
      index === "pass"
        ? pass(this.state, player)
        : this.applyPlaceAs(player, index);
    if (!result.ok) return;

    this.state = result.state;
    this.lastMove = index === "pass" ? null : index;
    this.version += 1;
    this.emit();
  }

  /** 当前权威状态。仅供测试断言，界面一律走快照。 */
  authoritativeState(): GoState {
    return this.state;
  }

  private applyPlace(payload: PlacePayload) {
    return this.applyPlaceAs(this.state.toPlay, payload.index);
  }

  private applyPlaceAs(player: GoState["toPlay"], index: number) {
    const { row, col } = toCoord(this.state.board.size, index);
    return play(this.state, player, row, col);
  }

  private emit(): void {
    const { board, koPoint, captures, consecutivePasses, finished } =
      this.state;
    const view: GoView = {
      size: board.size,
      cells: board.cells,
      koPoint,
      captures: { black: captures[1], white: captures[2] },
      lastMove: this.lastMove,
      passes: consecutivePasses,
      score: finished ? scoreGame(board, this.komi) : null,
    };

    this.onSnapshot({
      matchId: this.matchId,
      gameId: "go",
      phase: finished ? "finished" : "playing",
      version: this.version,
      activeSeat: finished ? null : seatOfPlayer(this.state.toPlay),
      mySeat: this.mySeat,
      board: view,
    });
  }
}
