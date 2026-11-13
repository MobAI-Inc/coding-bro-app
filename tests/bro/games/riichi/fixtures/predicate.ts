// 本文件由脚本从语料自动生成，请勿手工编辑。
//
// 用例数据来自 MahjongRepository/mahjong（Python 实现），MIT License。
//   Copyright (c) 2017 mahjong Python library contributors
//   仓库：https://github.com/MahjongRepository/mahjong
//   LICENSE：https://github.com/MahjongRepository/mahjong/blob/master/LICENSE.txt
//
// 本仓库仅移植其**用例数据**（牌型与期望结果），未复制其 Python 实现。
// MIT 许可要求保留上述版权声明，这段注释是许可条款的一部分，不要删。
import type { FixtureMeld } from "./config";

/**
 * 单个役的判定用例 —— 这是语料里**唯一直接点名役种**的部分，比 `len(result.yaku)`
 * 强得多（那个只说「找到 N 个役」，不说是哪个），所以全部照搬。
 *
 * 语义定为「**存在一种拆法**满足该役」/「**不存在任何拆法**满足该役」。语料原文写的是
 * `_hand(tiles, i)`（第 i 种拆法），下标同样是上游实现的迭代顺序。改成存在量词后结论
 * 与拆法顺序无关，而对这里每一条用例都与语料等价：生成时逐条验证过，正例中只有 3 条
 * 手牌有多种拆法（二杯口 ×2、对对和 ×1），它们本来问的就是「能不能这么看」；
 * 反例中的多拆法手牌只有混一色/清一色/九莲，这三个役的成立与否与怎么拆无关。
 *
 * `counts` 为 null 表示这条只看副露（三杠子/四杠子的判定不需要手牌）。
 */
export interface PredicateCase {
  readonly source: string;
  readonly notation: string;
  readonly yaku: string;
  readonly counts: readonly number[] | null;
  readonly melds: readonly FixtureMeld[];
  readonly winTile: number | null;
  readonly isTsumo: boolean | null;
  readonly playerWind: number | null;
  readonly expected: boolean;
}

export const PREDICATE_CASES: readonly PredicateCase[] = [
  {
    source: "tests_yaku_calculation.py::test_is_chitoitsu_hand",
    notation: "113355m11p113355s",
    yaku: "chiitoitsu",
    counts: [2, 0, 2, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_chitoitsu_hand",
    notation: "2299m1199p2299s44z",
    yaku: "chiitoitsu",
    counts: [0, 2, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_tanyao",
    notation: "234567m22p234567s",
    yaku: "tanyao",
    counts: [0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_tanyao",
    notation: "234567m22p123456s",
    yaku: "tanyao",
    counts: [0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_tanyao",
    notation: "234567m234567s22z",
    yaku: "tanyao",
    counts: [0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_iipeiko",
    notation: "123m23444p112233s",
    yaku: "iipeiko",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 3, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_ryanpeiko",
    notation: "22m223344p112233s",
    yaku: "ryanpeiko",
    counts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_ryanpeiko",
    notation: "22m111122223333s",
    yaku: "ryanpeiko",
    counts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_ryanpeiko",
    notation: "123m23444p112233s",
    yaku: "ryanpeiko",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 3, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanshoku",
    notation: "123m12345677p123s",
    yaku: "sanshoku",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanshoku",
    notation: "23455m123p123456s",
    yaku: "sanshoku",
    counts: [0, 1, 1, 1, 2, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanshoku_douko",
    notation: "111m11145677p111s",
    yaku: "sanshokuDouko",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 2, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanshoku_douko",
    notation: "222m33344455p111s",
    yaku: "sanshokuDouko",
    counts: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_toitoi",
    notation: "333m44555p111333s",
    yaku: "toitoi",
    counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_toitoi",
    notation: "777888999p777s44z",
    yaku: "toitoi",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 2, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_sankantsu",
    notation: "(仅副露)",
    yaku: "sankantsu",
    counts: null,
    melds: [
      {
        type: "kan",
        opened: true,
        tiles: [72, 73, 74, 75],
        notation: "1111s"
      },
      {
        type: "kan",
        opened: true,
        tiles: [80, 81, 82, 83],
        notation: "3333s"
      },
      {
        type: "kan",
        opened: true,
        tiles: [56, 57, 58, 59],
        notation: "6666p"
      }
    ],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_honroto",
    notation: "111m111999s11222z",
    yaku: "honroto",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 2, 3, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_honroto",
    notation: "1199m11p22334466z",
    yaku: "honroto",
    counts: [2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 2, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanankou",
    notation: "333m44555p111444s",
    yaku: "sanankou",
    counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [
      {
        type: "pon",
        opened: true,
        tiles: [84, 85, 86],
        notation: "444s"
      },
      {
        type: "pon",
        opened: true,
        tiles: [72, 73, 74],
        notation: "111s"
      }
    ],
    winTile: 84,
    isTsumo: false,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanankou",
    notation: "333m44555p111444s",
    yaku: "sanankou",
    counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [
      {
        type: "pon",
        opened: true,
        tiles: [72, 73, 74],
        notation: "111s"
      }
    ],
    winTile: 84,
    isTsumo: false,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanankou",
    notation: "333m44555p111444s",
    yaku: "sanankou",
    counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [
      {
        type: "pon",
        opened: true,
        tiles: [72, 73, 74],
        notation: "111s"
      }
    ],
    winTile: 84,
    isTsumo: true,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanankou",
    notation: "444789999p22333z",
    yaku: "sanankou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0],
    melds: [],
    winTile: 68,
    isTsumo: false,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_sanankou",
    notation: "222456666777p77z",
    yaku: "sanankou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    melds: [
      {
        type: "chi",
        opened: true,
        tiles: [48, 52, 56],
        notation: "456p"
      }
    ],
    winTile: 56,
    isTsumo: false,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_shosangen",
    notation: "345m123s55666777z",
    yaku: "shosangen",
    counts: [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 3],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_chanta",
    notation: "123789m123s22333z",
    yaku: "chantai",
    counts: [1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_chanta",
    notation: "111999m111s22333z",
    yaku: "chantai",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_chanta",
    notation: "111999m11p111999s",
    yaku: "chantai",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_junchan",
    notation: "123789m12399p789s",
    yaku: "junchan",
    counts: [1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_junchan",
    notation: "111999m111s22333z",
    yaku: "junchan",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_junchan",
    notation: "111999m11p111999s",
    yaku: "junchan",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_honitsu",
    notation: "123456789m11122z",
    yaku: "honitsu",
    counts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_honitsu",
    notation: "123456789m123p22z",
    yaku: "honitsu",
    counts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_honitsu",
    notation: "12345666778899m",
    yaku: "honitsu",
    counts: [1, 1, 1, 1, 1, 3, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_chinitsu",
    notation: "12345666778899m",
    yaku: "chinitsu",
    counts: [1, 1, 1, 1, 1, 3, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_chinitsu",
    notation: "123456778899m22z",
    yaku: "chinitsu",
    counts: [1, 1, 1, 1, 1, 1, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_ittsu",
    notation: "123456789m123s22z",
    yaku: "ittsu",
    counts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_ittsu",
    notation: "112233456789m22z",
    yaku: "ittsu",
    counts: [2, 2, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_ittsu",
    notation: "122334567789m11z",
    yaku: "ittsu",
    counts: [1, 2, 2, 1, 1, 1, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yaku_calculation.py::test_is_haku",
    notation: "22234m234567s555z",
    yaku: "haku",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_hatsu",
    notation: "22234m234567s666z",
    yaku: "hatsu",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_chun",
    notation: "22234m234567s777z",
    yaku: "chun",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_east",
    notation: "22234m234567s111z",
    yaku: "seatWindEast",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: 27,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_south",
    notation: "22234m234567s222z",
    yaku: "seatWindSouth",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: 28,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_west",
    notation: "22234m234567s333z",
    yaku: "seatWindWest",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 3, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: 29,
    expected: true
  },
  {
    source: "tests_yaku_calculation.py::test_is_north",
    notation: "22234m234567s444z",
    yaku: "seatWindNorth",
    counts: [0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: 30,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_daisangen",
    notation: "22m123s555666777z",
    yaku: "daisangen",
    counts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_shosuushi",
    notation: "123s11122233344z",
    yaku: "shosuushi",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 3, 3, 3, 2, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_daisuushi",
    notation: "22s111222333444z",
    yaku: "daisuushi",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_tsuisou",
    notation: "11122233366677z",
    yaku: "tsuisou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 0, 0, 3, 2],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_tsuisou",
    notation: "11223344556677z",
    yaku: "tsuisou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_tsuisou",
    notation: "88p11s1133445577z",
    yaku: "tsuisou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 2, 2, 0, 2],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chinroto",
    notation: "111999m99p111999s",
    yaku: "chinroto",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_kokushi",
    notation: "19m19p119s1234567z",
    yaku: "kokushi",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_ryuisou",
    notation: "22334466888s666z",
    yaku: "ryuisou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 2, 0, 3, 0, 0, 0, 0, 0, 0, 3, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_suuankou",
    notation: "333m44555p111444s",
    yaku: "suuankou",
    counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: 84,
    isTsumo: true,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_suuankou",
    notation: "333m44555p111444s",
    yaku: "suuankou",
    counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: 84,
    isTsumo: false,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11112345678999m",
    yaku: "chuurenPoutou",
    counts: [4, 1, 1, 1, 1, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11122345678999p",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 1, 1, 1, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123345678999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 2, 1, 1, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123445678999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 2, 1, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123455678999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 2, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123456678999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 2, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123456778999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 2, 1, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123456788999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_chuuren_poutou",
    notation: "11123456789999s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
  {
    source: "tests_yakuman_calculation.py::test_is_not_chuuren_poutou",
    notation: "11112233488999m",
    yaku: "chuurenPoutou",
    counts: [4, 2, 2, 1, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yakuman_calculation.py::test_is_not_chuuren_poutou",
    notation: "11123444678999p",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 3, 0, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yakuman_calculation.py::test_is_not_chuuren_poutou",
    notation: "12345678999p111z",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yakuman_calculation.py::test_is_not_chuuren_poutou",
    notation: "999m11123456789s",
    yaku: "chuurenPoutou",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: false
  },
  {
    source: "tests_yakuman_calculation.py::test_is_suukantsu",
    notation: "(仅副露)",
    yaku: "suukantsu",
    counts: null,
    melds: [
      {
        type: "kan",
        opened: true,
        tiles: [72, 73, 74, 75],
        notation: "1111s"
      },
      {
        type: "kan",
        opened: true,
        tiles: [80, 81, 82, 83],
        notation: "3333s"
      },
      {
        type: "kan",
        opened: true,
        tiles: [52, 53, 54, 55],
        notation: "5555p"
      },
      {
        type: "shouminkan",
        opened: true,
        tiles: [4, 5, 6, 7],
        notation: "2222m"
      }
    ],
    winTile: null,
    isTsumo: null,
    playerWind: null,
    expected: true
  },
];
