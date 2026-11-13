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
 * 拆解用例。`divisions` 直接来自语料写出的期望拆法（`['234m', '567m', ...]`）。
 *
 * **与语料的一处刻意偏差**：语料是按下标断言的（`result[0] == ...`、`result[1] == ...`），
 * 那个顺序是上游 Python 实现的迭代顺序，不是麻将规则。照抄下标等于把别人的实现细节
 * 冻进我们的测试 —— 将来我们换个枚举顺序，测试会无理由地红。所以这里**按集合比较**：
 * 拆法个数必须一致、集合必须一致，顺序不参与断言。
 */
export interface DivideCase {
  readonly source: string;
  readonly notation: string;
  readonly counts: readonly number[];
  readonly melds: readonly (readonly number[])[];
  readonly expectedCount: number;
  /** 期望的全部拆法（顺序无关）。空数组表示语料只断言了个数。 */
  readonly divisions: readonly (readonly (readonly number[])[])[];
}

export const DIVIDE_CASES: readonly DivideCase[] = [
  {
    source: "tests_hand_dividing.py::test_single_hand_dividing[simple]",
    notation: "234567m23455s777z",
    counts: [0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
    melds: [],
    expectedCount: 1,
    divisions: [
      [[1, 2, 3], [4, 5, 6], [19, 20, 21], [22, 22], [33, 33, 33]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_single_hand_dividing[simple_all_suits]",
    notation: "123m123p123s11222z",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 1,
    divisions: [
      [[0, 1, 2], [9, 10, 11], [18, 19, 20], [27, 27], [28, 28, 28]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_single_hand_dividing[with_pairs]",
    notation: "23444m344556p333s",
    counts: [0, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 1,
    divisions: [
      [[1, 2, 3], [3, 3], [11, 12, 13], [12, 13, 14], [20, 20, 20]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_single_hand_dividing[one_suit]",
    notation: "111123666789s11z",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 1, 0, 0, 3, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 1,
    divisions: [
      [[18, 18, 18], [18, 19, 20], [23, 23, 23], [24, 25, 26], [27, 27]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_multiple_hand_dividing[one_suit]",
    notation: "11122233388899m",
    counts: [3, 3, 3, 0, 0, 0, 0, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 2,
    divisions: [
      [[0, 0, 0], [1, 1, 1], [2, 2, 2], [7, 7, 7], [8, 8]],
      [[0, 1, 2], [0, 1, 2], [0, 1, 2], [7, 7, 7], [8, 8]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_multiple_hand_dividing[chitoitsu_like]",
    notation: "112233m99p445566s",
    counts: [2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 2,
    divisions: [
      [[0, 0], [1, 1], [2, 2], [17, 17], [21, 21], [22, 22], [23, 23]],
      [[0, 1, 2], [0, 1, 2], [17, 17], [21, 22, 23], [21, 22, 23]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_third_one_suit_hand_dividing",
    notation: "234777888999p22z",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0],
    melds: [[15, 16, 17], [10, 11, 12]],
    expectedCount: 1,
    divisions: [
      [[10, 11, 12], [15, 16, 17], [15, 16, 17], [15, 16, 17], [28, 28]]
    ]
  },
  {
    source: "tests_hand_dividing.py::test_divide_hand_skips_hand_with_5_identical_tiles",
    notation: "11111m123p123s111z",
    counts: [5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_divide_hand_skips_hand_with_5_identical_tiles_with_meld",
    notation: "11111m123p123s111z",
    counts: [5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    melds: [[0, 0, 0]],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_divide_hand_skips_hand_with_6_identical_tiles",
    notation: "111111m123p123s11z",
    counts: [6, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_divide_hand_skips_hand_with_6_identical_tiles_with_meld",
    notation: "111111m123p123s11z",
    counts: [6, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    melds: [[0, 0, 0]],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_divide_hand_skips_combinations_with_wrong_block_count",
    notation: "123789m123789p111s11z",
    counts: [1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    melds: [],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_decompose_honors_hand_rejects_invalid_tile_count",
    notation: "111m111p111s1111122233z",
    counts: [3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 5, 3, 2, 0, 0, 0, 0],
    melds: [],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_decompose_chiitoitsu_rejects_hand_with_melds",
    notation: "2288m2288p22s2244z",
    counts: [0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0],
    melds: [[0, 0, 0]],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_decompose_chiitoitsu_rejects_hand_with_too_many_tiles",
    notation: "2288m2288p228s2244z",
    counts: [0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 2, 0, 0, 0],
    melds: [],
    expectedCount: 0,
    divisions: []
  },
  {
    source: "tests_hand_dividing.py::test_decompose_chiitoitsu_rejects_hand_with_too_many_pairs",
    notation: "2288m2288p2288s2244z",
    counts: [0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 0],
    melds: [],
    expectedCount: 0,
    divisions: []
  },
];
