/**
 * 本地权威服务端（占位实现）。
 *
 * 与围棋的 server/local.ts 同一个定位：真服务端的替身，不是「客户端算分」
 * 的后门。它让整条链路——意图上报 → 权威裁定 → 快照下发 → 渲染——现在就能
 * 跑起来并被测试，等服务端就绪时换掉这一个类即可。
 *
 * 它遵守服务端的全部行为约定：自己持有权威牌局、校验版本、校验座位、
 * 拒绝时不下发新快照。斗地主还多一条，而且是最要紧的一条：
 *
 * ## 视图按座位裁剪
 *
 * {@link LocalDoudizhuServer.viewFor} 构造视图时，只把**收件人自己的**手牌
 * 放进去，其余两家一律只给张数；底牌在地主定下来之前连张数以外的东西都
 * 没有。这一步必须发生在这里，不能推给渲染层——数据只要下发到客户端，改个
 * 前端就全看见了，匹配制下对手是陌生人，那等于把作弊入口敞开
 * （core/types.ts 约束 2）。
 *
 * 出牌意图只带牌的 id（见 view.ts 的 `PlayPayload`），服务端从**自己那份**
 * 手牌里按 id 取真牌。客户端递过来的牌面一概不信——不然把黑桃 3 标成大王
 * 就能过关。
 */

import type { GameState, InputIntent } from "../../core/types";
import type { Bid, Card, Deal, Pattern, WinningBid } from "../logic";
import {
  SEAT_COUNT,
  addBottomCards,
  canPass,
  checkPlay,
  createDeck,
  deal as dealDeck,
  detectSpring,
  finalScores,
  isValidBid,
  resolveBidding,
  scoreMultiplier,
  settle,
  shuffle,
} from "../logic";
import type {
  BidPayload,
  DoudizhuSnapshot,
  DoudizhuStage,
  DoudizhuView,
  PlayPayload,
  ResultView,
  SeatAction,
} from "../view";
import { DOUDIZHU_INTENT, nextSeat } from "../view";

/** 意图被拒的原因。透传给界面用于提示，不影响状态。 */
export interface Rejection {
  readonly reason: string;
  readonly detail?: string;
}

export interface LocalDoudizhuServerOptions {
  readonly matchId?: string;
  /** 本机玩家占哪个座位。另外两个座位留给陪练机器人。 */
  readonly mySeat?: number;
  /** 洗牌种子。同种子必然同牌局，便于复现（cards.ts 不含任何随机源）。 */
  readonly seed?: number;
  /** 首个叫分的座位。 */
  readonly firstBidder?: number;
  /**
   * 预置牌局，跳过洗牌。仅测试与复盘用。
   *
   * 注意它只作用于**第一次**发牌：三家都不叫要重发，重发一定要换一副牌，
   * 否则同一副没人要的牌会被无限重发。
   */
  readonly deal?: Deal;
  readonly onSnapshot: (snapshot: DoudizhuSnapshot) => void;
  readonly onReject?: (rejection: Rejection) => void;
}

/** 权威牌局。仅供测试断言与陪练驱动，界面一律走快照。 */
export interface AuthoritativeTable {
  readonly hands: readonly (readonly Card[])[];
  readonly bottom: readonly Card[];
  readonly stage: DoudizhuStage;
  readonly landlord: number | null;
  readonly turn: number | null;
}

export class LocalDoudizhuServer {
  private hands: Card[][] = [[], [], []];
  private bottom: Card[] = [];
  private stage: DoudizhuStage = "bidding";
  private landlord: number | null = null;
  private winningBid: WinningBid | null = null;
  private bids: Bid[] = [];
  private firstBidder: number;
  private turn: number | null;
  private toBeat: { seat: number; pattern: Pattern } | null = null;
  private lastActions: (SeatAction | null)[] = [null, null, null];
  /** 每家实际出牌的手数，过牌不计。春天判定要它。 */
  private playsBySeat: number[] = [0, 0, 0];
  private bombs = 0;
  private rocket = false;
  /** 距上一次出牌之后连续过了几家。够两家就开新一轮。 */
  private passesSinceLastPlay = 0;
  private result: ResultView | null = null;
  private version = 0;
  private seed: number;
  private pendingDeal: Deal | null;

  private readonly matchId: string;
  private readonly mySeat: number;
  private readonly onSnapshot: (snapshot: DoudizhuSnapshot) => void;
  private readonly onReject: (rejection: Rejection) => void;

  constructor(options: LocalDoudizhuServerOptions) {
    this.matchId = options.matchId ?? "local";
    this.mySeat = options.mySeat ?? 0;
    this.seed = options.seed ?? 1;
    this.pendingDeal = options.deal ?? null;
    this.firstBidder = options.firstBidder ?? 0;
    this.turn = this.firstBidder;
    this.onSnapshot = options.onSnapshot;
    this.onReject = options.onReject ?? (() => {});
    this.dealRound();
  }

  /** 下发首帧快照。对应真服务端撮合成功后的开局推送。 */
  start(): void {
    this.emit();
  }

  /** 本机玩家提交意图。 */
  submit(intent: InputIntent): void {
    this.submitAs(this.mySeat, intent);
  }

  /**
   * 以某个座位的身份提交意图。
   *
   * 真服务端从连接上认座位，没有这个参数。这里留一个口子是给本地陪练用的
   * ——但陪练走的是**和人完全相同的校验路径**，不是绕过校验直接改状态。
   * 机器人要是能绕过校验，它出的非法牌就永远测不出来。
   */
  submitAs(seat: number, intent: InputIntent): void {
    if (intent.matchId !== this.matchId) {
      return this.onReject({ reason: "wrong_match" });
    }
    if (intent.basedOnVersion !== this.version) {
      return this.onReject({
        reason: "stale_version",
        detail: `客户端基于 v${intent.basedOnVersion}，当前 v${this.version}`,
      });
    }
    if (this.stage === "over") return this.onReject({ reason: "game_over" });
    if (seat !== this.turn) return this.onReject({ reason: "not_your_turn" });

    switch (intent.type) {
      case DOUDIZHU_INTENT.bid:
        return this.applyBid(intent.payload as BidPayload);
      case DOUDIZHU_INTENT.play:
        return this.applyPlay(seat, intent.payload as PlayPayload);
      case DOUDIZHU_INTENT.pass:
        return this.applyPass(seat);
      default:
        return this.onReject({ reason: "unknown_intent", detail: intent.type });
    }
  }

  /**
   * 按收件人裁剪出的视图。
   *
   * **整个反作弊约束就落在这个方法上。** `seat` 是收件人：他自己的手牌给
   * 具体牌张，另外两家只给张数，底牌在亮牌前只给张数。`seat` 为 `null`
   * 是观战者，一家的牌都看不到。
   *
   * 陪练机器人也只拿这个视图（server/bot.ts），所以机器人不会「看牌打牌」
   * ——一个能看穿手牌的陪练，练出来的手感是假的。
   */
  viewFor(seat: number | null): DoudizhuView {
    return {
      stage: this.stage,
      // 只有收件人自己那一份。这里若写成 this.hands，全桌的牌就都发出去了
      hand: seat === null ? [] : this.hands[seat].slice(),
      seats: this.hands.map((hand, at) => ({
        seat: at,
        // 张数，不是牌
        cardsLeft: hand.length,
        isLandlord: at === this.landlord,
        lastAction: this.lastActions[at],
      })),
      landlord: this.landlord,
      bid: this.winningBid,
      bottom: {
        count: this.bottom.length,
        // 地主未定 = 还没亮底，谁都不该看到底牌
        cards: this.landlord === null ? null : this.bottom.slice(),
      },
      toBeat:
        this.toBeat === null
          ? null
          : { seat: this.toBeat.seat, cards: this.toBeat.pattern.cards },
      bids: this.bids.slice(),
      firstBidder: this.firstBidder,
      bombs: this.bombs,
      rocket: this.rocket,
      multiplier:
        this.winningBid === null
          ? null
          : scoreMultiplier({
              bid: this.winningBid,
              bombs: this.bombs,
              rocket: this.rocket,
              // 春天要打完才知道，进行中一律按「没有」算
              spring: this.result?.spring ?? "none",
            }),
      result: this.result,
    };
  }

  /** 权威牌局。**仅供测试断言**——它含全部手牌，界面碰它就等于开了透视。 */
  authoritativeState(): AuthoritativeTable {
    return {
      hands: this.hands.map((hand) => hand.slice()),
      bottom: this.bottom.slice(),
      stage: this.stage,
      landlord: this.landlord,
      turn: this.turn,
    };
  }

  /* ---------------- 叫分 ---------------- */

  /**
   * 叫分。
   *
   * 不需要 `seat` 参数：叫牌顺序由 `firstBidder` + `bids.length` 唯一确定，
   * 而调用点已经校验过「现在轮到这个座位」。再存一份座位来源，两者就有了
   * 对不上的可能。
   */
  private applyBid(payload: BidPayload): void {
    if (this.stage !== "bidding") {
      return this.onReject({ reason: "wrong_stage" });
    }
    const bid = payload?.bid;
    if (bid !== 0 && bid !== 1 && bid !== 2 && bid !== 3) {
      return this.onReject({ reason: "invalid_bid", detail: String(bid) });
    }
    if (!isValidBid(this.bids, bid)) {
      return this.onReject({ reason: "invalid_bid", detail: String(bid) });
    }

    this.bids.push(bid);
    const outcome = resolveBidding(this.firstBidder, this.bids);

    if (outcome.status === "bidding") {
      this.turn = outcome.nextSeat;
    } else if (outcome.status === "settled") {
      this.landlord = outcome.landlord;
      this.winningBid = outcome.bid;
      this.hands[outcome.landlord] = addBottomCards(
        this.hands[outcome.landlord],
        this.bottom,
      );
      this.stage = "playing";
      this.turn = outcome.landlord;
      this.toBeat = null;
      this.lastActions = [null, null, null];
    } else {
      // 三家都不叫。重发时首叫顺延一位，否则同一个人反复先叫、同样的
      // 犹豫会一再重演
      this.bids = [];
      this.firstBidder = nextSeat(this.firstBidder);
      this.turn = this.firstBidder;
      this.dealRound();
    }

    this.bump();
  }

  /* ---------------- 出牌 ---------------- */

  private applyPlay(seat: number, payload: PlayPayload): void {
    if (this.stage !== "playing") {
      return this.onReject({ reason: "wrong_stage" });
    }

    const hand = this.hands[seat];
    // 按 id 从服务端自己那份手牌里取真牌。客户端递来的牌面一概不看——
    // 认了客户端的牌面，改个 rank 就能把黑桃 3 当大王出
    const ids = payload?.cardIds ?? [];
    const cards: Card[] = [];
    for (const id of ids) {
      const found = hand.find((card) => card.id === id);
      // 找不到的 id 直接判非法，不是跳过：跳过会让「出三张不存在的牌」
      // 悄悄退化成「出零张」，错误信息全跑偏
      if (found === undefined) {
        return this.onReject({ reason: "not_in_hand", detail: id });
      }
      cards.push(found);
    }

    const check = checkPlay(hand, cards, this.toBeat?.pattern ?? null);
    if (!check.ok) return this.onReject({ reason: check.reason });

    this.hands[seat] = check.rest;
    this.playsBySeat[seat] += 1;
    this.lastActions[seat] = { kind: "play", cards: check.pattern.cards };
    if (check.pattern.type === "bomb") this.bombs += 1;
    if (check.pattern.type === "rocket") this.rocket = true;
    this.toBeat = { seat, pattern: check.pattern };
    this.passesSinceLastPlay = 0;

    if (this.hands[seat].length === 0) {
      this.finish();
    } else {
      this.turn = nextSeat(seat);
    }
    this.bump();
  }

  private applyPass(seat: number): void {
    if (this.stage !== "playing") {
      return this.onReject({ reason: "wrong_stage" });
    }
    // 自己领出的一轮不能过。允许的话三家会一直互相等待，这一局卡死
    if (!canPass(this.toBeat?.pattern ?? null)) {
      return this.onReject({ reason: "cannot_pass" });
    }

    this.lastActions[seat] = { kind: "pass" };
    this.passesSinceLastPlay += 1;
    this.turn = nextSeat(seat);

    // 另外两家都要不起，这一轮结束，出牌权回到最后出牌的那家（正好就是
    // 上面刚推到的 turn），桌面清空重新自由出牌
    if (this.passesSinceLastPlay >= SEAT_COUNT - 1) {
      this.toBeat = null;
      this.passesSinceLastPlay = 0;
      this.lastActions = [null, null, null];
    }
    this.bump();
  }

  /* ---------------- 收尾 ---------------- */

  private finish(): void {
    const landlord = this.landlord;
    const outcome = landlord === null ? null : settle(this.hands, landlord);
    if (landlord === null || outcome === null || this.winningBid === null) {
      return;
    }

    const spring = detectSpring(this.playsBySeat, landlord, outcome.winnerSide);
    const factors = {
      bid: this.winningBid,
      bombs: this.bombs,
      rocket: this.rocket,
      spring,
    };
    this.stage = "over";
    this.turn = null;
    this.result = {
      winnerSeat: outcome.winnerSeat,
      winnerSide: outcome.winnerSide,
      winners: outcome.winners,
      spring,
      multiplier: scoreMultiplier(factors),
      scores: finalScores(outcome, landlord, factors),
    };
  }

  /** 发一副新牌，并把与「这一副牌」绑定的状态全部归零。 */
  private dealRound(): void {
    const round =
      this.pendingDeal ?? dealDeck(shuffle(createDeck(), this.seed));
    this.pendingDeal = null;
    // 每发一次就换种子，重发才会拿到不同的牌
    this.seed = (this.seed + 1) | 0;

    this.hands = round.hands.map((hand) => hand.slice());
    this.bottom = round.bottom.slice();
    this.landlord = null;
    this.winningBid = null;
    this.stage = "bidding";
    this.toBeat = null;
    this.lastActions = [null, null, null];
    this.playsBySeat = [0, 0, 0];
    this.bombs = 0;
    this.rocket = false;
    this.passesSinceLastPlay = 0;
    this.result = null;
  }

  /** 状态推进一版并下发快照。拒绝路径一律不走这里——版本不能因非法操作前进。 */
  private bump(): void {
    this.version += 1;
    this.emit();
  }

  private emit(): void {
    const snapshot: GameState<DoudizhuView> = {
      matchId: this.matchId,
      gameId: "doudizhu",
      phase: this.stage === "over" ? "finished" : "playing",
      version: this.version,
      activeSeat: this.turn,
      mySeat: this.mySeat,
      // 下发的是本机玩家那一份裁剪结果，不是全量牌局
      board: this.viewFor(this.mySeat),
    };
    this.onSnapshot(snapshot);
  }
}
