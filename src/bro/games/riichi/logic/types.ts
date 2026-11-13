/**
 * 立直麻将：算番所需的类型契约。
 *
 * 这一层只描述「算一次和牌需要知道什么」，不描述对局怎么走。摸打、鸣牌、
 * 立直宣告、振听、流局都不在这里 —— 那是状态机的事（core/types.ts 约束 2：
 * 状态由服务端权威推进）。本模块拿到的永远是一个**已经和了的瞬间快照**，
 * 输出是这一次和了值多少点。
 *
 * 之所以要把边界划得这么死：算番是六款游戏里唯一能对着外部权威语料逐条验证的
 * 部分，一旦把对局状态混进来，用例就没法一一对应，验证也就无从谈起。
 */

import type { Tile136, Tile34 } from "./tiles";

/**
 * 副露类型。
 *
 * `shouminkan`（加杠）单列而不是并进 `kan`：它在抢杠判定里是唯一可被抢的杠，
 * 并进去就没法区分了。符数上它与明杠同价，但那是符计算自己的事。
 */
export type MeldType = "chi" | "pon" | "kan" | "shouminkan";

export interface Meld {
  readonly type: MeldType;
  /**
   * 是否明露。
   *
   * 暗杠 `type === "kan" && !opened` —— 它**不破门清**，这是最容易写错的一条：
   * 按「有副露即非门清」实现的话，暗杠会把门前清自摸和、立直、平和一并吃掉。
   */
  readonly opened: boolean;
  readonly tiles: readonly Tile136[];
}

/** 一个面子或雀头，用 Tile34 列举。长度 2 = 雀头，3 = 顺子/刻子，4 = 杠。 */
export type TileGroup = readonly Tile34[];

/** 一种完整拆法：4 面子 + 1 雀头（七对子则是 7 个对子）。 */
export type Division = readonly TileGroup[];


export interface RuleOptions {
  /** 食断（副露后仍可断幺九）。§2.2：允许。 */
  readonly hasOpenTanyao: boolean;
  /** 赤宝牌。§2.2：有。 */
  readonly hasAkaDora: boolean;
  /** 双役满。§2.2：计。 */
  readonly hasDoubleYakuman: boolean;
}

/** 本项目锁定的口径（§2.2）。语料用例会各自覆盖这些值。 */
export const DEFAULT_RULES: RuleOptions = {
  hasOpenTanyao: true,
  hasAkaDora: true,
  hasDoubleYakuman: true,
};

/**
 * 和了瞬间的全部条件。
 *
 * 状态类字段（立直、一发、海底……）由状态机填，本层只读不判 —— 「一发是否
 * 还有效」是状态机的判断，到这里时它已经是既定事实。
 */
export interface WinContext {
  readonly isTsumo: boolean;
  readonly isRiichi: boolean;
  readonly isIppatsu: boolean;
  readonly isDaburuRiichi: boolean;
  /** 岭上开花：杠后摸牌自摸。 */
  readonly isRinshan: boolean;
  /** 抢杠：荣和别家加杠的那张。 */
  readonly isChankan: boolean;
  /** 海底摸月：牌山最后一张自摸。 */
  readonly isHaitei: boolean;
  /** 河底捞鱼：最后一张打牌荣和。 */
  readonly isHoutei: boolean;
  /** 流局满贯。它不是和牌，走的是另一条结算路径。 */
  readonly isNagashiMangan: boolean;
  /** 天和：庄家配牌即和。 */
  readonly isTenhou: boolean;
  /** 地和：闲家第一巡自摸。 */
  readonly isChiihou: boolean;
  /** 人和：闲家第一巡荣和。 */
  readonly isRenhou: boolean;
  /**
   * 自风。null 表示未指定（语料里有大量这种用例），此时不计自风役。
   * 庄家 = 自风为东，`score` 靠这个判断庄闲。
   */
  readonly playerWind: Tile34 | null;
  /** 场风。null 同上。 */
  readonly roundWind: Tile34 | null;
  /** 本场数。每本场荣和 +300、自摸每家 +100。 */
  readonly honba: number;
  /** 场上立直棒数，各 1000 点，全额归和了者。 */
  readonly riichiSticks: number;
  readonly rules: RuleOptions;
}

/** 一次和了的完整输入。 */
export interface HandInput {
  /** 全部 14 张（含和了牌与副露牌）的实体编号。 */
  readonly tiles: readonly Tile136[];
  /** 和了牌。流局满贯时为 null —— 它没有和了牌。 */
  readonly winTile: Tile136 | null;
  readonly melds: readonly Meld[];
  readonly doraIndicators: readonly Tile136[];
  /** 里宝牌指示牌。未立直时即便传了也不该生效。 */
  readonly uraDoraIndicators: readonly Tile136[];
  readonly context: WinContext;
}

/** 役的稳定标识。UI 用它查日文名与中文说明（见 yaku.ts 的 YAKU 表）。 */
export type YakuId = string;

/** 算出来的一个役及其番数。 */
export interface ScoredYaku {
  readonly id: YakuId;
  /** 本次和了中该役实际计入的番数（副露降番后的值）。 */
  readonly han: number;
  /** 役满倍数。0 表示普通役。 */
  readonly yakumanMultiplier: number;
}

/** 符的来源。展示时逐条列出，让玩家看懂 40 符是怎么来的。 */
export type FuReason =
  | "base"
  | "openPon"
  | "closedPon"
  | "openTerminalPon"
  | "closedTerminalPon"
  | "openKan"
  | "closedKan"
  | "openTerminalKan"
  | "closedTerminalKan"
  | "penchan"
  | "kanchan"
  | "pairWait"
  | "valuedPair"
  | "doubleValuedPair"
  | "tsumo"
  | "handWithoutFu";

export interface FuDetail {
  readonly fu: number;
  readonly reason: FuReason;
}

/** 点数分配。 */
export interface ScoreBreakdown {
  /** 荣和：放铳者付的全额。自摸：闲家付庄家 / 庄家收每家的那份。 */
  readonly main: number;
  /** 自摸时闲家之间互付的那份。荣和恒为 0。 */
  readonly additional: number;
  readonly mainBonus: number;
  readonly additionalBonus: number;
  readonly riichiStickBonus: number;
  /** 和了者实际到手的总点数。 */
  readonly total: number;
}

/**
 * 算不出的原因。
 *
 * 「无役」是正常结果不是异常 —— 手里全是宝牌却一个役都没有时不能和牌，
 * 这条规则每局都会碰到。所以用返回值表达，不抛异常。
 *
 * `ERR_` 前缀沿用语料的命名（`HandCalculator.ERR_HAND_NOT_WINNING`），这样移植过来的
 * 用例能直接断言错误码字符串，不必再加一层翻译 —— 翻译层是又一个会出错的地方。
 */
export type HandError =
  | "ERR_HAND_NOT_WINNING"
  | "ERR_NO_YAKU"
  | "ERR_INVALID_INPUT";

export interface HandResult {
  readonly error: HandError | null;
  readonly han: number;
  readonly fu: number;
  readonly yaku: readonly ScoredYaku[];
  readonly fuDetails: readonly FuDetail[];
  readonly cost: ScoreBreakdown | null;
}
