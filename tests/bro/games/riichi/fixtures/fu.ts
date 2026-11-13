// 本文件由脚本从语料自动生成，请勿手工编辑。
//
// 用例数据来自 MahjongRepository/mahjong（Python 实现），MIT License。
//   Copyright (c) 2017 mahjong Python library contributors
//   仓库：https://github.com/MahjongRepository/mahjong
//   LICENSE：https://github.com/MahjongRepository/mahjong/blob/master/LICENSE.txt
//
// 本仓库仅移植其**用例数据**（牌型与期望结果），未复制其 Python 实现。
// MIT 许可要求保留上述版权声明，这段注释是许可条款的一部分，不要删。
import type { FixtureConfig, FixtureMeld } from "./config";

/**
 * 符计算用例。
 *
 * `division` 写死了一种拆法，而不是照抄语料里的「第几个拆法」下标 —— 下标是上游实现的
 * 迭代顺序。生成脚本对这 26 条逐条验证过拆法唯一，所以写死是安全的，而且比下标更能
 * 说明意图（读用例的人能直接看见是哪四组面子）。
 *
 * `winGroup` 是「和了牌落在哪个面子里」。语料默认取第一个含和了牌的面子，
 * 但 `test_fu_based_on_win_group` 故意取两个：234789m1234566p 和 6p，
 * 既可以看成 456p 两面（30 符），也可以看成 66p 单骑（20+10+2=32 -> 40 符）。
 * 同一手牌、同一张和了牌、听法不同则符数不同 —— 所以 winGroup 必须是入参，
 * 不能由实现自己挑一个。
 *
 * `valuedTiles` 是役牌张（34 编号）。同一张出现两次表示自风与场风重合，
 * 该雀头记 4 符而不是 2 符。
 */
export interface FuCase {
  readonly source: string;
  readonly notation: string;
  readonly division: readonly (readonly number[])[];
  readonly winTile: number;
  readonly winGroup: readonly number[];
  readonly melds: readonly FixtureMeld[];
  readonly valuedTiles: readonly number[];
  readonly config: FixtureConfig;
  readonly expectedFu: number | null;
  readonly expectedDetailCount: number | null;
  readonly detailsIn: readonly FuDetail[];
  readonly detailsNotIn: readonly FuDetail[];
}

export interface FuDetail {
  readonly fu: number;
  readonly reason: string;
}

export const FU_CASES: readonly FuCase[] = [
  {
    source: "tests_fu_calculation.py::test_chitoitsu_fu",
    notation: "115599m66p112244s",
    division: [[0, 0], [4, 4], [8, 8], [14, 14], [18, 18], [19, 19], [21, 21]],
    winTile: 56,
    winGroup: [14, 14],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 25,
    expectedDetailCount: 1,
    detailsIn: [
      {
        fu: 25,
        reason: "base"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_chitoitsu_fu",
    notation: "115599m66p112244s",
    division: [[0, 0], [4, 4], [8, 8], [14, 14], [18, 18], [19, 19], [21, 21]],
    winTile: 56,
    winGroup: [14, 14],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 25,
    expectedDetailCount: 1,
    detailsIn: [
      {
        fu: 25,
        reason: "base"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_open_hand_base",
    notation: "123456m11p222678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [19, 19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "pon",
        opened: true,
        tiles: [76, 77, 78],
        notation: "222s"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 30,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      },
      {
        fu: 2,
        reason: "openPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_fu_based_on_win_group",
    notation: "234789m12345666p",
    division: [[1, 2, 3], [6, 7, 8], [9, 10, 11], [12, 13, 14], [14, 14]],
    winTile: 56,
    winGroup: [12, 13, 14],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 30,
    expectedDetailCount: null,
    detailsIn: [],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_fu_based_on_win_group",
    notation: "234789m12345666p",
    division: [[1, 2, 3], [6, 7, 8], [9, 10, 11], [12, 13, 14], [14, 14]],
    winTile: 56,
    winGroup: [14, 14],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: null,
    detailsIn: [],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_open_pinfu_adds_hand_without_fu",
    notation: "234567m22p234678s",
    division: [[1, 2, 3], [4, 5, 6], [10, 10], [19, 20, 21], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "chi",
        opened: true,
        tiles: [76, 80, 84],
        notation: "234s"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 30,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      },
      {
        fu: 2,
        reason: "handWithoutFu"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_tsumo_hand_base",
    notation: "123456m11p222678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [19, 19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: true,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: null,
    expectedDetailCount: null,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_tsumo_hand_and_pinfu",
    notation: "123456m123p22678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 10, 11], [19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: true,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 20,
    expectedDetailCount: 1,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_tsumo_hand_and_not_pinfu",
    notation: "123456m111p22678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9, 9], [19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: true,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 30,
    expectedDetailCount: null,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      },
      {
        fu: 2,
        reason: "tsumo"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_penchan_fu[12_wait]",
    notation: "123456m55p123456s",
    division: [[0, 1, 2], [3, 4, 5], [13, 13], [18, 19, 20], [21, 22, 23]],
    winTile: 80,
    winGroup: [18, 19, 20],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 2,
        reason: "penchan"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_penchan_fu[89_wait]",
    notation: "123456m55p345789s",
    division: [[0, 1, 2], [3, 4, 5], [13, 13], [20, 21, 22], [24, 25, 26]],
    winTile: 96,
    winGroup: [24, 25, 26],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 2,
        reason: "penchan"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_kanchan_fu",
    notation: "123456m55p123567s",
    division: [[0, 1, 2], [3, 4, 5], [13, 13], [18, 19, 20], [22, 23, 24]],
    winTile: 92,
    winGroup: [22, 23, 24],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 2,
        reason: "kanchan"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_valued_pair_fu[single]",
    notation: "123456m123678s11z",
    division: [[0, 1, 2], [3, 4, 5], [18, 19, 20], [23, 24, 25], [27, 27]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [27],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 2,
        reason: "valuedPair"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_valued_pair_fu[double]",
    notation: "123456m123678s11z",
    division: [[0, 1, 2], [3, 4, 5], [18, 19, 20], [23, 24, 25], [27, 27]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [27, 27],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 4,
        reason: "doubleValuedPair"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_pair_wait_fu",
    notation: "123456m11p123678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [18, 19, 20], [23, 24, 25]],
    winTile: 36,
    winGroup: [9, 9],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 2,
        reason: "pairWait"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_pon_fu",
    notation: "123456m11p222678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [19, 19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 4,
        reason: "closedPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_pon_fu",
    notation: "123456m11p222678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [19, 19, 19], [23, 24, 25]],
    winTile: 76,
    winGroup: [19, 19, 19],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 2,
        reason: "openPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_terminal_pon_fu",
    notation: "123456m11p111678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [18, 18, 18], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 8,
        reason: "closedTerminalPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_terminal_pon_fu",
    notation: "123456m11p111678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [18, 18, 18], [23, 24, 25]],
    winTile: 72,
    winGroup: [18, 18, 18],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 4,
        reason: "openTerminalPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_honor_pon_fu",
    notation: "123456m11678s111z",
    division: [[0, 1, 2], [3, 4, 5], [18, 18], [23, 24, 25], [27, 27, 27]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 8,
        reason: "closedTerminalPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_honor_pon_fu",
    notation: "123456m11678s111z",
    division: [[0, 1, 2], [3, 4, 5], [18, 18], [23, 24, 25], [27, 27, 27]],
    winTile: 108,
    winGroup: [27, 27, 27],
    melds: [],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 4,
        reason: "openTerminalPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_open_terminal_pon_fu",
    notation: "123456m22678s111z",
    division: [[0, 1, 2], [3, 4, 5], [19, 19], [23, 24, 25], [27, 27, 27]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "pon",
        opened: true,
        tiles: [108, 109, 110],
        notation: "111z"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 30,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      },
      {
        fu: 4,
        reason: "openTerminalPon"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_kan_fu",
    notation: "123456m11p222678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [19, 19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "kan",
        opened: false,
        tiles: [76, 77, 78],
        notation: "222s"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 50,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 16,
        reason: "closedKan"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_open_kan_fu",
    notation: "123456m11p222678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9], [19, 19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "kan",
        opened: true,
        tiles: [76, 77, 78],
        notation: "222s"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 30,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      },
      {
        fu: 8,
        reason: "openKan"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_closed_terminal_kan_fu",
    notation: "123456m111p22678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9, 9], [19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "kan",
        opened: false,
        tiles: [36, 37, 38],
        notation: "111p"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 70,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 30,
        reason: "base"
      },
      {
        fu: 32,
        reason: "closedTerminalKan"
      }
    ],
    detailsNotIn: []
  },
  {
    source: "tests_fu_calculation.py::test_open_terminal_kan_fu",
    notation: "123456m111p22678s",
    division: [[0, 1, 2], [3, 4, 5], [9, 9, 9], [19, 19], [23, 24, 25]],
    winTile: 92,
    winGroup: [23, 24, 25],
    melds: [
      {
        type: "kan",
        opened: true,
        tiles: [36, 37, 38],
        notation: "111p"
      }
    ],
    valuedTiles: [],
    config: {
      isTsumo: false,
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      isChankan: false,
      isHaitei: false,
      isHoutei: false,
      isDaburuRiichi: false,
      isNagashiMangan: false,
      isTenhou: false,
      isRenhou: false,
      isChiihou: false,
      playerWind: null,
      roundWind: null,
      hasOpenTanyao: false,
      hasAkaDora: false,
      hasDoubleYakuman: true,
      honba: 0,
      riichiSticks: 0
    },
    expectedFu: 40,
    expectedDetailCount: 2,
    detailsIn: [
      {
        fu: 20,
        reason: "base"
      },
      {
        fu: 16,
        reason: "openTerminalKan"
      }
    ],
    detailsNotIn: []
  },
];
