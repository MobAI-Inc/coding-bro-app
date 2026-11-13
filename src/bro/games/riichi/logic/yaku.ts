

import type { YakuId } from "./types";

export interface YakuDef {
  readonly id: YakuId;
  /** 日文名（汉字原文）。UI 直接显示这个。 */
  readonly name: string;
  /** 中文说明，一句话讲清成立条件。 */
  readonly explanation: string;
  /** 门清时的番数。役满为 0，看 `yakumanMultiplier`。 */
  readonly han: number;
  /** 副露后的番数。0 表示副露即不成立（配合 `requiresClosed`）。 */
  readonly hanOpen: number;
  /** 役满倍数。0 = 普通役，1 = 役满，2 = 双役满。 */
  readonly yakumanMultiplier: number;
  /** 是否要求门清。副露后该役直接不成立。 */
  readonly requiresClosed: boolean;
}

function y(
  id: YakuId,
  name: string,
  explanation: string,
  han: number,
  hanOpen: number,
): YakuDef {
  return {
    id,
    name,
    explanation,
    han,
    hanOpen,
    yakumanMultiplier: 0,
    requiresClosed: hanOpen === 0,
  };
}

function yakuman(
  id: YakuId,
  name: string,
  explanation: string,
  multiplier: number,
  closed: boolean,
): YakuDef {
  return {
    id,
    name,
    explanation,
    han: 0,
    hanOpen: 0,
    yakumanMultiplier: multiplier,
    requiresClosed: closed,
  };
}

/**
 * 全部役。key 与 `ScoredYaku.id` 一致。
 *
 * 副露降番（`hanOpen < han`）不是可选项而是规则：三色同顺门清 2 番、副露 1 番。
 * 把它编码在数据里而不是散落在判定函数里，是因为它只跟役有关、跟牌型无关；
 * 写进判定逻辑的话，每加一个役都要重新想一遍这件事。
 */
export const YAKU: Readonly<Record<string, YakuDef>> = {
  // ---- 1 番 ----
  riichi: y("riichi", "立直", "门清状态下宣告立直，押出 1000 点立直棒。", 1, 0),
  ippatsu: y("ippatsu", "一発", "立直后一巡内和牌，且这一巡内无人鸣牌。", 1, 0),
  menzenTsumo: y("menzenTsumo", "門前清自摸和", "门清状态下自摸和牌。", 1, 0),
  pinfu: y(
    "pinfu",
    "平和",
    "门清、四顺子、雀头非役牌、两面听 —— 全无附加符的手牌。",
    1,
    0,
  ),
  tanyao: y(
    "tanyao",
    "断幺九",
    "手牌不含任何幺九字牌。本项目允许食断（§2.2）。",
    1,
    1,
  ),
  iipeiko: y("iipeiko", "一盃口", "两副完全相同的顺子。副露即不成立。", 1, 0),
  haku: y("haku", "役牌 白", "白板刻子。", 1, 1),
  hatsu: y("hatsu", "役牌 發", "发财刻子。", 1, 1),
  chun: y("chun", "役牌 中", "红中刻子。", 1, 1),
  seatWindEast: y("seatWindEast", "自風 東", "自风为东时的东刻子。", 1, 1),
  seatWindSouth: y("seatWindSouth", "自風 南", "自风为南时的南刻子。", 1, 1),
  seatWindWest: y("seatWindWest", "自風 西", "自风为西时的西刻子。", 1, 1),
  seatWindNorth: y("seatWindNorth", "自風 北", "自风为北时的北刻子。", 1, 1),
  roundWindEast: y(
    "roundWindEast",
    "場風 東",
    "东场时的东刻子。与自风东可同时计，合计 2 番。",
    1,
    1,
  ),
  roundWindSouth: y("roundWindSouth", "場風 南", "南场时的南刻子。", 1, 1),
  roundWindWest: y("roundWindWest", "場風 西", "西场时的西刻子。", 1, 1),
  roundWindNorth: y("roundWindNorth", "場風 北", "北场时的北刻子。", 1, 1),
  haitei: y("haitei", "海底摸月", "自摸牌山最后一张。", 1, 1),
  houtei: y("houtei", "河底撈魚", "荣和本局最后一张打出的牌。", 1, 1),
  rinshan: y("rinshan", "嶺上開花", "杠之后摸岭上牌自摸和。", 1, 1),
  chankan: y("chankan", "槍槓", "荣和别家加杠的那张牌。暗杠不可抢。", 1, 1),

  // ---- 2 番 ----
  daburuRiichi: y(
    "daburuRiichi",
    "ダブル立直",
    "第一巡即宣告立直，且此前无人鸣牌。",
    2,
    0,
  ),
  chiitoitsu: y(
    "chiitoitsu",
    "七対子",
    "七个不同的对子。同种牌四张不算两对。固定 25 符。",
    2,
    0,
  ),
  chantai: y(
    "chantai",
    "混全帯幺九",
    "每个面子与雀头都含幺九或字牌。副露降 1 番。",
    2,
    1,
  ),
  sanshoku: y(
    "sanshoku",
    "三色同順",
    "万饼索三门同数字的顺子各一副。副露降 1 番。",
    2,
    1,
  ),
  ittsu: y(
    "ittsu",
    "一気通貫",
    "同一花色的 123 / 456 / 789 三副顺子。副露降 1 番。",
    2,
    1,
  ),
  toitoi: y("toitoi", "対々和", "四个面子全是刻子或杠。", 2, 2),
  sanankou: y("sanankou", "三暗刻", "三个暗刻。荣和的那一组不算暗刻。", 2, 2),
  sanshokuDouko: y(
    "sanshokuDouko",
    "三色同刻",
    "万饼索三门同数字的刻子各一副。",
    2,
    2,
  ),
  sankantsu: y("sankantsu", "三槓子", "三个杠。", 2, 2),
  honroto: y(
    "honroto",
    "混老頭",
    "手牌只由幺九与字牌构成。必然同时成立对对和或七对子。",
    2,
    2,
  ),
  shosangen: y(
    "shosangen",
    "小三元",
    "两个三元牌刻子 + 第三种三元牌作雀头。",
    2,
    2,
  ),

  // ---- 3 番 ----
  honitsu: y("honitsu", "混一色", "只用一种花色加字牌。副露降 1 番。", 3, 2),
  junchan: y(
    "junchan",
    "純全帯幺九",
    "每个面子与雀头都含幺九，且不含字牌。副露降 1 番。",
    3,
    2,
  ),
  ryanpeiko: y(
    "ryanpeiko",
    "二盃口",
    "两组一盃口。成立时不再另计一盃口。副露即不成立。",
    3,
    0,
  ),

  // ---- 6 番 ----
  chinitsu: y(
    "chinitsu",
    "清一色",
    "只用一种花色，不含字牌。副露降 1 番。",
    6,
    5,
  ),

  // ---- 特殊 ----
  nagashiMangan: y(
    "nagashiMangan",
    "流し満貫",
    "流局时自己打出的牌全是幺九且无人鸣过，按满贯计。",
    5,
    5,
  ),
  /**
   * 人和的番数是本项目取的口径，§2.2 未规定。
   * 取 5 番（满贯）是沿用语料库的默认值；天凤等规则里也有按役满算的流派。
   */
  renhou: y(
    "renhou",
    "人和",
    "闲家第一巡荣和。本项目按满贯（5 番）计 —— 规则书未定，见注释。",
    5,
    5,
  ),

  // ---- 役满 ----
  kokushi: yakuman(
    "kokushi",
    "国士無双",
    "十三种幺九字牌各一张，其中一种成对。",
    1,
    true,
  ),
  daburuKokushi: yakuman(
    "daburuKokushi",
    "国士無双十三面待ち",
    "国士十三面听。双役满。",
    2,
    true,
  ),
  suuankou: yakuman(
    "suuankou",
    "四暗刻",
    "四个暗刻。荣和的那一组不算暗刻。",
    1,
    true,
  ),
  suuankouTanki: yakuman(
    "suuankouTanki",
    "四暗刻単騎",
    "四暗刻且单骑听雀头。双役满。",
    2,
    true,
  ),
  daisangen: yakuman("daisangen", "大三元", "白发中三个刻子。", 1, false),
  shosuushi: yakuman(
    "shosuushi",
    "小四喜",
    "三个风牌刻子 + 第四种风牌作雀头。",
    1,
    false,
  ),
  daisuushi: yakuman(
    "daisuushi",
    "大四喜",
    "东南西北四个刻子。双役满。",
    2,
    false,
  ),
  tsuisou: yakuman("tsuisou", "字一色", "手牌全是字牌。", 1, false),
  chinroto: yakuman(
    "chinroto",
    "清老頭",
    "手牌只由数牌的 1 和 9 构成。",
    1,
    false,
  ),
  ryuisou: yakuman("ryuisou", "緑一色", "只用 23468 索与发财。", 1, false),
  chuurenPoutou: yakuman(
    "chuurenPoutou",
    "九蓮宝燈",
    "同花色 1112345678999 加任意一张。",
    1,
    true,
  ),
  daburuChuurenPoutou: yakuman(
    "daburuChuurenPoutou",
    "純正九蓮宝燈",
    "九莲宝灯的九面听形。双役满。",
    2,
    true,
  ),
  suukantsu: yakuman("suukantsu", "四槓子", "四个杠。", 1, false),
  tenhou: yakuman("tenhou", "天和", "庄家配牌即和。", 1, true),
  chiihou: yakuman("chiihou", "地和", "闲家第一巡自摸和。", 1, true),
};
