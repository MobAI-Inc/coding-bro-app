/**
 * 本地对局服务端（占位实现）。
 *
 * 与围棋那份同构：真服务端的替身，不是「客户端裁定」的后门。它遵守服务端的
 * 全部行为约定（自持权威状态、校验版本与座位、拒绝时不下发快照），等服务端
 * 就绪时换成 WebSocket 客户端即可，渲染器与页面一行不动。
 *
 * 台球比围棋多一条：**意图里带的是击球参数，不是球位**。服务端拿参数自己演算，
 * 客户端算出来的球位一概不信 —— 这正是定点数解算器存在的理由。
 */

import type { GameState, InputIntent } from "../../core/types";
import { toFloat } from "../logic/fixed";
import { vec2 } from "../logic/vec";
import type { EightBallState, ShotOutcome } from "../logic/rules";
import {
  groupOfSeat,
  legalTargets,
  otherSeat,
  placeCueBall,
  rackEightBall,
  shoot,
} from "../logic/rules";
import type { StrikeParams } from "../logic/solver";
import type { TableState } from "../logic/ball";
import type { BallView, BilliardsView, PlacePayload, ShotView } from "../view";
import { BILLIARDS_INTENT } from "../view";

export interface Rejection {
  readonly reason: string;
  readonly detail?: string;
}

export interface LocalBilliardsServerOptions {
  readonly matchId?: string;
  readonly mySeat?: number;
  readonly onSnapshot: (snapshot: GameState<BilliardsView>) => void;
  readonly onReject?: (rejection: Rejection) => void;
}

export class LocalBilliardsServer {
  private state: EightBallState;
  private version = 0;
  private lastShot: ShotView | null = null;
  private motion: readonly (readonly BallView[])[] | null = null;

  private readonly matchId: string;
  private readonly mySeat: number;
  private readonly onSnapshot: (snapshot: GameState<BilliardsView>) => void;
  private readonly onReject: (rejection: Rejection) => void;

  constructor(options: LocalBilliardsServerOptions) {
    this.mySeat = options.mySeat ?? 0;
    this.state = rackEightBall(0);
    this.matchId = options.matchId ?? "local";
    this.onSnapshot = options.onSnapshot;
    this.onReject = options.onReject ?? (() => {});
  }

  start(): void {
    this.emit();
  }

  submit(intent: InputIntent): void {
    if (intent.matchId !== this.matchId) {
      return this.onReject({ reason: "wrong_match" });
    }
    if (intent.basedOnVersion !== this.version) {
      return this.onReject({
        reason: "stale_version",
        detail: `客户端基于 v${intent.basedOnVersion}，当前 v${this.version}`,
      });
    }
    if (this.state.turn !== this.mySeat) {
      return this.onReject({ reason: "not_your_turn" });
    }

    if (intent.type === BILLIARDS_INTENT.place) {
      return this.applyPlace(intent.payload as PlacePayload);
    }
    if (intent.type === BILLIARDS_INTENT.strike) {
      return this.applyStrike(intent.payload as StrikeParams);
    }
    this.onReject({ reason: "unknown_intent", detail: intent.type });
  }

  /** 代替对手行动。只在本地开发与测试里用。 */
  playAsOpponent(params: StrikeParams): void {
    if (this.state.turn === this.mySeat) return;
    // 对手若持球在手，先把母球摆回台面中线，再击球。
    if (this.state.ballInHand) {
      const placed = placeCueBall(this.state, vec2(0, 0));
      if (placed.ok) this.state = placed.state;
    }
    const result = shoot(this.state, params, true);
    if (!result.ok) return;
    this.commit(result.state, result.outcome, result.frames);
  }

  authoritativeState(): EightBallState {
    return this.state;
  }

  private applyPlace(payload: PlacePayload): void {
    // 界面传的是米（浮点），逻辑层要定点数。换算在这一层做：客户端发过来的
    // 任何数都要重新过一遍合法性，`placeCueBall` 里那三条校验就是干这个的。
    const result = placeCueBall(
      this.state,
      vec2(toFixed(payload.x), toFixed(payload.y)),
    );
    if (!result.ok) return this.onReject({ reason: result.reason });
    this.state = result.state;
    this.version += 1;
    this.emit();
  }

  private applyStrike(params: StrikeParams): void {
    const result = shoot(this.state, params, true);
    if (!result.ok) return this.onReject({ reason: result.reason });
    this.commit(result.state, result.outcome, result.frames);
  }

  private commit(
    next: EightBallState,
    outcome: ShotOutcome,
    frames: readonly TableState[],
  ): void {
    const seat = this.state.turn;
    this.state = next;
    this.lastShot = {
      foul: outcome.foul,
      pocketed: outcome.pocketed,
      seat,
    };
    this.motion = frames.map(toBallView);
    this.version += 1;
    this.emit();
  }

  private emit(): void {
    const balls: BallView[] = this.state.table.balls.map((b) => ({
      id: b.id,
      x: toFloat(b.pos.x),
      y: toFloat(b.pos.y),
      pocketed: b.pocketed,
    }));

    const view: BilliardsView = {
      balls,
      motion: this.motion,
      myGroup: groupOfSeat(this.state, this.mySeat),
      targets: legalTargets(this.state, this.state.turn),
      ballInHand: this.state.ballInHand,
      broken: this.state.broken,
      lastShot: this.lastShot,
      winner: this.state.winner,
    };

    this.onSnapshot({
      matchId: this.matchId,
      gameId: "billiards",
      phase: this.state.winner === null ? "playing" : "finished",
      version: this.version,
      activeSeat: this.state.winner === null ? this.state.turn : null,
      mySeat: this.mySeat,
      board: view,
    });
    this.motion = null;
  }
}

function toBallView(table: TableState): readonly BallView[] {
  return table.balls.map((b) => ({
    id: b.id,
    x: toFloat(b.pos.x),
    y: toFloat(b.pos.y),
    pocketed: b.pocketed,
  }));
}

/** 米（浮点）→ Q16.16。只在服务端入口用，逻辑层内部一律定点数。 */
function toFixed(meters: number): number {
  return Math.round(meters * 65536);
}

/** 对手座位。导出给页面驱动机器人用。 */
export { otherSeat };
