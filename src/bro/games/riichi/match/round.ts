/**
 * 立直麻将：对局状态机。
 *
 * 算番层（logic/）只回答「这一手和了值多少点」。这一层回答的是别的问题：牌山
 * 怎么发、轮到谁摸打、立直宣告合不合法、什么时候流局。两层的边界是 logic/types.ts
 * 开头写死的 —— 状态类字段（一发、海底、振听）由本层填，算番层只读不判。
 *
 * 本层特有的四条规矩：
 *
 * 1. **振听在这一层，不在算番层。** 振听不改变一手牌值多少点，它决定的是这手牌
 *    能不能荣和。算番层压根不知道谁打过什么牌，也不该知道。
 *
 * 2. **牌山由种子生成，不用 Math.random()。** 与台球同一个理由：服务端权威推进
 *    要求两端能对同一副牌复现同一局。
 *
 * 3. **每次推进都返回新状态，不原地改。** 快照按版本号下发，原地改会让已下发的
 *    旧快照跟着变。
 *
 * 4. **点棒守恒要能验。** 立直宣告当场扣 1000 进场棒，和了时连棒一起收走。
 *    不这么记的话，`cost.total` 里的 `riichiStickBonus` 就是凭空印出来的点数
 *    —— 四家点数之和会随着立直次数往上飘。测试直接盯着这个和。
 *
 * 范围：**门前清对局**。摸、打、立直、荣和、自摸、荒牌流局都在，吃碰杠还没接
 * （见文件末尾 TODO(鸣牌)）。副露一旦接上，`melds` 字段与算番层无需改动 ——
 * 那一层从一开始就是按有副露写的。
 */

import type { Meld, Tile136, Tile34, WinContext } from "../logic";
import {
  DEFAULT_RULES,
  EAST,
  countsOf,
  estimateHandValue,
  isAgari,
  shanten,
  toTile34,
} from "../logic";

/** 座位。0..3 固定不变，谁是庄由 `dealer` 表示。 */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** 一副牌 136 张。 */
export const WALL_SIZE = 136;
/** 王牌 14 张：岭上 4 + 宝牌指示 5 + 里宝牌指示 5。 */
export const DEAD_WALL_SIZE = 14;
/** 立直宣告的进场棒。 */
export const RIICHI_STICK = 1000;
/** 起始点数。 */
export const START_POINTS = 25000;
/** 荒牌流局的听牌罚符总额。 */
export const TENPAI_PENALTY = 3000;

export interface PlayerState {
  readonly seat: Seat;
  /** 手牌（不含副露）。刚摸完是 14 张，打完回到 13 张。 */
  readonly hand: readonly Tile136[];
  readonly melds: readonly Meld[];
  /** 牌河，按打出顺序。 */
  readonly discards: readonly Tile136[];
  readonly points: number;
  readonly riichi: boolean;
  readonly isDoubleRiichi: boolean;
  /**
   * 一发是否还有效。
   *
   * 单独存而不是从巡目推算：一发会被**任意一次鸣牌**打断，而鸣牌不推进巡目。
   * 用「立直后第一巡」去算的话，别家鸣一手再点炮照样算一发，那是错的。
   */
  readonly ippatsu: boolean;
  /**
   * 同巡振听：放过一次能和的牌之后，到自己下次摸牌前不能荣和。
   *
   * 与永久振听（自己牌河里有和了张）分开存 —— 这个每次摸牌清零，那个不清。
   */
  readonly temporaryFuriten: boolean;
}

export type RoundPhase =
  /** 等当前玩家打牌（他刚摸完）。 */
  | "awaiting_discard"
  /** 等别家响应刚打出的那张。 */
  | "awaiting_call"
  | "finished";

export type RoundEndReason = "tsumo" | "ron" | "exhaustive_draw";

export interface RoundResult {
  readonly reason: RoundEndReason;
  /** 和了者。流局为 null。 */
  readonly winner: Seat | null;
  /** 放铳者。自摸与流局为 null。 */
  readonly loser: Seat | null;
  readonly han: number;
  readonly fu: number;
  readonly yaku: readonly { readonly id: string; readonly han: number }[];
  /** 各座位的点数增减。含立直棒的收授。 */
  readonly deltas: readonly [number, number, number, number];
}

export interface RoundState {
  readonly players: readonly [
    PlayerState,
    PlayerState,
    PlayerState,
    PlayerState,
  ];
  /** 牌山剩余（可摸部分），按摸牌顺序。 */
  readonly wall: readonly Tile136[];
  /** 王牌。宝牌指示牌从这里翻。 */
  readonly deadWall: readonly Tile136[];
  /** 已翻开的宝牌指示牌数量。 */
  readonly doraRevealed: number;
  readonly phase: RoundPhase;
  /** 当前该行动的座位。 */
  readonly turn: Seat;
  /**
   * 当前玩家刚摸进来的那张。
   *
   * 不能用「手牌最后一张」代替 —— 手牌是排序存的，最后一张是编号最大的那张，
   * 跟刚摸的没关系。自摸的和了牌取错，符数（自摸符、单骑听）就全错了。
   */
  readonly lastDraw: Tile136 | null;
  /** 刚打出的那张（等待响应时有值）。 */
  readonly lastDiscard: { readonly tile: Tile136; readonly from: Seat } | null;
  /** 巡目，从 1 起。庄家再次拿到行动权时 +1。 */
  readonly turnCount: number;
  readonly roundWind: Tile34;
  readonly dealer: Seat;
  readonly honba: number;
  readonly riichiSticks: number;
  readonly result: RoundResult | null;
}

/* ------------------------------------------------------------------ *
 * 牌山
 * ------------------------------------------------------------------ */

/**
 * 确定性洗牌：xorshift32 + Fisher-Yates。
 *
 * 用自带 RNG 而不是接收 `() => number`：这副牌两端都要能凭种子复现，而外部传进来
 * 的 RNG 无法保证两端实现一致。
 */
export function buildWall(seed: number): Tile136[] {
  const tiles = Array.from({ length: WALL_SIZE }, (_, i) => i);
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export interface StartOptions {
  readonly seed: number;
  readonly dealer?: Seat;
  readonly roundWind?: Tile34;
  readonly honba?: number;
  readonly riichiSticks?: number;
  readonly points?: readonly [number, number, number, number];
}

/** 开一局：发牌，庄家摸第 14 张，进入等待打牌。 */
export function startRound(options: StartOptions): RoundState {
  const dealer = options.dealer ?? 0;
  const shuffled = buildWall(options.seed);
  const deadWall = shuffled.slice(0, DEAD_WALL_SIZE);
  let live = shuffled.slice(DEAD_WALL_SIZE);

  const players = SEATS.map((seat) => {
    const hand = live.slice(0, 13).sort((a, b) => a - b);
    live = live.slice(13);
    return {
      seat,
      hand,
      melds: [],
      discards: [],
      points: options.points?.[seat] ?? START_POINTS,
      riichi: false,
      isDoubleRiichi: false,
      ippatsu: false,
      temporaryFuriten: false,
    } satisfies PlayerState;
  }) as unknown as RoundState["players"];

  const base: RoundState = {
    players,
    wall: live,
    deadWall,
    doraRevealed: 1,
    phase: "awaiting_discard",
    turn: dealer,
    lastDraw: null,
    lastDiscard: null,
    turnCount: 1,
    roundWind: options.roundWind ?? EAST,
    dealer,
    honba: options.honba ?? 0,
    riichiSticks: options.riichiSticks ?? 0,
    result: null,
  };

  return drawFor(base, dealer);
}

/** 给某座位摸一张。牌山空了则荒牌流局。 */
function drawFor(state: RoundState, seat: Seat): RoundState {
  if (state.wall.length === 0) return exhaustiveDraw(state);
  const [tile, ...rest] = state.wall;
  const players = replacePlayer(state.players, seat, (p) => ({
    ...p,
    hand: [...p.hand, tile].sort((a, b) => a - b),
    // 摸牌解除同巡振听。永久振听（牌河里有和了张）不在这里清
    temporaryFuriten: false,
  }));
  return {
    ...state,
    players,
    wall: rest,
    turn: seat,
    lastDraw: tile,
    phase: "awaiting_discard",
  };
}

/* ------------------------------------------------------------------ *
 * 听牌与振听
 * ------------------------------------------------------------------ */

/**
 * 这手牌的所有和了张。
 *
 * 逐一试摸 34 种牌看成不成和。不上更聪明的算法：更聪明也更容易错，而这条链路
 * 错了的表现是「明明听牌却不让荣和」—— 玩家只会觉得程序坏了。
 */
export function waitingTiles(
  hand: readonly Tile136[],
  melds: readonly Meld[] = [],
): Tile34[] {
  const meldGroups = melds.map((m) => m.tiles.map(toTile34));
  const counts = countsOf(hand);
  const waits: Tile34[] = [];
  for (let tile = 0; tile < 34; tile += 1) {
    // 四张都在自己手里的牌不可能再来第五张
    if (counts[tile] >= 4) continue;
    counts[tile] += 1;
    if (isAgari(counts, meldGroups)) waits.push(tile);
    counts[tile] -= 1;
  }
  return waits;
}

/**
 * 听牌即向听数为 0。
 *
 * 张数异常时返回 false 而不是抛错。`shanten()` 对 3 的倍数张会抛 —— 而这个函数
 * 的调用点之一是荒牌流局的罚符结算，那是**整局点数落地的地方**：在那里抛错等于
 * 一局的分全丢了，比少算一次听牌严重得多。界面层也会拿任意手牌调它来标听牌提示。
 */
export function isTenpai(player: PlayerState): boolean {
  try {
    return shanten(countsOf(player.hand)) === 0;
  } catch {
    return false;
  }
}

/**
 * 是否振听。
 *
 * 两种合成一条：牌河里有任意一张和了张（永久），或刚放过一次和（同巡）。
 * 立直后错过和了张属于前者 —— 立直后不能改听，牌河里出现和了张就等价于错过。
 */
export function isFuriten(
  player: PlayerState,
  waits: readonly Tile34[],
): boolean {
  if (player.temporaryFuriten) return true;
  const waitSet = new Set(waits);
  return player.discards.some((t) => waitSet.has(toTile34(t)));
}

/* ------------------------------------------------------------------ *
 * 动作
 * ------------------------------------------------------------------ */

export type ActionRejection =
  | "not_your_turn"
  | "wrong_phase"
  | "tile_not_in_hand"
  | "round_over"
  | "riichi_not_closed"
  | "riichi_already"
  | "riichi_no_points"
  | "not_tenpai"
  | "furiten"
  | "no_yaku"
  | "not_winning_hand"
  | "nothing_to_call";

/**
 * 动作结果。
 *
 * 两个分支都带 `state`，因为**有一种拒绝会改状态**：荣和被判无役时，宣告者要吃
 * 一个同巡振听（否则同一张牌可以反复宣告，白嫖到别家打出真能和的牌为止）。
 * 只让成功分支带状态的话，那次处罚就只能靠原地改对象来落地 —— 而原地改会污染
 * 已经下发出去的旧快照。
 *
 * 其余拒绝返回的是**同一个对象引用**，所以「状态没动」这件事可以直接用
 * `result.state === before` 断言，不必逐字段比。
 */
export type ActionResult =
  | {
      readonly ok: false;
      readonly reason: ActionRejection;
      readonly state: RoundState;
    }
  | { readonly ok: true; readonly state: RoundState };

/**
 * 打一张牌，可同时宣告立直。
 *
 * 合成一个动作而不是拆两步：宣告立直与打出宣言牌在规则上是同一瞬间。拆开会造出
 * 「宣告了但还没打」这个中间态，而那个态里别家能不能鸣、算不算一发都无从定义。
 */
export function discard(
  state: RoundState,
  seat: Seat,
  tile: Tile136,
  declareRiichi = false,
): ActionResult {
  if (state.phase === "finished") return reject(state, "round_over");
  if (state.phase !== "awaiting_discard") return reject(state, "wrong_phase");
  if (state.turn !== seat) return reject(state, "not_your_turn");

  const player = state.players[seat];
  if (!player.hand.includes(tile)) return reject(state, "tile_not_in_hand");

  const remaining = player.hand.filter((t) => t !== tile);

  if (declareRiichi) {
    if (player.riichi) return reject(state, "riichi_already");
    if (player.melds.some((m) => m.opened))
      return reject(state, "riichi_not_closed");
    if (player.points < RIICHI_STICK) return reject(state, "riichi_no_points");
    // 打完这张必须听牌 —— 这是立直的定义，不是附加条件
    if (shanten(countsOf(remaining)) !== 0) return reject(state, "not_tenpai");
  }

  // 双立直：第一巡、且自己还一张没打过
  const isFirstTurn = state.turnCount === 1 && player.discards.length === 0;

  const players = replacePlayer(state.players, seat, (p) => ({
    ...p,
    hand: remaining,
    discards: [...p.discards, tile],
    riichi: p.riichi || declareRiichi,
    isDoubleRiichi: declareRiichi ? isFirstTurn : p.isDoubleRiichi,
    // 立直棒当场从点数里扣走，不是等和了再算
    points: p.points - (declareRiichi ? RIICHI_STICK : 0),
    // 自己打完牌一发就失效；宣告这一下开始算一发
    ippatsu: declareRiichi,
  }));

  return {
    ok: true,
    state: {
      ...state,
      players,
      phase: "awaiting_call",
      lastDraw: null,
      lastDiscard: { tile, from: seat },
      riichiSticks: state.riichiSticks + (declareRiichi ? 1 : 0),
    },
  };
}

/**
 * 无人响应，流转到下家。
 *
 * 一发只在「鸣牌」与「自己再打一张」两处失效，不在这里 —— 别家放过一张不影响
 * 立直者的一发。
 */
export function passCall(state: RoundState): ActionResult {
  if (state.phase !== "awaiting_call") return reject(state, "wrong_phase");
  const from = state.lastDiscard!.from;
  const next = ((from + 1) % 4) as Seat;
  const turnCount =
    next === state.dealer ? state.turnCount + 1 : state.turnCount;
  return {
    ok: true,
    state: drawFor({ ...state, lastDiscard: null, turnCount }, next),
  };
}

/** 自摸和牌。 */
export function tsumo(state: RoundState, seat: Seat): ActionResult {
  if (state.phase === "finished") return reject(state, "round_over");
  if (state.phase !== "awaiting_discard") return reject(state, "wrong_phase");
  if (state.turn !== seat) return reject(state, "not_your_turn");
  if (state.lastDraw === null) return reject(state, "not_winning_hand");
  return settleWin(state, seat, null, state.lastDraw);
}

/**
 * 荣和。
 *
 * 振听判定在这里而不在算番层：振听不改变这手牌值多少点，它决定的是能不能和。
 */
export function ron(state: RoundState, seat: Seat): ActionResult {
  if (state.phase === "finished") return reject(state, "round_over");
  if (state.phase !== "awaiting_call") return reject(state, "wrong_phase");

  const info = state.lastDiscard;
  if (!info || info.from === seat) return reject(state, "nothing_to_call");

  const player = state.players[seat];
  const waits = waitingTiles(player.hand, player.melds);
  if (!waits.includes(toTile34(info.tile))) {
    return reject(state, "not_winning_hand");
  }
  if (isFuriten(player, waits)) return reject(state, "furiten");

  return settleWin(state, seat, info.from, info.tile);
}

/* ------------------------------------------------------------------ *
 * 结算
 * ------------------------------------------------------------------ */

function settleWin(
  state: RoundState,
  winner: Seat,
  loser: Seat | null,
  winTile: Tile136,
): ActionResult {
  const player = state.players[winner];
  const isTsumo = loser === null;
  // 荣和时和了牌还在别人牌河里，要补进来才够 14 张
  const tiles = isTsumo ? [...player.hand] : [...player.hand, winTile];

  const context: WinContext = {
    isTsumo,
    isRiichi: player.riichi,
    isIppatsu: player.ippatsu,
    isDaburuRiichi: player.isDoubleRiichi,
    isRinshan: false,
    isChankan: false,
    // 海底 / 河底：牌山摸空的那一巡
    isHaitei: isTsumo && state.wall.length === 0,
    isHoutei: !isTsumo && state.wall.length === 0,
    isNagashiMangan: false,
    isTenhou: false,
    isChiihou: false,
    isRenhou: false,
    playerWind: windOfSeat(winner, state.dealer),
    roundWind: state.roundWind,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    rules: DEFAULT_RULES,
  };

  const value = estimateHandValue({
    tiles,
    winTile,
    melds: [...player.melds],
    doraIndicators: state.deadWall.slice(0, state.doraRevealed),
    // 里宝牌只有立直才看得到
    uraDoraIndicators: player.riichi
      ? state.deadWall.slice(5, 5 + state.doraRevealed)
      : [],
    context,
  });

  if (value.error !== null || value.cost === null) {
    // 无役的荣和要罚同巡振听 —— 不罚的话同一张牌可以反复宣告，直到蒙对为止
    if (value.error === "ERR_NO_YAKU" && !isTsumo) {
      return {
        ok: false,
        reason: "no_yaku",
        state: {
          ...state,
          players: replacePlayer(state.players, winner, (p) => ({
            ...p,
            temporaryFuriten: true,
          })),
        },
      };
    }
    return reject(
      state,
      value.error === "ERR_NO_YAKU" ? "no_yaku" : "not_winning_hand",
    );
  }

  const cost = value.cost;
  const deltas: [number, number, number, number] = [0, 0, 0, 0];
  // total 已含本场棒与立直棒
  deltas[winner] = cost.total;

  if (isTsumo) {
    // 庄家自摸三家各付 main；闲家自摸庄家付 main、另两闲各付 additional
    for (const s of SEATS) {
      if (s === winner) continue;
      const pays = winner === state.dealer || s === state.dealer;
      deltas[s] = pays
        ? -(cost.main + cost.mainBonus)
        : -(cost.additional + cost.additionalBonus);
    }
  } else {
    deltas[loser] = -(cost.main + cost.mainBonus);
  }

  return {
    ok: true,
    state: {
      ...state,
      players: applyDeltas(state.players, deltas),
      phase: "finished",
      // 立直棒已在宣告时从各自点数里扣走，这里只是把桌上的棒清掉
      riichiSticks: 0,
      result: {
        reason: isTsumo ? "tsumo" : "ron",
        winner,
        loser,
        han: value.han,
        fu: value.fu,
        yaku: value.yaku.map((y) => ({ id: y.id, han: y.han })),
        deltas,
      },
    },
  };
}

/**
 * 荒牌流局。
 *
 * 听牌的收、没听的付，总额 3000。四家全听或全不听都不罚符 —— 这两种情况下
 * 「听牌方」与「不听方」必有一边是空集，均分无从谈起（也确实是规则原文）。
 *
 * 桌面上的立直棒不清，留给下一局。
 */
function exhaustiveDraw(state: RoundState): RoundState {
  const tenpai = SEATS.map((s) => isTenpai(state.players[s]));
  const count = tenpai.filter(Boolean).length;
  const deltas: [number, number, number, number] = [0, 0, 0, 0];

  if (count > 0 && count < 4) {
    const gain = TENPAI_PENALTY / count;
    const loss = TENPAI_PENALTY / (4 - count);
    for (const s of SEATS) {
      deltas[s] = tenpai[s] ? gain : -loss;
    }
  }

  return {
    ...state,
    players: applyDeltas(state.players, deltas),
    phase: "finished",
    lastDraw: null,
    lastDiscard: null,
    result: {
      reason: "exhaustive_draw",
      winner: null,
      loser: null,
      han: 0,
      fu: 0,
      yaku: [],
      deltas,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 座位的自风。庄家为东，按座次顺推。 */
export function windOfSeat(seat: Seat, dealer: Seat): Tile34 {
  return EAST + ((((seat - dealer) % 4) + 4) % 4);
}

function applyDeltas(
  players: RoundState["players"],
  deltas: readonly number[],
): RoundState["players"] {
  return players.map((p, i) => ({
    ...p,
    points: p.points + deltas[i],
  })) as unknown as RoundState["players"];
}

function replacePlayer(
  players: RoundState["players"],
  seat: Seat,
  update: (p: PlayerState) => PlayerState,
): RoundState["players"] {
  return players.map((p, i) =>
    i === seat ? update(p) : p,
  ) as unknown as RoundState["players"];
}

/** 拒绝：原样退回同一个状态引用，好让调用方能用 `===` 断言状态没动。 */
function reject(state: RoundState, reason: ActionRejection): ActionResult {
  return { ok: false, reason, state };
}

/*
 * TODO(鸣牌)：吃碰杠还没接。缺的是三块：
 *   - `awaiting_call` 阶段的响应优先级（荣 > 碰/杠 > 吃），现在只有荣。
 *   - 鸣牌后跳过被跨过的座位，且**不摸牌**直接进 awaiting_discard。
 *   - 杠：翻新宝牌指示、从岭上摸、`isRinshan`、以及抢杠 `isChankan`。
 * `melds` 字段与算番层从一开始就是按有副露写的，接上时这两处都不用改。
 */
