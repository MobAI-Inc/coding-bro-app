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
 * 向听数用例。
 *
 * `mode` 决定调用哪个入口：`any` 是三种形态取最小值，其余三个是单独形态。
 * 和牌状态用 -1 表示（语料里的 `Shanten.AGARI_STATE`）。
 * `throws` 非空表示这条断言的是「拒绝非法输入」而非某个数值 —— 向听函数被 AI 高频调用，
 * 喂进 14 张以上或 3n 张牌时必须立刻炸掉，而不是返回一个看着像数字的垃圾值。
 * `sameAs` 非空表示这条断言的是「两次调用结果相等」（开/关国士路径不应影响结论）。
 */
export interface ShantenCase {
  readonly source: string;
  readonly notation: string;
  readonly mode: "any" | "regular" | "chiitoitsu" | "kokushi";
  readonly counts: readonly number[];
  readonly useKokushi: boolean | null;
  readonly expected: number | null;
  readonly sameAs: { readonly useKokushi: boolean } | null;
  readonly throws: string | null;
}

export const SHANTEN_CASES: readonly ShantenCase[] = [
  {
    source: "tests_shanten.py::test_calculate_shanten",
    notation: "8m1367p4566677s12z",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 3, 2, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten",
    notation: "3678m3356p14s2567z",
    mode: "any",
    counts: [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 2, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1],
    useKokushi: null,
    expected: 4,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten",
    notation: "1111222235555m1z",
    mode: "any",
    counts: [4, 4, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_raises_error_too_many_tiles",
    notation: "1111m1111p1111s111z",
    mode: "any",
    counts: [4, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Too many tiles = 15"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "567m11p111234567s",
    mode: "regular",
    counts: [0, 0, 0, 0, 1, 1, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: -1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "567m11p111345677s",
    mode: "regular",
    counts: [0, 0, 0, 0, 1, 1, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "567m15p111345677s",
    mode: "regular",
    counts: [0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "1578m15p11134567s",
    mode: "regular",
    counts: [1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "1358m1358p113456s",
    mode: "regular",
    counts: [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 2, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 3,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "1358m13588p1589s1z",
    mode: "regular",
    counts: [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 2, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 4,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "1358m13588p159s12z",
    mode: "regular",
    counts: [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 2, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 5,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "1358m258p1589s123z",
    mode: "regular",
    counts: [1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
    useKokushi: null,
    expected: 6,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "11123456788999s",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: -1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "11122245679999s",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 1, 1, 1, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "359m17p159s123567z",
    mode: "regular",
    counts: [0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1],
    useKokushi: null,
    expected: 7,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "11112222333444z",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 3, 3, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "11m111122223333z",
    mode: "regular",
    counts: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "23m111122223333z",
    mode: "regular",
    counts: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "333444555m1111s",
    mode: "regular",
    counts: [0, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand",
    notation: "11p111234567s77z",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "567m1p111345677s",
    mode: "regular",
    counts: [0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "56m111345677s",
    mode: "regular",
    counts: [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "123456789m1111z",
    mode: "regular",
    counts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "1111m123p112233s",
    mode: "regular",
    counts: [4, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "1111222333444z",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 3, 3, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "11m11112222333z",
    mode: "regular",
    counts: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 3, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "23m11112222333z",
    mode: "regular",
    counts: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 3, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_for_not_completed_hand",
    notation: "1111222233334z",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 1, 0, 0, 0],
    useKokushi: null,
    expected: 3,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "77m114477p114477s",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: -1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m114477p114477s",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m114479p114477s",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 0, 0, 2, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m14479p114477s1z",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m13479p114477s1z",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 3,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m13479p114467s1z",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 4,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m13479p113467s1z",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 2, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 5,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "67m13479p123467s1z",
    mode: "chiitoitsu",
    counts: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 6,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_chiitoitsu_hand",
    notation: "2255m55p66677888s",
    mode: "chiitoitsu",
    counts: [0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "19m19p19s12345677z",
    mode: "kokushi",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2],
    useKokushi: null,
    expected: -1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "19m19p129s1234567z",
    mode: "kokushi",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "19m129p129s123456z",
    mode: "kokushi",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
    useKokushi: null,
    expected: 1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "129m129p129s12345z",
    mode: "kokushi",
    counts: [1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
    useKokushi: null,
    expected: 2,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "129m129p1239s2345z",
    mode: "kokushi",
    counts: [1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0],
    useKokushi: null,
    expected: 3,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "129m1239p1239s345z",
    mode: "kokushi",
    counts: [1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0],
    useKokushi: null,
    expected: 4,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "1239m1239p1239s45z",
    mode: "kokushi",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0],
    useKokushi: null,
    expected: 5,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "1239m1239p12349s5z",
    mode: "kokushi",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    useKokushi: null,
    expected: 6,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_kokushi_hand",
    notation: "1239m12349p12349s",
    mode: "kokushi",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 7,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_with_open_sets",
    notation: "222567p44467778s",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 3, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: -1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_with_open_sets",
    notation: "222567p44468s",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 3, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_with_open_sets",
    notation: "222567p68s",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_with_open_sets",
    notation: "567p68s",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_with_open_sets",
    notation: "68s",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: 0,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_with_open_sets",
    notation: "88s",
    mode: "any",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: -1,
    sameAs: null,
    throws: null
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_raises_error_for_3n_tile_count",
    notation: "-",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Invalid tile count"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_raises_error_for_3n_tile_count",
    notation: "123s",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Invalid tile count"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_raises_error_for_3n_tile_count",
    notation: "123m111s",
    mode: "regular",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Invalid tile count"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_raises_error_for_3n_tile_count",
    notation: "123p111345s",
    mode: "regular",
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Invalid tile count"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_for_regular_hand_raises_error_for_3n_tile_count",
    notation: "567m111345677s",
    mode: "regular",
    counts: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Invalid tile count"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_raises_error_for_3n_tile_count",
    notation: "123m",
    mode: "any",
    counts: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    useKokushi: null,
    expected: null,
    sameAs: null,
    throws: "Invalid tile count"
  },
  {
    source: "tests_shanten.py::test_calculate_shanten_kokushi_should_be_ignored_when_melds_exist",
    notation: "19m19p19s12345z",
    mode: "any",
    counts: [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
    useKokushi: true,
    expected: null,
    sameAs: {
      useKokushi: false
    },
    throws: null
  },
];
