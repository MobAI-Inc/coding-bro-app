/**
 * 用例夹具 -> 逻辑层入参的转换。
 *
 * 单独一个文件，是为了让「语料怎么描述一手牌」和「我们的接口怎么描述一手牌」
 * 之间的落差集中在一处、且只写一遍。分散在各测试文件里的话，某个测试悄悄改了
 * 转换方式就没人发现 —— 而那等于偷偷换掉了用例的语义。
 */

import type { FixtureConfig, FixtureMeld } from "./fixtures/config";
import { DEFAULT_RULES } from "@/bro/games/riichi/logic";
import type { Meld, WinContext } from "@/bro/games/riichi/logic";

export function toMelds(melds: readonly FixtureMeld[]): readonly Meld[] {
  return melds.map((m) => ({ type: m.type, opened: m.opened, tiles: m.tiles }));
}

/**
 * 夹具配置 -> WinContext。
 *
 * 注意 `rules` 取的是夹具里的值而**不是** DEFAULT_RULES：语料的默认口径是
 * 食断关闭、无赤宝牌，与本项目（§2.2）相反。用我们的口径去跑语料用例，会得出
 * 与语料不同的番数，然后看起来像是实现写错了。夹具已把完整口径展开落盘，
 * 这里照搬即可。
 */
export function toContext(config: FixtureConfig): WinContext {
  return {
    isTsumo: config.isTsumo,
    isRiichi: config.isRiichi,
    isIppatsu: config.isIppatsu,
    isDaburuRiichi: config.isDaburuRiichi,
    isRinshan: config.isRinshan,
    isChankan: config.isChankan,
    isHaitei: config.isHaitei,
    isHoutei: config.isHoutei,
    isNagashiMangan: config.isNagashiMangan,
    isTenhou: config.isTenhou,
    isChiihou: config.isChiihou,
    isRenhou: config.isRenhou,
    playerWind: config.playerWind,
    roundWind: config.roundWind,
    honba: config.honba,
    riichiSticks: config.riichiSticks,
    rules: {
      ...DEFAULT_RULES,
      hasOpenTanyao: config.hasOpenTanyao,
      hasAkaDora: config.hasAkaDora,
      hasDoubleYakuman: config.hasDoubleYakuman,
    },
  };
}
