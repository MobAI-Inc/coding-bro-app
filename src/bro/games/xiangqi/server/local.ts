/**
 * 本地对局服务端（占位实现）。
 *
 * 这是真服务端的替身，不是「客户端算规则」的后门。它存在的意义是让整条
 * 链路——意图上报 → 权威裁定 → 快照下发 → 渲染——现在就能跑起来并被测试，
 * 等服务端就绪时把这一个类换成 WebSocket 客户端即可，渲染器、会话、页面
 * 一行都不用改。
 *
 * 因此它刻意遵守服务端的全部行为约定：
 *
 * - 自己持有权威 `Position`，不接受客户端传来的局面
 * - 校验 `basedOnVersion`，拒绝基于过期局面的意图
 * - 校验座位，拒绝替别人走棋
 * - 拒绝时不下发新快照，只回一个错误——客户端界面不会因为非法操作而变化
 *
 * 状态只有 `pos` 与 `history` 两样，别的（最后一手、被吃子、手数）全部由
 * history 派生。多存一份就多一处要在悔棋时同步回退的东西，而漏同步的表现
 * 是「悔了棋但吃子记录还留着」这类只在特定顺序下才复现的错。
 *
 * 上线后本文件只应出现在开发与测试路径里。真实对局的裁定必须在服务端，
 * 匹配制下对手是陌生人，客户端裁定等于把作弊入口敞开。
 */

import type { GameState, InputIntent } from "../../core/types";
import type { MatchPly, Move, Piece, Position, Side } from "../logic";
import {
  applyMove,
  findKing,
  initialPosition,
  isCheck,
  isLegalMove,
  legalMoves,
  matchOutcome,
  movesUntilNaturalDraw,
  opponent,
  pieceAt,
  squareIndex,
} from "../logic";
import type {
  MovePayload,
  UndoRequest,
  XiangqiResult,
  XiangqiView,
  ViewMove,
} from "../view";
import {
  SEAT_BLACK,
  SEAT_RED,
  UNDO_PLIES,
  UNDO_REQUESTS_PER_MATCH,
  XIANGQI_INTENT,
  seatOfSide,
  sideOfSeat,
  toMove,
  toViewMove,
} from "../view";

/** 意图被拒的原因。透传给界面用于提示，不影响状态。 */
export interface Rejection {
  readonly reason: string;
  readonly detail?: string;
}

/** 一手棋的记录。存「走之前的局面」而不是「走之后」，悔棋直接取用。 */
interface Ply {
  readonly before: Position;
  readonly move: ViewMove;
  readonly captured: Piece | null;
}

export interface LocalXiangqiServerOptions {
  readonly matchId?: string;
  /** 本机玩家占哪个座位。另一座位留给对手（人或机器人）。 */
  readonly mySeat?: number;
  /**
   * 起始局面。缺省为标准开局。
   *
   * 只为测试与残局练习开的口子：真服务端的开局由它自己决定，绝不采信客户端
   * 送来的局面——否则玩家可以直接开一局「对方只剩光杆将」。
   */
  readonly position?: Position;
  readonly onSnapshot: (snapshot: GameState<XiangqiView>) => void;
  readonly onReject?: (rejection: Rejection) => void;
}

export class LocalXiangqiServer {
  private pos: Position;
  private history: Ply[] = [];
  private version = 0;
  /** 认输方。认输是对局层的事，规则引擎不知道有这回事。 */
  private resigned: Side | null = null;
  /** 待答复的悔棋请求。同一时刻至多一个。 */
  private undoRequest: UndoRequest | null = null;
  /** 各座位已发起过的悔棋请求次数，按座位号索引。 */
  private undoRequestsUsed: number[] = [0, 0];

  private readonly matchId: string;
  private readonly mySeat: number;
  private readonly onSnapshot: (snapshot: GameState<XiangqiView>) => void;
  private readonly onReject: (rejection: Rejection) => void;

  constructor(options: LocalXiangqiServerOptions) {
    this.pos = options.position ?? initialPosition();
    this.matchId = options.matchId ?? "local";
    this.mySeat = options.mySeat ?? 0;
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
   * 合法则推进状态并下发新快照；非法则只回错误，状态与版本都不动——版本一旦
   * 因非法操作而前进，客户端的 `basedOnVersion` 校验就失去意义。
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
    if (this.result() !== null) {
      return this.onReject({ reason: "game_over" });
    }

    switch (intent.type) {
      // 认输不查轮次：对手长考时想认输却得先等他走一步，是荒谬的。
      case XIANGQI_INTENT.resign:
        this.resigned = sideOfSeat(this.mySeat);
        this.version += 1;
        return this.emit();

      case XIANGQI_INTENT.move:
        return this.turnGated(() => this.applyPlayerMove(intent.payload));

      case XIANGQI_INTENT.undoRequest:
        return this.turnGated(() => this.requestUndo(this.mySeat));

      // 答复不查轮次：请求方发起时是**他的**回合，所以答复方永远不是轮走方，
      // 查轮次会让任何答复都被拒。答复该由谁给，由 replyUndo 查发起方。
      case XIANGQI_INTENT.undoAccept:
        return this.replyUndo(this.mySeat, true);

      case XIANGQI_INTENT.undoDecline:
        return this.replyUndo(this.mySeat, false);

      default:
        return this.onReject({ reason: "unknown_intent", detail: intent.type });
    }
  }

  /**
   * 代替对手走一手。
   *
   * 只在本地开发与测试里用——真服务端的对手来自匹配，不由客户端驱动。
   */
  playAsOpponent(move: Move): void {
    if (this.result() !== null) return;
    // 这里**不需要**再挡一次悔棋请求。请求只能经 turnGated 发起，也就是发起时
    // 一定轮到发起方；请求悬着时没有任何一手落得下去，轮走方于是不变。所以只
    // 要有请求悬着，下一行的「还没轮到对手」就必然先返回。曾经在这里加过一句
    // `if (this.undoRequest !== null) return;`，变异测试证明它删掉也没有任何用例
    // 会红——不是用例不够，是那一行根本到不了。留着只会让人以为冻结逻辑有两处
    // 来源，改其中一处时误以为另一处会兜底。
    if (seatOfSide(this.pos.sideToMove) === this.mySeat) return;
    if (!isLegalMove(this.pos, move)) return;
    this.push(move);
    this.version += 1;
    this.emit();
  }

  /**
   * 代替对手答复悔棋请求。
   *
   * 与 {@link playAsOpponent} 同理，是本地替身而非产品能力。单列一个方法而不是
   * 让测试直接改字段，是为了让「答复必须来自另一个座位」这条校验在本地路径上
   * 也真的跑一遍——绕过它测出来的绿是假的。
   */
  replyAsOpponent(accept: boolean): void {
    if (this.result() !== null) return;
    this.replyUndo(this.opponentSeat(), accept);
  }

  /** 对手的座位号。两人对局，非我即他。 */
  private opponentSeat(): number {
    return this.mySeat === SEAT_RED ? SEAT_BLACK : SEAT_RED;
  }

  /** 当前权威局面。仅供测试与机器人取用，界面一律走快照。 */
  authoritativeState(): Position {
    return this.pos;
  }

  /** 轮到本机玩家时才执行 `run`，否则回 `not_your_turn` 且不动任何状态。 */
  private turnGated(run: () => void): void {
    if (seatOfSide(this.pos.sideToMove) !== this.mySeat) {
      return this.onReject({ reason: "not_your_turn" });
    }
    run();
  }

  private applyPlayerMove(payload: unknown): void {
    // 悔棋请求悬着时不许走子。放行的话请求方可以一边等答复一边继续走，等对方
    // 同意时该退的两手已经不是当初那两手了——回退目标会指向一个双方谁都没在
    // 讨论的局面。答复必须落在发起时的那个局面上。
    if (this.undoRequest !== null) {
      return this.onReject({ reason: "undo_pending" });
    }
    const move = toMove(payload as MovePayload);
    if (!isLegalMove(this.pos, move)) {
      return this.onReject({ reason: "illegal_move" });
    }
    this.push(move);
    this.version += 1;
    this.emit();
  }

  /**
   * 发起悔棋请求。只是请求——局面一动不动，退不退由对方答复决定。
   *
   * 从前这里直接回退局面。单机打机器人没问题，接入匹配就是作弊入口：走错
   * 一步，单方面把局面退回去重走。对手是陌生人，凭什么由我说了算。
   *
   * 额度在**发起**时就扣，不管对方同不同意。理由见 view.ts 的
   * `UNDO_REQUESTS_PER_MATCH`：按同意计数的话，无限次发起、无限次被拒，
   * 骚扰完全免费。
   */
  private requestUndo(seat: number): void {
    if (this.history.length < UNDO_PLIES) {
      return this.onReject({ reason: "nothing_to_undo" });
    }
    if (this.undoRequest !== null) {
      return this.onReject({ reason: "undo_pending" });
    }
    if (this.undoRequestsUsed[seat] >= UNDO_REQUESTS_PER_MATCH) {
      return this.onReject({ reason: "undo_exhausted" });
    }
    this.undoRequestsUsed[seat] += 1;
    this.undoRequest = { bySeat: seat };
    this.version += 1;
    this.emit();
  }

  /**
   * 答复悔棋请求。
   *
   * 只有**非发起方**能答复。少了这一条，发起方可以自己同意自己的请求，那就
   * 绕回了单方面回退——整套双方确认等于没做。这是本文件最要紧的一行校验。
   */
  private replyUndo(seat: number, accept: boolean): void {
    const request = this.undoRequest;
    if (request === null) {
      return this.onReject({ reason: "no_undo_request" });
    }
    if (request.bySeat === seat) {
      return this.onReject({ reason: "cannot_reply_own_undo" });
    }

    this.undoRequest = null;
    if (accept) this.rewind();
    this.version += 1;
    this.emit();
  }

  /**
   * 回退 {@link UNDO_PLIES} 手。退完仍是请求方的回合——请求发起时是他的回合，
   * 退偶数手回合归属不变。
   *
   * 只由 {@link replyUndo} 在对方同意后调用。没有别的入口，也不该有。
   */
  private rewind(): void {
    const target = this.history[this.history.length - UNDO_PLIES];
    this.history = this.history.slice(0, -UNDO_PLIES);
    this.pos = target.before;
  }

  /** 落子并记账。被吃的子要在改变局面**之前**读，读晚了就只剩落上去的那个子。 */
  private push(move: Move): void {
    const captured = pieceAt(this.pos, move.to);
    const before = this.pos;
    this.pos = applyMove(this.pos, move);
    this.history.push({ before, move: toViewMove(move), captured });
  }

  /**
   * 终局结果。认输优先于局面判定——认了输就不必再问局面上还有没有着法。
   *
   * 用 `matchOutcome` 而不是 `getOutcome`：后者只看单个局面，判不出和棋，
   * 于是双方只剩光杆将时这盘棋永远不结束。而入场费在进场时就扣了，一盘不
   * 结算的棋等于收了积分不给结果。见 logic/match-rules.ts 文件头。
   */
  private result(): XiangqiResult | null {
    if (this.resigned !== null) {
      return { kind: "resign", winner: opponent(this.resigned) };
    }
    const outcome = matchOutcome(this.matchHistory(), this.pos);
    return outcome.kind === "ongoing" ? null : outcome;
  }

  /**
   * 把内部历史转成对局层认识的形状。
   *
   * 两者的 `captured` 含义不同：内部存的是**被吃的那个子**（终局画面要列出
   * 双方损失），对局层只关心**有没有吃**。在这个边界上转一次，好过让规则层
   * 去认识 `Piece`。
   */
  private matchHistory(): MatchPly[] {
    return this.history.map((ply) => ({
      before: ply.before,
      captured: ply.captured !== null,
    }));
  }

  private emit(): void {
    const history = this.matchHistory();
    const result = this.result();
    const finished = result !== null;

    // 被将军的一方总是轮走方：走完一手让自己挨将是非法的，规则引擎不会放行。
    // 将死时这一格照样要给——终局画面上「将被围死在这里」是最要紧的一句话。
    const checked = isCheck(this.pos)
      ? findKing(this.pos, this.pos.sideToMove)
      : null;

    const view: XiangqiView = {
      board: this.pos.board,
      lastMove: this.history.at(-1)?.move ?? null,
      checkSquare: checked === null ? null : squareIndex(checked),
      // 终局后不再下发着法：认输之后局面上其实还有棋可走，发出去界面就会
      // 把可走点亮起来，等于邀请玩家点一个必然被拒的操作
      legalMoves: finished ? [] : legalMoves(this.pos).map(toViewMove),
      captured: this.history
        .map((p) => p.captured)
        .filter((p): p is Piece => p !== null),
      result,
      ply: this.history.length,
      movesUntilDraw: movesUntilNaturalDraw(history),
      undoRequest: this.undoRequest,
      undoRequestsUsed: [...this.undoRequestsUsed],
    };

    this.onSnapshot({
      matchId: this.matchId,
      gameId: "xiangqi",
      phase: finished ? "finished" : "playing",
      version: this.version,
      activeSeat: finished ? null : seatOfSide(this.pos.sideToMove),
      mySeat: this.mySeat,
      board: view,
    });
  }
}
