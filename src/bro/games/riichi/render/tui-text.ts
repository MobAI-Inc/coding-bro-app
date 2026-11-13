/**
 * 立直麻将：TUI 字符排版。
 *
 * 纯函数，输入视图、输出多行字符串。不碰 DOM，因此能直接断言 —— 这是 TUI 模式
 * 唯一可测的地方，也是它比 Canvas 好测的原因。
 *
 * 排版原则：**牌用短记法而不是 Unicode 麻将字符**。U+1F000 那一段在等宽字体里
 * 宽度不一致（有的终端字体算一格，有的算两格），一旦对不齐，整个牌河就会错位成
 * 一堆碎片。`3m` / `东` 这种写法在任何等宽字体里都是稳定的两格。
 */

import type { Tile136, Tile34 } from "../logic";
import { toTile34 } from "../logic";
import type { RiichiView } from "../view";
import { END_REASON_TEXT } from "../view";
import { labelOf, tileLabel } from "./layout";

/** 牌河一行几张。 */
export const POND_COLS = 6;

/** 座位风的汉字，按相对座位：自己、下家、对家、上家。 */
const REL_SEAT_TEXT = ["自", "下", "对", "上"] as const;

/** 每张牌占的字符宽度。短记法 `3m` 是两格，字牌汉字也按两格对齐。 */
const CELL = 3;

/** 一张牌排成固定宽度。`东` 是全角字符，占位比 `3m` 多，所以单独少补一格。 */
function pad(text: string): string {
  const width = /[一-鿿]/.test(text) ? 2 : text.length;
  return text + " ".repeat(Math.max(0, CELL - width));
}

/** 一手牌排成一行。`selected` 用方括号框住选中的那张。 */
export function renderHand(
  hand: readonly Tile136[],
  options: {
    readonly drawn?: Tile136 | null;
    readonly selected?: number | null;
  } = {},
): string {
  const { drawn = null, selected = null } = options;
  return hand
    .map((tile, i) => {
      const label = labelOf(tile);
      // 摸到的那张前面空一格，与其余手牌拉开 —— 与 Canvas 那侧同一个约定
      const prefix =
        drawn !== null && tile === drawn && i === hand.length - 1 ? " " : "";
      return (
        prefix +
        (i === selected ? `[${label}]` : ` ${pad(label)}`.slice(0, CELL + 1))
      );
    })
    .join("");
}

/**
 * 一家的牌河，按 6 张一行。
 *
 * 立直宣告牌在真牌桌上是横放的，这里用 `*` 前缀代替 —— 字符界面转不了 90°，
 * 而「哪张是立直宣告牌」是读牌的关键信息，不能省。
 */
export function renderPond(
  discards: readonly Tile136[],
  riichiIndex: number | null = null,
): string {
  const lines: string[] = [];
  for (let i = 0; i < discards.length; i += POND_COLS) {
    const row = discards
      .slice(i, i + POND_COLS)
      .map((tile, j) =>
        i + j === riichiIndex ? `*${labelOf(tile)}` : ` ${labelOf(tile)}`,
      )
      .map((t) => pad(t))
      .join("");
    lines.push(row);
  }
  return lines.join("\n");
}

/** 中央信息区：场风、本场、立直棒、余牌、宝牌。 */
export function renderCenter(view: RiichiView): string {
  const dora = view.doraIndicators.map((t) => labelOf(t)).join(" ");
  return [
    `${tileLabel(view.roundWind)}场 ${view.honba}本场`,
    `余牌 ${view.wallRemaining}  立直棒 ${view.riichiSticks}`,
    `宝牌 ${dora || "—"}`,
  ].join("\n");
}

/** 四家点数一行。立直的人后面标 `R`。 */
export function renderScores(view: RiichiView): string {
  const rows = [
    {
      rel: 0,
      seat: view.self.seat,
      points: view.self.points,
      riichi: view.self.riichi,
    },
    ...view.opponents.map((o, i) => ({
      rel: i + 1,
      seat: o.seat,
      points: o.points,
      riichi: o.riichi,
    })),
  ];
  return rows
    .map(
      (r) =>
        `${REL_SEAT_TEXT[r.rel]}${r.seat === view.dealer ? "(庄)" : "    "} ${String(
          r.points,
        ).padStart(6)}${r.riichi ? " R" : "  "}`,
    )
    .join("\n");
}

/**
 * 状态栏。
 *
 * 只列**当前真正生效**的快捷键。轮不到你时写「Enter 打出」是在骗人 —— 玩家
 * 按下去会得到一句「还没轮到你」，然后开始怀疑是不是程序坏了。
 */
export function renderStatusBar(view: RiichiView, myTurn: boolean): string {
  if (view.result !== null) {
    return `终局 · ${END_REASON_TEXT[view.result.reason]}   q 退出`;
  }

  const keys: string[] = [];
  if (view.self.canRon) keys.push("r 荣和");
  if (view.self.canTsumo) keys.push("t 自摸");
  if (view.self.canRon) keys.push("p 放弃");
  if (myTurn && !view.self.canRon) {
    keys.push("h/l 选牌", "Enter 打出");
    if (view.self.canRiichi) keys.push("R 立直");
  }
  if (keys.length === 0) keys.push("等待其他玩家…");
  keys.push("q 退出");

  const furiten = view.self.furiten ? "  [振听]" : "";
  return keys.join(" · ") + furiten;
}

/** 听牌提示。没听牌返回空串 —— 空串让调用方能整行省掉，不留一行「听：」。 */
export function renderWaits(waits: readonly Tile34[]): string {
  if (waits.length === 0) return "";
  return `听 ${waits.map((t) => tileLabel(t)).join(" ")}`;
}

/** 终局结算：役、番符、点数增减。 */
export function renderResult(view: RiichiView): string {
  const result = view.result;
  if (result === null) return "";

  const lines = [`── ${END_REASON_TEXT[result.reason]} ──`];

  if (result.winner !== null) {
    lines.push(
      ...result.yaku.map((y) => `  ${y.id}  ${y.han}番`),
      `  ${result.han}番 ${result.fu}符`,
    );
    if (view.uraDoraIndicators.length > 0) {
      lines.push(
        `  里宝牌 ${view.uraDoraIndicators.map((t) => labelOf(t)).join(" ")}`,
      );
    }
  }

  const seats = [
    { rel: 0, seat: view.self.seat },
    ...view.opponents.map((o, i) => ({ rel: i + 1, seat: o.seat })),
  ];
  lines.push(
    ...seats.map((s) => {
      const delta = result.deltas[s.seat];
      // 正数显式带 +：结算表里 `3000` 和 `-3000` 只差一个字符，看错方向很致命
      return `  ${REL_SEAT_TEXT[s.rel]}  ${delta > 0 ? "+" : ""}${delta}`;
    }),
  );
  return lines.join("\n");
}

/** 整屏。渲染器把它塞进 <pre>。 */
export function renderTable(
  view: RiichiView,
  myTurn: boolean,
  selected: number | null,
): string {
  const blocks: string[] = [renderScores(view), "", renderCenter(view), ""];

  for (let rel = 1; rel <= 3; rel += 1) {
    const opponent = view.opponents[rel - 1];
    const pond = renderPond(opponent.discards);
    blocks.push(
      `${REL_SEAT_TEXT[rel]}家 (${opponent.handCount}张)${opponent.riichi ? " 立直" : ""}`,
      pond || "  —",
      "",
    );
  }

  blocks.push("我的牌河", renderPond(view.self.discards) || "  —", "");
  blocks.push(renderHand(view.self.hand, { drawn: view.self.drawn, selected }));

  const waits = renderWaits(view.self.waits);
  if (waits) blocks.push(waits);

  if (view.result !== null) blocks.push("", renderResult(view));
  blocks.push("", renderStatusBar(view, myTurn));

  return blocks.join("\n");
}

/** 牌的短记法。渲染器与测试共用，避免各自实现一份。 */
export function tileText(tile: Tile136): string {
  return labelOf(tile);
}

/** 牌种的短记法。 */
export function kindText(tile: Tile136): string {
  return tileLabel(toTile34(tile));
}
