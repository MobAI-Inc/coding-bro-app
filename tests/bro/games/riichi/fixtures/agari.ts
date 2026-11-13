// 本文件由脚本从语料自动生成，请勿手工编辑。
//
// 用例数据来自 MahjongRepository/mahjong（Python 实现），MIT License。
//   Copyright (c) 2017 mahjong Python library contributors
//   仓库：https://github.com/MahjongRepository/mahjong
//   LICENSE：https://github.com/MahjongRepository/mahjong/blob/master/LICENSE.txt
//
// 本仓库仅移植其**用例数据**（牌型与期望结果），未复制其 Python 实现。
// MIT 许可要求保留上述版权声明，这段注释是许可条款的一部分，不要删。

/**
 * 和牌判定用例。`counts` 是 34 位张数数组（含副露牌），`melds` 是已副露的面子。
 *
 * 反例里有三类特别值得留意，它们分别打掉一种偷懒实现：
 *   - 单纯「张数够 + 能凑出 4 面子」但雀头对不上的牌型；
 *   - 五张同牌、六张同牌 —— 牌山里根本不存在，必须判 false 而不是崩溃；
 *   - 有副露时，剩余手牌的面子数必须与副露数相加恰好为 4，多算一个也不行。
 */
export interface AgariCase {
  readonly source: string;
  readonly notation: string;
  readonly counts: readonly number[];
  readonly melds: readonly (readonly number[])[];
  readonly expected: boolean;
}

export const AGARI_CASES: readonly AgariCase[] = [
  {
    source: "tests_agari.py::test_is_agari",
    notation: "33m123p123456789s",
    counts: [0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_agari",
    notation: "11123p123456789s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_agari",
    notation: "123456789s11777z",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 3],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_agari",
    notation: "12345556778899s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 3, 1, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_agari",
    notation: "11123456788999s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_agari",
    notation: "345m789p233334s55z",
    counts: [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_not_agari",
    notation: "12345p123456789s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_is_not_agari",
    notation: "11145p111222444s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 0, 0, 0, 0, 3, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_is_not_agari",
    notation: "11122233356888s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 0, 1, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_is_chitoitsu_agari",
    notation: "1199p1133557799s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_chitoitsu_agari",
    notation: "11m1199p2244s2277z",
    counts: [2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_chitoitsu_agari",
    notation: "11223344556677m",
    counts: [2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_kokushi_musou_agari",
    notation: "199m19p19s1234567z",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_kokushi_musou_agari",
    notation: "19m19p19s11234567z",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 1, 1, 1, 1, 1],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_kokushi_musou_agari",
    notation: "19m19p19s12345677z",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_is_not_kokushi_musou_agari",
    notation: "19m19p129s1234567z",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_is_not_kokushi_musou_agari",
    notation: "19m19p19s11134567z",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 3, 0, 1, 1, 1, 1, 1],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_is_agari_and_open_hand",
    notation: "345m222p23455567s",
    counts: [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [[2, 3, 4], [22, 22, 22]],
    expected: false
  },
  {
    source: "tests_agari.py::test_open_hand_with_many_melds_returns_false",
    notation: "123456789m123456789p123456789s1234567z",
    counts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    melds: [[0, 1, 2], [9, 10, 11]],
    expected: false
  },
  {
    source: "tests_agari.py::test_honor_tile_overflow_returns_false[honor_count_5]",
    notation: "55556z",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_honor_tile_overflow_returns_false[honor_count_4]",
    notation: "1111z",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_single_tile_in_suit_returns_false[man]",
    notation: "1m",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_single_tile_in_suit_returns_false[pin]",
    notation: "1p",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_single_tile_in_suit_returns_false[sou]",
    notation: "1s",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_wrong_pair_count_returns_false[two_suit_pairs]",
    notation: "11m11p",
    counts: [2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_wrong_pair_count_returns_false[zero_pairs]",
    notation: "111m",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_no_valid_decomposition_returns_false",
    notation: "147m11z",
    counts: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_is_mentsu_negative_a_returns_false",
    notation: "114m11z",
    counts: [2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: false
  },
  {
    source: "tests_agari.py::test_open_hand_with_kan_meld",
    notation: "1111m123456789p22s",
    counts: [4, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [[0, 0, 0, 0]],
    expected: true
  },
  {
    source: "tests_agari.py::test_atama_mentsu_pair_positions",
    notation: "66m111222333444p",
    counts: [0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_atama_mentsu_pair_positions",
    notation: "99m111222333444p",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_atama_mentsu_pair_positions",
    notation: "22m111222333444p",
    counts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_atama_mentsu_pair_positions",
    notation: "44m111222333444p",
    counts: [0, 0, 0, 2, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
  {
    source: "tests_agari.py::test_atama_mentsu_pair_positions",
    notation: "77m111222333444p",
    counts: [0, 0, 0, 0, 0, 0, 2, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expected: true
  },
];
