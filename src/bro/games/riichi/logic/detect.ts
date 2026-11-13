/**
 * 立直麻将：单个役的判定。
 *
 * 判定全部写成「给定**一种拆法**，这个役成立吗」。役与拆法绑定不是实现选择而是
 * 规则本身：`11122233388899m` 拆成三个刻子是三暗刻，拆成三副 123 是一杯口，
 * 同一手牌两个答案都对，谁算数由番数决定。所以本模块不做取舍，只回答单点问题，
 * 取高留给 `hand.ts`。
 *
 * 与之相对，混一色 / 清一色 / 字一色 / 九莲这些只看牌的**集合**，怎么拆都一样。
 * 它们照样走这个接口，代价只是多传一个用不上的 division —— 换来的是上层不必知道
 * 哪些役依赖拆法、哪些不依赖。
 */

import { isAgari, isChiitoitsu, isKokushi } from "./agari";
import {
  DRAGONS,
  HAKU,
  HATSU,
  TILE_KINDS,
  WINDS,
  isHonor,
  isTerminal,
  isTerminalOrHonor,
  rankOf,
  suitOf,
  toTile34,
} from "./tiles";
import type { Tile136, Tile34, TileCounts } from "./tiles";
import type { Division, Meld, TileGroup, YakuId } from "./types";

export interface DetectInput {
  readonly division: Division;
  readonly counts: TileCounts;
  readonly melds: readonly Meld[];
  readonly winTile: Tile136 | null;
  /**
   * 和了牌算在哪个面子里。省略表示「不指定听法」，此时依赖听法的役（平和、暗刻类）
   * 按**存在某种听法成立**来判 —— 语料的单役用例就是这个语义。
   * 整手估值会显式传入，因为同一手牌的不同听法番数不同（见 hand.ts）。
   */
  readonly winGroup?: TileGroup;
  readonly isTsumo: boolean;
  readonly playerWind: Tile34 | null;
  readonly roundWind: Tile34 | null;
  readonly isClosed: boolean;
}

function isRun(group: TileGroup): boolean {
  return group.length === 3 && group[0] !== group[1];
}

function isTripletGroup(group: TileGroup): boolean {
  return group.length >= 3 && group[0] === group[1];
}

function sets(division: Division): readonly TileGroup[] {
  return division.filter((g) => g.length >= 3);
}

function pairOf(division: Division): TileGroup | null {
  return division.find((g) => g.length === 2) ?? null;
}

function runs(division: Division): readonly TileGroup[] {
  return division.filter(isRun);
}

function triplets(division: Division): readonly TileGroup[] {
  return division.filter(isTripletGroup);
}

/** 手上实际有的花色区号集合（0 万 / 1 饼 / 2 索 / 3 字）。 */
function suitsPresent(counts: TileCounts): Set<number> {
  const found = new Set<number>();
  for (let i = 0; i < TILE_KINDS; i += 1) {
    if (counts[i] > 0) {
      found.add(suitOf(i));
    }
  }
  return found;
}

/** 一手牌里有几副与给定顺子完全相同的顺子。 */
function countIdenticalRuns(division: Division): number[] {
  const seen = new Map<number, number>();
  for (const g of runs(division)) {
    seen.set(g[0], (seen.get(g[0]) ?? 0) + 1);
  }
  return [...seen.values()];
}

/** 找出这一组对应的副露。按牌值找，因为语料里杠的副露只带 3 张牌。 */
function meldOfGroup(group: TileGroup, melds: readonly Meld[]): Meld | null {
  for (const meld of melds) {
    if (meld.tiles.length > 0 && toTile34(meld.tiles[0]) === group[0]) {
      return meld;
    }
  }
  return null;
}

/**
 * 这一组是不是**暗**刻。
 *
 * 两条各自独立的否定：副露的碰/明杠不是暗刻；荣和补上的那一组也不是 ——
 * 那张牌是别人打出来的，手里原本只有两张。第二条最容易漏，漏了会让一手三暗刻
 * 被算成四暗刻（役满），这是最贵的一种算错。
 *
 * 但第二条只在和了牌**别无去处**时才生效。`444789999p22333z` 荣和 9 饼：这张 9 饼
 * 可以看作补上 789p 的顺子，999p 就还是完完整整摸齐的暗刻 —— 语料确认这手是三暗刻。
 * 判断「别无去处」时必须把副露组排除在外：副露是早先鸣的牌，不可能由这一张和了牌
 * 补齐。语料的 `222456666777p77z`（吃了 456p 后荣和 6 饼）就是拿这条来打的 ——
 * 把 456p 也算成一个去处的话，666p 会被当成暗刻，一手二暗刻被报成三暗刻。
 *
 * 例外：暗杠是暗刻。`opened === false` 已经把它包含进来了。
 */
function isConcealedTriplet(
  group: TileGroup,
  division: Division,
  melds: readonly Meld[],
  winTile: Tile136 | null,
  winGroup: TileGroup | undefined,
  isTsumo: boolean,
): boolean {
  if (!isTripletGroup(group)) {
    return false;
  }
  const own = meldOfGroup(group, melds);
  if (own !== null && own.opened) {
    return false;
  }
  if (isTsumo || winTile === null) {
    return true;
  }
  const win = toTile34(winTile);
  if (!group.includes(win)) {
    return true;
  }
  if (winGroup !== undefined) {
    // 听法已定：和了牌只能落在 winGroup 上，别的组照旧是暗刻。
    return winGroup !== group;
  }
  // 听法未定：和了牌还有别的落点吗？有就可以判给别处，本组仍算暗刻。
  const alternatives = division.filter(
    (g) => g !== group && g.includes(win) && meldOfGroup(g, melds) === null,
  );
  return alternatives.length > 0;
}

/** 役牌张：三元牌恒是，风牌只在与自风或场风相符时是。 */
function valuedTilesOf(
  playerWind: Tile34 | null,
  roundWind: Tile34 | null,
): Set<Tile34> {
  const valued = new Set<Tile34>(DRAGONS);
  if (playerWind !== null) {
    valued.add(playerWind);
  }
  if (roundWind !== null) {
    valued.add(roundWind);
  }
  return valued;
}

/** 三色（同顺/同刻）：三门花色里各有一组起点数字相同的组。 */
function isThreeSuits(groups: readonly TileGroup[]): boolean {
  for (const g of groups) {
    if (isHonor(g[0])) {
      continue;
    }
    const rank = rankOf(g[0]);
    const suits = new Set<number>();
    for (const other of groups) {
      if (!isHonor(other[0]) && rankOf(other[0]) === rank) {
        suits.add(suitOf(other[0]));
      }
    }
    if (suits.size === 3) {
      return true;
    }
  }
  return false;
}

/** 九莲宝灯的基础型：同花色 1112345678999 加任意一张。 */
function chuurenShape(counts: TileCounts): boolean {
  const suits = suitsPresent(counts);
  if (suits.size !== 1 || suits.has(3)) {
    return false;
  }
  const start = [...suits][0] * 9;
  let extra = 0;
  for (let i = 0; i < 9; i += 1) {
    const need = i === 0 || i === 8 ? 3 : 1;
    const have = counts[start + i];
    if (have < need) {
      return false;
    }
    extra += have - need;
  }
  return extra === 1;
}

/** 绿一色只认这六张：2/3/4/6/8 索与发财。 */
const GREEN_TILES: readonly Tile34[] = [19, 20, 21, 23, 25, HATSU];

/**
 * 判定某个役是否成立。
 *
 * 不认识的 id 返回 false 而不是抛异常：这个函数会被上层拿着整张役表逐个问一遍，
 * 抛异常的话，加一个还没实现的役 id 就会让整条估值链路炸掉。
 */
export function isYakuPresent(id: YakuId, input: DetectInput): boolean {
  const {
    division,
    counts,
    melds,
    winTile,
    winGroup,
    isTsumo,
    playerWind,
    roundWind,
    isClosed,
  } = input;

  switch (id) {
    case "chiitoitsu":
      return division.length === 7 || isChiitoitsu(counts);

    case "kokushi":
      return isKokushi(counts);

    case "daburuKokushi": {
      // 十三面听：和了牌之外的十三张已经各占一种幺九，即和了前就是十三面等待。
      if (!isKokushi(counts) || winTile === null) {
        return false;
      }
      return counts[toTile34(winTile)] === 2;
    }

    case "tanyao": {
      for (let i = 0; i < TILE_KINDS; i += 1) {
        if (counts[i] > 0 && isTerminalOrHonor(i)) {
          return false;
        }
      }
      return true;
    }

    case "iipeiko": {
      if (!isClosed) {
        return false;
      }
      return countIdenticalRuns(division).some((n) => n >= 2);
    }

    case "ryanpeiko": {
      if (!isClosed) {
        return false;
      }
      const groups = countIdenticalRuns(division);
      // 两组各自成对。`1111 2222 3333s` 拆成 123/123/123/123 时是一个 key 出现 4 次，
      // 同样是二杯口 —— 所以按「成对的份数」求和，而不是数有几个 key。
      let pairs = 0;
      for (const n of groups) {
        pairs += Math.floor(n / 2);
      }
      return pairs >= 2;
    }

    case "sanshoku":
      return isThreeSuits(runs(division));

    case "sanshokuDouko":
      return isThreeSuits(triplets(division));

    case "ittsu": {
      for (const suit of [0, 1, 2]) {
        const starts = new Set(
          runs(division)
            .filter((g) => suitOf(g[0]) === suit)
            .map((g) => rankOf(g[0])),
        );
        if (starts.has(0) && starts.has(3) && starts.has(6)) {
          return true;
        }
      }
      return false;
    }

    case "toitoi":
      return (
        sets(division).length === 4 && sets(division).every(isTripletGroup)
      );

    case "sanankou": {
      const concealed = sets(division).filter((g) =>
        isConcealedTriplet(g, division, melds, winTile, winGroup, isTsumo),
      );
      return concealed.length === 3;
    }

    case "suuankou": {
      const concealed = sets(division).filter((g) =>
        isConcealedTriplet(g, division, melds, winTile, winGroup, isTsumo),
      );
      return concealed.length === 4;
    }

    case "suuankouTanki": {
      const concealed = sets(division).filter((g) =>
        isConcealedTriplet(g, division, melds, winTile, winGroup, isTsumo),
      );
      if (concealed.length !== 4 || winTile === null) {
        return false;
      }
      const pair = pairOf(division);
      return pair !== null && pair[0] === toTile34(winTile);
    }

    case "sankantsu":
      return (
        melds.filter((m) => m.type === "kan" || m.type === "shouminkan")
          .length === 3
      );

    case "suukantsu":
      return (
        melds.filter((m) => m.type === "kan" || m.type === "shouminkan")
          .length === 4
      );

    case "chantai": {
      // 混全带幺九**必须**含至少一个顺子，否则那手牌是混老头（更高的役），
      // 两者不并存。语料的 111999m111s22333z 就是反例：全刻子，chantai 不成立。
      if (!runs(division).length) {
        return false;
      }
      let hasHonor = false;
      for (const g of division) {
        if (!g.some(isTerminalOrHonor)) {
          return false;
        }
        if (g.some(isHonor)) {
          hasHonor = true;
        }
      }
      // 一张字牌都没有的话那是纯全带幺九，不算混全。
      return hasHonor;
    }

    case "junchan": {
      if (!runs(division).length) {
        return false;
      }
      for (const g of division) {
        if (g.some(isHonor) || !g.some(isTerminal)) {
          return false;
        }
      }
      return true;
    }

    case "honroto": {
      for (let i = 0; i < TILE_KINDS; i += 1) {
        if (counts[i] > 0 && !isTerminalOrHonor(i)) {
          return false;
        }
      }
      // 全幺九但一张字牌都没有的是清老头（役满），不是混老头。
      for (let i = 0; i < TILE_KINDS; i += 1) {
        if (counts[i] > 0 && isHonor(i)) {
          return true;
        }
      }
      return false;
    }

    case "honitsu": {
      const suits = suitsPresent(counts);
      // 必须有字牌，否则是清一色。
      return suits.has(3) && suits.size === 2;
    }

    case "chinitsu": {
      const suits = suitsPresent(counts);
      return suits.size === 1 && !suits.has(3);
    }

    case "haku":
    case "hatsu":
    case "chun": {
      const tile = id === "haku" ? HAKU : id === "hatsu" ? HATSU : HAKU + 2;
      return triplets(division).some((g) => g[0] === tile);
    }

    case "seatWindEast":
    case "seatWindSouth":
    case "seatWindWest":
    case "seatWindNorth": {
      const index = [
        "seatWindEast",
        "seatWindSouth",
        "seatWindWest",
        "seatWindNorth",
      ].indexOf(id);
      const wind = WINDS[index];
      return (
        playerWind === wind && triplets(division).some((g) => g[0] === wind)
      );
    }

    case "roundWindEast":
    case "roundWindSouth":
    case "roundWindWest":
    case "roundWindNorth": {
      const index = [
        "roundWindEast",
        "roundWindSouth",
        "roundWindWest",
        "roundWindNorth",
      ].indexOf(id);
      const wind = WINDS[index];
      return (
        roundWind === wind && triplets(division).some((g) => g[0] === wind)
      );
    }

    case "shosangen": {
      const dragonTriplets = triplets(division).filter((g) =>
        DRAGONS.includes(g[0]),
      ).length;
      const pair = pairOf(division);
      return dragonTriplets === 2 && pair !== null && DRAGONS.includes(pair[0]);
    }

    case "daisangen":
      return (
        triplets(division).filter((g) => DRAGONS.includes(g[0])).length === 3
      );

    case "shosuushi": {
      const windTriplets = triplets(division).filter((g) =>
        WINDS.includes(g[0]),
      ).length;
      const pair = pairOf(division);
      return windTriplets === 3 && pair !== null && WINDS.includes(pair[0]);
    }

    case "daisuushi":
      return (
        triplets(division).filter((g) => WINDS.includes(g[0])).length === 4
      );

    case "tsuisou": {
      for (let i = 0; i < TILE_KINDS; i += 1) {
        if (counts[i] > 0 && !isHonor(i)) {
          return false;
        }
      }
      // 全字牌的七对子也是字一色，所以这里不要求有面子拆法。
      return true;
    }

    case "chinroto": {
      for (let i = 0; i < TILE_KINDS; i += 1) {
        if (counts[i] > 0 && !isTerminal(i)) {
          return false;
        }
      }
      return true;
    }

    case "ryuisou": {
      for (let i = 0; i < TILE_KINDS; i += 1) {
        if (counts[i] > 0 && !GREEN_TILES.includes(i)) {
          return false;
        }
      }
      return true;
    }

    case "chuurenPoutou":
      // 九莲必须门清（副露就不可能是同一花色的这个型，但显式写出来更清楚），
      // 且是标准和牌型 —— 语料的 12345678999p111z 就是花色不纯的反例。
      return isClosed && chuurenShape(counts) && isAgari(counts);

    case "daburuChuurenPoutou": {
      // 纯正九莲：多出来的那张牌拿掉之后，剩下的正好是 1112345678999，
      // 即和了前是九面听。
      if (
        !isClosed ||
        winTile === null ||
        !chuurenShape(counts) ||
        !isAgari(counts)
      ) {
        return false;
      }
      const rest = [...counts];
      rest[toTile34(winTile)] -= 1;
      const start = suitOf(toTile34(winTile)) * 9;
      for (let i = 0; i < 9; i += 1) {
        const need = i === 0 || i === 8 ? 3 : 1;
        if (rest[start + i] !== need) {
          return false;
        }
      }
      return true;
    }

    case "pinfu": {
      // 平和：门清、四顺子、雀头非役牌、两面听。
      if (!isClosed || runs(division).length !== 4) {
        return false;
      }
      const pair = pairOf(division);
      if (pair === null || valuedTilesOf(playerWind, roundWind).has(pair[0])) {
        return false;
      }
      if (winTile === null) {
        return false;
      }
      const win = toTile34(winTile);
      // 两面：和了牌落在某个顺子的两端，且该端不是边张（123 和 3 / 789 和 7）。
      const isRyanmen = (g: TileGroup): boolean => {
        if (g[0] === win) {
          return rankOf(g[0]) !== 6;
        }
        if (g[2] === win) {
          return rankOf(g[0]) !== 0;
        }
        return false;
      };
      /**
       * 听法已定时**只**看和了牌实际落进的那一组。
       *
       * 扫全部顺子是个隐蔽的错：`678m88p123345678s` 荣和 3 索，看成单骑 88p 是
       * 40 符、看成 345s 两面是 30 符。单骑那一支里 345s 依然摆在手上，扫全部顺子
       * 就会把它当成两面听、给单骑听也判上平和 —— 于是「1 番 40 符」凭空出现并在
       * 取高时压过正确的「1 番 30 符」（语料 test_hands_calculation 第 5、3 例）。
       */
      if (winGroup !== undefined) {
        return isRun(winGroup) && isRyanmen(winGroup);
      }
      return runs(division).some(isRyanmen);
    }

    default:
      return false;
  }
}
