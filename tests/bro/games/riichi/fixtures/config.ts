// 本文件由脚本从语料自动生成，请勿手工编辑。
//
// 用例数据来自 MahjongRepository/mahjong（Python 实现），MIT License。
//   Copyright (c) 2017 mahjong Python library contributors
//   仓库：https://github.com/MahjongRepository/mahjong
//   LICENSE：https://github.com/MahjongRepository/mahjong/blob/master/LICENSE.txt
//
// 本仓库仅移植其**用例数据**（牌型与期望结果），未复制其 Python 实现。
// MIT 许可要求保留上述版权声明，这段注释是许可条款的一部分，不要删。


export interface FixtureConfig {
  readonly isTsumo: boolean;
  readonly isRiichi: boolean;
  readonly isIppatsu: boolean;
  readonly isRinshan: boolean;
  readonly isChankan: boolean;
  readonly isHaitei: boolean;
  readonly isHoutei: boolean;
  readonly isDaburuRiichi: boolean;
  readonly isNagashiMangan: boolean;
  readonly isTenhou: boolean;
  readonly isRenhou: boolean;
  readonly isChiihou: boolean;
  readonly playerWind: number | null;
  readonly roundWind: number | null;
  readonly hasOpenTanyao: boolean;
  readonly hasAkaDora: boolean;
  readonly hasDoubleYakuman: boolean;
  readonly honba: number;
  readonly riichiSticks: number;
}

/**
 * 用例里的副露。
 *
 * 注意 `tiles` 对杠可能只有 3 张 —— 语料就是这么写的
 * （`_make_meld(Meld.KAN, sou="222", is_open=False)`），这样整手仍是 14 张。
 * 符数只看 `type` 与 `opened`，张数不参与，所以这个写法在语料里是无害的；
 * 但我们这边任何「按 tiles.length 判断是不是杠」的实现都会被这几条用例抓出来。
 */
export interface FixtureMeld {
  readonly type: "chi" | "pon" | "kan" | "shouminkan";
  readonly opened: boolean;
  readonly tiles: readonly number[];
  readonly notation: string;
}
