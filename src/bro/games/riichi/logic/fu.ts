/**
 * 立直麻将：符计算。
 *
 * 符是日麻里最琐碎的一块，也是最容易被「差不多就行」糊过去的一块：少算 2 符会让
 * 30 符变 40 符，点数差三分之一，但玩家当场看不出来。所以这里输出的不只是总符数，
 * 还有**每一符的来源**（`FuDetail`）——「多算 2 符 + 少算 2 符」在总数上会互相抵消，
 * 只对总数就永远发现不了。UI 也靠这个把 40 符是怎么来的摊开给玩家看。
 *
 * 和了牌落在哪个面子里（`winGroup`）必须由调用方给定，不能由本模块自己挑。
 * 语料的 `test_fu_based_on_win_group` 就是拿这个来打的：234789m1234566p 和 6p，
 * 看成 456p 两面是 30 符，看成 66p 单骑是 40 符 —— 同一手牌、同一张和了牌，
 * 听法不同符数不同。自己挑一个的话，就等于替玩家决定了他听的是什么，而这个决定
 * 直接改点数。
 */

import { isTerminalOrHonor, rankOf, toTile34 } from "./tiles";
import type { Tile136, Tile34 } from "./tiles";
import type {
  Division,
  FuDetail,
  FuReason,
  Meld,
  TileGroup,
  WinContext,
} from "./types";

export interface FuInput {
  readonly division: Division;
  readonly winTile: Tile136;
  /** 和了牌算在哪个面子里。见文件头注释：这是入参，不是本模块能自己决定的事。 */
  readonly winGroup: TileGroup;
  readonly melds: readonly Meld[];
  /** 役牌张（34 编号）。同一张出现两次 = 自风与场风重合，雀头记 4 符。 */
  readonly valuedTiles: readonly Tile34[];
  readonly context: WinContext;
}

export interface FuResult {
  /** 进位到十位后的符数。25 符（七对子）不进位。 */
  readonly fu: number;
  readonly details: readonly FuDetail[];
}

/** 副底。门清荣和另加 10 符（门前加符），所以门清荣和是 30，其余 20。 */
const BASE_FU = 20;
const MENZEN_RON_BONUS = 10;
/** 七对子固定 25 符，不按面子累加 —— 它根本没有面子。 */
const CHIITOITSU_FU = 25;
const CHIITOITSU_GROUPS = 7;

/** 刻子/杠的符数表：[暗, 明]。 */
const PON_FU = { simple: [4, 2], terminal: [8, 4] } as const;
const KAN_FU = { simple: [16, 8], terminal: [32, 16] } as const;

function sameGroup(a: TileGroup, b: TileGroup): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function isTriplet(group: TileGroup): boolean {
  return group.length >= 3 && group.every((t) => t === group[0]);
}

/**
 * 找出这个面子对应的副露。
 *
 * 按**牌**找而不是按长度找：语料里杠的副露只带 3 张牌（`_make_meld(Meld.KAN, sou="222")`），
 * 拆法里对应的组也是 3 张。按长度判「4 张才是杠」的话，所有杠符都会被算成刻子符 ——
 * 暗杠 16 符会掉成 4 符。
 */
function meldOf(group: TileGroup, melds: readonly Meld[]): Meld | null {
  if (!isTriplet(group)) {
    return null;
  }
  for (const meld of melds) {
    if (meld.tiles.length > 0 && toTile34(meld.tiles[0]) === group[0]) {
      return meld;
    }
  }
  return null;
}

/** 听型的符：边张/嵌张/单骑各 2 符，两面与双碰 0 符。 */
function waitFu(winGroup: TileGroup, winTile: Tile136): FuReason | null {
  const tile = toTile34(winTile);
  if (winGroup.length === 2) {
    return "pairWait";
  }
  if (isTriplet(winGroup)) {
    // 双碰听。这一组的符由「荣和视作明刻」那条规则处理，听型本身不另加符。
    return null;
  }
  const rank = rankOf(winGroup[0]);
  const winRank = rankOf(tile);
  if (winRank === rank + 1) {
    return "kanchan";
  }
  // 123 里和 3（由 12 听）与 789 里和 7（由 89 听）是边张；
  // 123 里和 1 是由 23 两面听来的，不是边张。
  if (rank === 0 && winRank === 2) {
    return "penchan";
  }
  if (rank === 6 && winRank === 6) {
    return "penchan";
  }
  return null;
}

export function calculateFu(input: FuInput): FuResult {
  const { division, winTile, winGroup, melds, valuedTiles, context } = input;

  if (division.length === CHIITOITSU_GROUPS) {
    return {
      fu: CHIITOITSU_FU,
      details: [{ fu: CHIITOITSU_FU, reason: "base" }],
    };
  }

  // 暗杠不算明露，所以这里看的是 `opened` 而不是「有没有副露」。
  // 写成 melds.length > 0 的话，暗杠会让副底从 30 掉到 20，还会连带吃掉平和。
  const isOpen = melds.some((m) => m.opened);
  const details: FuDetail[] = [];

  for (const group of division) {
    if (group.length === 2) {
      let valued = 0;
      for (const t of valuedTiles) {
        if (t === group[0]) {
          valued += 1;
        }
      }
      if (valued >= 2) {
        details.push({ fu: 4, reason: "doubleValuedPair" });
      } else if (valued === 1) {
        details.push({ fu: 2, reason: "valuedPair" });
      }
      continue;
    }
    if (!isTriplet(group)) {
      continue;
    }

    const meld = meldOf(group, melds);
    const terminal = isTerminalOrHonor(group[0]) ? "terminal" : "simple";
    if (meld !== null && (meld.type === "kan" || meld.type === "shouminkan")) {
      // 加杠符数与明杠相同 —— 它们的差别只在能不能被抢杠，那是役的事。
      const openIndex = meld.opened ? 1 : 0;
      details.push({
        fu: KAN_FU[terminal][openIndex],
        reason:
          terminal === "terminal"
            ? meld.opened
              ? "openTerminalKan"
              : "closedTerminalKan"
            : meld.opened
              ? "openKan"
              : "closedKan",
      });
      continue;
    }

    // 荣和碰到的那一组算**明刻**：那张牌是别人打出来的，手里原本只有两张。
    // 不区分的话，双碰荣和会白拿一倍符（暗刻 4 符 vs 明刻 2 符）。
    const openedByRon = !context.isTsumo && sameGroup(group, winGroup);
    const opened = (meld !== null && meld.opened) || openedByRon;
    const openIndex = opened ? 1 : 0;
    details.push({
      fu: PON_FU[terminal][openIndex],
      reason:
        terminal === "terminal"
          ? opened
            ? "openTerminalPon"
            : "closedTerminalPon"
          : opened
            ? "openPon"
            : "closedPon",
    });
  }

  const wait = waitFu(winGroup, winTile);
  if (wait !== null) {
    details.push({ fu: 2, reason: wait });
  }

  /**
   * 平和自摸不加自摸符。
   *
   * 「是不是平和」在这里不必单独判：门清且**一符不带**，就正好是平和的定义
   * （四顺子、非役牌雀头、两面听 —— 任何一条不满足都会在上面产生一条符）。
   * 所以复用已经算出来的 details，而不是再写一遍平和判定 —— 两处判定迟早会分家。
   */
  const isPinfuShape = !isOpen && details.length === 0;
  if (context.isTsumo && !isPinfuShape) {
    details.push({ fu: 2, reason: "tsumo" });
  }

  /**
   * 副露平和形（俗称「食い平和」）补 2 符。
   *
   * 副底 20 符荣和会得到 20 符，但日麻没有 20 符荣和这一档 —— 20 符只在门清平和
   * 自摸时出现。多数规则（含语料默认与本项目 §2.2 未另行规定的部分）补 2 符凑成
   * 30 符。这是本项目取的口径，规则书里没写死。
   */
  if (isOpen && details.length === 0) {
    details.push({ fu: 2, reason: "handWithoutFu" });
  }

  const base =
    !isOpen && !context.isTsumo ? BASE_FU + MENZEN_RON_BONUS : BASE_FU;
  details.unshift({ fu: base, reason: "base" });

  let total = 0;
  for (const d of details) {
    total += d.fu;
  }
  return { fu: Math.ceil(total / 10) * 10, details };
}
