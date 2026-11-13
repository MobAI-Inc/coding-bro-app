/**
 * 立直麻将本地对局服务端（占位实现）。
 *
 * 与围棋、台球那两个同构：自己持有权威状态，校验对局 id / 版本 / 座位，拒绝时
 * 不下发快照。等真服务端就绪，把这个类换成 WebSocket 客户端即可，渲染器、会话、
 * 页面一行都不用改。
 *
 * 麻将比那两个多一条约束：**下发前要按座位裁剪**。`RoundState` 里有三家的手牌、
 * 整条牌山、里宝牌指示 —— 这些一旦下发就等于公开底牌。裁剪在 `emit()` 里做，
 * 是这个类唯一比围棋那版多出来的实质逻辑，也是最不能省的一段。
 *
 * 上线后本文件只应出现在开发与测试路径里。匹配制下对手是陌生人，客户端裁定
 * 等于把作弊入口敞开。
 */

import type { GameState, InputIntent } from "../../core/types";
import type { RoundState, Seat } from "../match/round";
import {
  discard,
  isFuriten,
  passCall,
  ron,
  startRound,
  waitingTiles,
} from "../match/round";
import {
  canRon,
  canTsumo,
  resolveDiscard,
  playTurn,
  tenpaiDiscards,
} from "../match/bot";
import { tsumo } from "../match/round";
import type {
  DiscardPayload,
  OpponentView,
  RiichiView,
  SelfView,
} from "../view";
import { RIICHI_INTENT } from "../view";

/** 意图被拒的原因。透传给界面用于提示，不影响状态。 */
export interface Rejection {
  readonly reason: string;
  readonly detail?: string;
}

export interface LocalRiichiServerOptions {
  readonly seed?: number;
  readonly matchId?: string;
  /** 本机玩家占哪个座位。另外三席交给机器人。 */
  readonly mySeat?: Seat;
  readonly dealer?: Seat;
  readonly onSnapshot: (snapshot: GameState<RiichiView>) => void;
  readonly onReject?: (rejection: Rejection) => void;
}

export class LocalRiichiServer {
  private state: RoundState;
  private version = 0;

  private readonly matchId: string;
  private readonly mySeat: Seat;
  private readonly onSnapshot: (snapshot: GameState<RiichiView>) => void;
  private readonly onReject: (rejection: Rejection) => void;

  constructor(options: LocalRiichiServerOptions) {
    this.state = startRound({
      seed: options.seed ?? 1,
      dealer: options.dealer ?? 0,
    });
    this.matchId = options.matchId ?? "local";
    this.mySeat = options.mySeat ?? 0;
    this.onSnapshot = options.onSnapshot;
    this.onReject = options.onReject ?? (() => {});
  }

  /** 下发首帧快照。若开局就轮不到人类，先把机器人推到人类该动为止。 */
  start(): void {
    this.advanceBots();
    this.emit();
  }

  /**
   * 处理一条意图。
   *
   * 合法则推进状态并下发新快照；非法则只回错误，状态与版本都不动 —— 版本一旦
   * 因非法操作而前进，客户端的 `basedOnVersion` 校验就失去意义。
   */
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
    if (this.state.phase === "finished") {
      return this.onReject({ reason: "round_over" });
    }

    const result = this.dispatch(intent);
    if (result === null) {
      return this.onReject({ reason: "unknown_intent", detail: intent.type });
    }
    if (!result.ok) {
      // 无役荣和是唯一一条会改状态的拒绝（宣告者吃同巡振听）。要落地那个处罚，
      // 但**不能**推进版本 —— 对客户端而言这次操作是失败的，它手上的
      // basedOnVersion 必须继续有效。
      this.state = result.state;
      return this.onReject({ reason: result.reason });
    }

    this.state = result.state;
    this.version += 1;
    this.advanceBots();
    this.emit();
  }

  /** 当前权威状态。仅供测试断言，界面一律走快照。 */
  authoritativeState(): RoundState {
    return this.state;
  }

  private dispatch(intent: InputIntent) {
    switch (intent.type) {
      case RIICHI_INTENT.discard: {
        const payload = intent.payload as DiscardPayload;
        return discard(
          this.state,
          this.mySeat,
          payload.tile,
          payload.riichi === true,
        );
      }
      case RIICHI_INTENT.tsumo:
        return tsumo(this.state, this.mySeat);
      case RIICHI_INTENT.ron:
        return ron(this.state, this.mySeat);
      case RIICHI_INTENT.pass:
        // 人类明确放弃响应。放过一次能和的牌要吃同巡振听 —— 不罚的话，
        // 玩家可以先放过看看别家怎么打，再回头和同一张牌。
        return this.passAsHuman();
      default:
        return null;
    }
  }

  /** 人类放弃响应：先记同巡振听（如果他确实能和），再流转。 */
  private passAsHuman() {
    if (!canRon(this.state, this.mySeat)) return passCall(this.state);
    const players = this.state.players.map((p, i) =>
      i === this.mySeat ? { ...p, temporaryFuriten: true } : p,
    ) as unknown as RoundState["players"];
    return passCall({ ...this.state, players });
  }

  /**
   * 推进机器人，直到轮到人类行动或对局结束。
   *
   * 版本只在 `submit` 里加一次 —— 机器人这几步是同一个「客户端动作的后果」，
   * 分开发版本会让界面收到一串中间帧，看着像卡顿。
   */
  private advanceBots(): void {
    for (let guard = 0; guard < 200; guard += 1) {
      if (this.state.phase === "finished") return;

      if (this.state.phase === "awaiting_discard") {
        if (this.state.turn === this.mySeat) return;
        const r = playTurn(this.state, this.state.turn);
        // 机器人被状态机拒绝说明两者对规则的理解不一致，是必须暴露的 bug。
        // 但在运行时硬跳出去会让对局永久卡死，所以这里退回等待人类。
        if (!r.ok) return;
        this.state = r.state;
        continue;
      }

      // awaiting_call：人类能荣就停下来等他决定
      if (canRon(this.state, this.mySeat)) return;
      const r = resolveDiscard(this.state, this.mySeat);
      if (!r.ok) return;
      this.state = r.state;
    }
  }

  /**
   * 按座位裁剪后下发。
   *
   * 三家手牌、牌山、里宝牌都在权威状态里，这里一个都不能漏出去。
   */
  private emit(): void {
    const s = this.state;
    const me = s.players[this.mySeat];
    const finished = s.phase === "finished";
    const waits = waitingTiles(me.hand, me.melds);

    const self: SelfView = {
      seat: this.mySeat,
      hand: me.hand,
      melds: me.melds,
      discards: me.discards,
      points: me.points,
      riichi: me.riichi,
      drawn: s.turn === this.mySeat ? s.lastDraw : null,
      canTsumo: canTsumo(s, this.mySeat),
      canRon: canRon(s, this.mySeat),
      canRiichi:
        !me.riichi &&
        !me.melds.some((m) => m.opened) &&
        me.points >= 1000 &&
        s.phase === "awaiting_discard" &&
        s.turn === this.mySeat &&
        tenpaiDiscards(s, this.mySeat).length > 0,
      tenpaiDiscards: tenpaiDiscards(s, this.mySeat),
      waits,
      furiten: isFuriten(me, waits),
    };

    const opponents: OpponentView[] = [1, 2, 3].map((offset) => {
      const seat = ((this.mySeat + offset) % 4) as Seat;
      const p = s.players[seat];
      return {
        seat,
        // 只给张数。牌本身留在服务端。
        handCount: p.hand.length,
        melds: p.melds,
        discards: p.discards,
        points: p.points,
        riichi: p.riichi,
      };
    });

    const view: RiichiView = {
      self,
      opponents,
      doraIndicators: s.deadWall.slice(0, s.doraRevealed),
      wallRemaining: s.wall.length,
      roundWind: s.roundWind,
      dealer: s.dealer,
      honba: s.honba,
      riichiSticks: s.riichiSticks,
      lastDiscard: s.lastDiscard,
      result: s.result,
      // 里宝牌只在终局给。提前给出去，立直的人就能提前算出自己的打点
      uraDoraIndicators: finished
        ? s.deadWall.slice(5, 5 + s.doraRevealed)
        : [],
    };

    this.onSnapshot({
      matchId: this.matchId,
      gameId: "riichi",
      phase: finished ? "finished" : "playing",
      version: this.version,
      // 等待响应且人类能荣时，activeSeat 是人类而不是 `turn`。
      // `canAct()` 按 activeSeat === mySeat 判断能不能操作 —— 填 `turn`
      // 的话，轮到别人打牌、人类却能荣的那一刻，界面会把「荣」按钮灰掉。
      activeSeat: finished
        ? null
        : s.phase === "awaiting_call" && self.canRon
          ? this.mySeat
          : s.turn,
      mySeat: this.mySeat,
      board: view,
    });
  }
}
