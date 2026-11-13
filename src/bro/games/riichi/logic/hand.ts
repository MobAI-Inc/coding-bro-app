/**
 * 立直麻将：整手估值。
 *
 * 一次和了的完整链路：拆解 -> 逐拆法算役 -> 算符 -> 番 -> 点数，然后在所有
 * (拆法 × 听法) 组合里**取最高**。
 *
 * 取高不是可选的优化而是规则：同一手牌可能既能看成三暗刻又能看成一杯口，
 * 日麻规定按对和了者最有利的那种算。挑第一个算得通的拆法会让玩家系统性地少拿番，
 * 而且这种少拿不会报错 —— 只会安静地少给点，比崩溃难发现得多。
 *
 * 比较口径（语料 `test_incorrect_fu_calculation_test_case_1` 钉死的）：
 * 先比番，番同比进位后的符，再同比进位前的符。最后一条是必要的：4 番 30 符与
 * 4 番 40 符都封顶满贯，番与进位符看着一样，但 32 符与 40 符的差别要在这里分出来。
 */

import { divideHand } from "./divide";
import { calculateFu } from "./fu";
import { isYakuPresent } from "./detect";
import { calculateScores } from "./score";
import { countDora } from "./dora";
import { YAKU } from "./yaku";
import { DRAGONS, countsOf, toTile34 } from "./tiles";
import type { Tile34 } from "./tiles";
import type {
  Division,
  FuDetail,
  HandInput,
  HandResult,
  ScoredYaku,
  TileGroup,
  WinContext,
} from "./types";

/** 累计役满的门槛。 */
const KAZOE_HAN = 13;

/**
 * 由对局状态直接决定、与牌型无关的役。
 *
 * 单列出来是因为它们不需要拆法：立直是宣告过的事实，海底是牌山的位置。
 * 混进按拆法判定的那批里，会让每个拆法都重复判一遍同样的条件。
 */
function stateYaku(context: WinContext, isClosed: boolean): ScoredYaku[] {
  const found: ScoredYaku[] = [];
  const add = (id: string): void => {
    const def = YAKU[id];
    found.push({
      id,
      han: isClosed ? def.han : def.hanOpen,
      yakumanMultiplier: 0,
    });
  };

  // 两立直与立直不叠加：宣告过两立直就不再另计立直。
  if (context.isDaburuRiichi) {
    add("daburuRiichi");
  } else if (context.isRiichi) {
    add("riichi");
  }
  if (context.isIppatsu) {
    add("ippatsu");
  }
  // 门前清自摸和顾名思义要门清。副露自摸没有这个役。
  if (context.isTsumo && isClosed) {
    add("menzenTsumo");
  }
  if (context.isHaitei) {
    add("haitei");
  }
  if (context.isHoutei) {
    add("houtei");
  }
  if (context.isRinshan) {
    add("rinshan");
  }
  if (context.isChankan) {
    add("chankan");
  }
  if (context.isRenhou) {
    add("renhou");
  }
  return found;
}

/** 天和/地和是役满，与状态役分开算。 */
function stateYakuman(context: WinContext): ScoredYaku[] {
  const found: ScoredYaku[] = [];
  if (context.isTenhou) {
    found.push({ id: "tenhou", han: 0, yakumanMultiplier: 1 });
  }
  if (context.isChiihou) {
    found.push({ id: "chiihou", han: 0, yakumanMultiplier: 1 });
  }
  return found;
}

/** 按拆法判定的役，按检查顺序排列。 */
const SHAPE_YAKUMAN: readonly string[] = [
  "kokushi",
  "daburuKokushi",
  "suuankou",
  "suuankouTanki",
  "daisangen",
  "shosuushi",
  "daisuushi",
  "tsuisou",
  "chinroto",
  "ryuisou",
  "chuurenPoutou",
  "daburuChuurenPoutou",
  "suukantsu",
];

const SHAPE_YAKU: readonly string[] = [
  "pinfu",
  "tanyao",
  "iipeiko",
  "haku",
  "hatsu",
  "chun",
  "seatWindEast",
  "seatWindSouth",
  "seatWindWest",
  "seatWindNorth",
  "roundWindEast",
  "roundWindSouth",
  "roundWindWest",
  "roundWindNorth",
  "chiitoitsu",
  "chantai",
  "sanshoku",
  "ittsu",
  "toitoi",
  "sanankou",
  "sanshokuDouko",
  "sankantsu",
  "honroto",
  "shosangen",
  "honitsu",
  "junchan",
  "ryanpeiko",
  "chinitsu",
];

/**
 * 互斥与上位覆盖关系：key 成立时，value 里的役不再计。
 *
 * 这不是「去重」而是规则本身 —— 二杯口成立时不再另计一杯口，清一色不再另计混一色。
 * 不处理的话，一手二杯口会被算成 3 + 1 = 4 番。
 */
const SUPERSEDES: Readonly<Record<string, readonly string[]>> = {
  ryanpeiko: ["iipeiko", "chiitoitsu"],
  chinitsu: ["honitsu"],
  junchan: ["chantai"],
  honroto: ["chantai"],
  daburuKokushi: ["kokushi"],
  suuankouTanki: ["suuankou"],
  daburuChuurenPoutou: ["chuurenPoutou"],
  // 对对和与混老头并存（语料 test_is_honroto 明确要求 2 个役），所以这里不排除 toitoi。
  suuankou: ["toitoi", "sanankou"],
  // 大四喜**不**吃掉字一色：`11122233344455z` 天和自摸是天和 + 字一色 + 大四喜 +
  // 四暗刻单骑 = 6 倍役满 78 番（语料 test_sextuple_yakuman）。把字一色并进去会算成 5 倍。
  daisuushi: ["shosuushi", "toitoi", "honroto", "sanankou"],
  shosuushi: ["toitoi", "honroto", "sanankou"],
  daisangen: ["shosangen", "toitoi", "sanankou"],
  tsuisou: [
    "toitoi",
    "honroto",
    "sanankou",
    "chiitoitsu",
    "honitsu",
    "shosangen",
    "daisangen",
  ],
  chinroto: ["toitoi", "honroto", "junchan", "chantai", "sanankou"],
  ryuisou: ["toitoi", "honitsu", "sanankou", "tanyao"],
  suukantsu: ["sankantsu", "toitoi", "sanankou"],
  chuurenPoutou: [
    "chinitsu",
    "pinfu",
    "iipeiko",
    "ryanpeiko",
    "junchan",
    "chantai",
  ],
  kokushi: ["honroto", "chantai", "junchan", "chiitoitsu"],
};

function applySupersedes(found: ScoredYaku[]): ScoredYaku[] {
  const present = new Set(found.map((f) => f.id));
  const removed = new Set<string>();
  for (const id of present) {
    for (const loser of SUPERSEDES[id] ?? []) {
      removed.add(loser);
    }
  }
  return found.filter((f) => !removed.has(f.id));
}

/**
 * 关掉双役满时，这些役**换成**它的单役满本体，而不是留在原地降倍数。
 *
 * 语料 `test_disabled_double_yakuman` 断言此时 `len(result.yaku) == 1` 且报的是
 * 国士無双 / 四暗刻 / 九蓮宝燈 —— 不是「国士十三面，只算 13 番」。这条区别看着像
 * 文案问题，其实是规则口径：不承认双役满的规则里，十三面听这个**加成**根本不存在，
 * 所以也不该在结算画面上出现。
 *
 * 大四喜不在表里：它没有单役满本体，关掉双役满后仍是大四喜，只是按 1 倍算
 * （同一个用例的第四段断言 13 番 1 个役）。
 */
const DOUBLE_FALLBACK: Readonly<Record<string, string>> = {
  daburuKokushi: "kokushi",
  suuankouTanki: "suuankou",
  daburuChuurenPoutou: "chuurenPoutou",
};

/** 役牌张：三元牌恒是，自风与场风相符时各算一份（重合则两份 -> 雀头 4 符）。 */
function valuedTilesFor(context: WinContext): Tile34[] {
  const valued: Tile34[] = [...DRAGONS];
  if (context.playerWind !== null) {
    valued.push(context.playerWind);
  }
  if (context.roundWind !== null) {
    valued.push(context.roundWind);
  }
  return valued;
}

interface Candidate {
  readonly han: number;
  readonly fu: number;
  readonly rawFu: number;
  readonly yaku: readonly ScoredYaku[];
  readonly fuDetails: readonly FuDetail[];
  readonly isYakuman: boolean;
}

/** 番高优先，其次进位符，最后未进位符 —— 语料钉死的口径，见文件头注释。 */
function better(a: Candidate, b: Candidate | null): boolean {
  if (b === null) {
    return true;
  }
  if (a.han !== b.han) {
    return a.han > b.han;
  }
  if (a.fu !== b.fu) {
    return a.fu > b.fu;
  }
  return a.rawFu > b.rawFu;
}

export function estimateHandValue(input: HandInput): HandResult {
  const { tiles, winTile, melds, doraIndicators, uraDoraIndicators, context } =
    input;

  const fail = (error: HandResult["error"]): HandResult => ({
    error,
    han: 0,
    fu: 0,
    yaku: [],
    fuDetails: [],
    cost: null,
  });

  /**
   * 流局满贯先行返回：它压根不是和牌，没有和了牌、没有拆法、没有符。
   * 混进正常链路的话，第一步拆解就会失败并报「非和牌」。
   */
  if (context.isNagashiMangan) {
    const yaku: ScoredYaku[] = [
      { id: "nagashiMangan", han: 5, yakumanMultiplier: 0 },
    ];
    return {
      error: null,
      han: 5,
      fu: 30,
      yaku,
      fuDetails: [],
      cost: calculateScores(5, 30, context, false),
    };
  }

  if (winTile === null) {
    return fail("ERR_INVALID_INPUT");
  }

  const counts = countsOf(tiles);
  const meldGroups = melds.map((m) => m.tiles.map(toTile34));
  const divisions = divideHand(counts, meldGroups);
  if (divisions.length === 0) {
    return fail("ERR_HAND_NOT_WINNING");
  }

  // 暗杠不破门清。这里看的是有没有**明露**的副露，不是有没有副露。
  const isClosed = melds.every((m) => !m.opened);
  const dora = countDora(
    tiles,
    doraIndicators,
    uraDoraIndicators,
    context.rules.hasAkaDora,
    context.isRiichi || context.isDaburuRiichi,
  );
  const valuedTiles = valuedTilesFor(context);
  const win34 = toTile34(winTile);

  let best: Candidate | null = null;

  for (const division of divisions) {
    /**
     * 和了牌可能落在多个面子里（例如既能补顺子又能补刻子），每种听法的符与役都不同，
     * 所以逐个试。语料 test_fu_based_on_win_group 证明这不是理论问题。
     *
     * 但**副露那几个面子要排除掉**：副露是早些巡目就鸣下来摆在桌上的，和了牌不可能
     * 落进去。`divideHand` 保证副露排在拆法最前面，所以按下标切。不排除的话，
     * `122223777888m66z`（吃了 123m）荣和 2 万会被当成 123m 的嵌张听多拿 2 符，
     * 30 符变 40 符 —— 而且因为取高，这个多出来的听法还会压过正确答案
     * （语料 test_hands_calculation 第 10、11 例）。
     */
    const winGroups = division.filter(
      (g, i) => i >= melds.length && g.includes(win34),
    );
    if (winGroups.length === 0) {
      continue;
    }
    for (const winGroup of winGroups) {
      const candidate = evaluate({
        division,
        winGroup,
        counts,
        melds,
        winTile,
        context,
        isClosed,
        valuedTiles,
        dora,
      });
      if (candidate !== null && better(candidate, best)) {
        best = candidate;
      }
    }
  }

  if (best === null) {
    return fail("ERR_NO_YAKU");
  }

  return {
    error: null,
    han: best.han,
    fu: best.fu,
    yaku: best.yaku,
    fuDetails: best.fuDetails,
    cost: calculateScores(best.han, best.fu, context, best.isYakuman),
  };
}

interface EvaluateInput {
  readonly division: Division;
  readonly winGroup: TileGroup;
  readonly counts: readonly number[];
  readonly melds: HandInput["melds"];
  readonly winTile: number;
  readonly context: WinContext;
  readonly isClosed: boolean;
  readonly valuedTiles: readonly Tile34[];
  readonly dora: {
    readonly dora: number;
    readonly akaDora: number;
    readonly uraDora: number;
  };
}

function evaluate(input: EvaluateInput): Candidate | null {
  const {
    division,
    winGroup,
    counts,
    melds,
    winTile,
    context,
    isClosed,
    valuedTiles,
    dora,
  } = input;

  const detectInput = {
    division,
    counts: [...counts],
    melds,
    winTile,
    winGroup,
    isTsumo: context.isTsumo,
    playerWind: context.playerWind,
    roundWind: context.roundWind,
    isClosed,
  };

  /**
   * 役满优先：役满成立时普通役一律不计，也不加宝牌。
   * 这是日麻规则而不是简化 —— 大三元 + 断幺 + 宝牌 3 不是「役满再加 4 番」。
   */
  let yakuman: ScoredYaku[] = [];
  for (const id of SHAPE_YAKUMAN) {
    const def = YAKU[id];
    if (def.requiresClosed && !isClosed) {
      continue;
    }
    if (isYakuPresent(id, detectInput)) {
      yakuman.push({ id, han: 0, yakumanMultiplier: def.yakumanMultiplier });
    }
  }
  yakuman.push(...stateYakuman(context));
  yakuman = applySupersedes(yakuman);

  if (yakuman.length > 0) {
    /**
     * 双役满关掉时：能换成单役满本体的换掉（见 DOUBLE_FALLBACK），换不掉的按 1 倍算。
     * 换完可能撞上已有的本体（例如四暗刻单骑与四暗刻同时被判出来），所以要去重。
     */
    let scaled = yakuman;
    if (!context.rules.hasDoubleYakuman) {
      const seen = new Set<string>();
      scaled = [];
      for (const y of yakuman) {
        const id = DOUBLE_FALLBACK[y.id] ?? y.id;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        scaled.push({ ...y, id, yakumanMultiplier: 1 });
      }
    }
    let multiplier = 0;
    for (const y of scaled) {
      multiplier += y.yakumanMultiplier;
    }
    const fuResult = calculateFu({
      division,
      winTile,
      winGroup,
      melds,
      valuedTiles,
      context,
    });
    // 国士没有面子，符数无从谈起 —— 语料对它断言 0 符。
    const isKokushiHand = scaled.some(
      (y) => y.id === "kokushi" || y.id === "daburuKokushi",
    );
    return {
      han: multiplier * KAZOE_HAN,
      fu: isKokushiHand ? 0 : fuResult.fu,
      rawFu: isKokushiHand ? 0 : fuResult.fu,
      yaku: scaled,
      fuDetails: isKokushiHand ? [] : fuResult.details,
      isYakuman: true,
    };
  }

  let found: ScoredYaku[] = [];
  for (const id of SHAPE_YAKU) {
    const def = YAKU[id];
    if (def.requiresClosed && !isClosed) {
      continue;
    }
    if (isYakuPresent(id, detectInput)) {
      found.push({
        id,
        han: isClosed ? def.han : def.hanOpen,
        yakumanMultiplier: 0,
      });
    }
  }
  found.push(...stateYaku(context, isClosed));
  found = applySupersedes(found);

  /**
   * 食断关闭时，副露的断幺九不成立。
   * 本项目 §2.2 是**允许**食断，但语料默认关闭，用例在两种口径下都有 ——
   * 所以这条要跟着 rules 走，不能写死。
   */
  if (!context.rules.hasOpenTanyao && !isClosed) {
    found = found.filter((f) => f.id !== "tanyao");
  }

  /**
   * 无役不能和牌 —— 即便手里全是宝牌。所以宝牌在判「有没有役」之后才加。
   * 顺序反过来的话，一手无役但有宝牌的牌会被判成可以和，这是最经典的算番 bug。
   */
  if (found.length === 0) {
    return null;
  }

  if (dora.dora > 0) {
    found.push({ id: "dora", han: dora.dora, yakumanMultiplier: 0 });
  }
  if (dora.akaDora > 0) {
    found.push({ id: "akaDora", han: dora.akaDora, yakumanMultiplier: 0 });
  }
  if (dora.uraDora > 0) {
    found.push({ id: "uraDora", han: dora.uraDora, yakumanMultiplier: 0 });
  }

  let han = 0;
  for (const f of found) {
    han += f.han;
  }

  const fuResult = calculateFu({
    division,
    winTile,
    winGroup,
    melds,
    valuedTiles,
    context,
  });
  return {
    han,
    fu: fuResult.fu,
    rawFu: fuResult.details.reduce((sum, d) => sum + d.fu, 0),
    yaku: found,
    fuDetails: fuResult.details,
    isYakuman: false,
  };
}
