/**
 * 牌桌的几何换算。
 *
 * 与围棋的 layout.ts 同样的理由：这是纯计算，抽出来才测得动——jsdom 里
 * 没有 2D 上下文，写在渲染器内部的排布逻辑一行都跑不到。
 *
 * 扑克的排布比棋盘难在**牌是叠着的**。一手 17 张牌横排铺不开，必须重叠，
 * 于是「点在哪张牌上」不再是最近邻问题，而是要拿到**最上面**那张。加上
 * 选中的牌会抬起来，抬起后露出的那一块也得点得中。这两件事都在
 * {@link cardAtPixel} 里，也都是这个文件存在的理由。
 */

/** 扑克牌的高宽比。接近实体牌 63×88mm，牌面上放得下点数和花色。 */
export const CARD_ASPECT = 1.4;

/** 相邻两张牌的理想间距，占牌宽的比例。露出左侧这一条就够认出点数。 */
const IDEAL_STEP_RATIO = 0.42;

/** 选中的牌上抬的距离，占牌高的比例。 */
const LIFT_RATIO = 0.16;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 一排牌的排布。所有单位都是 CSS 像素。 */
export interface HandLayout {
  readonly count: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  /** 相邻两张牌左边缘的间距。小于 `cardWidth` 即为重叠。 */
  readonly step: number;
  /** 第一张牌的左边缘。整排水平居中。 */
  readonly originX: number;
  /** 未选中的牌的上边缘。 */
  readonly baseY: number;
  /** 选中的牌上抬多少。 */
  readonly lift: number;
}

/**
 * 计算一排牌的排布。
 *
 * 两条硬约束，缺一都会出可见的错：
 *
 * 1. **整排不得超出给定区域。** 牌一多就压缩间距，压到多小都行，但不能
 *    溢出——溢出的部分点不到，玩家会以为最后几张牌不能选。
 * 2. **抬起的空间要预留在区域内。** 牌高按「区域高 - 抬起距离」算，否则
 *    选中的牌会被裁掉顶部，正好是印着点数的那一头。
 *
 * @param count 牌数
 * @param area 可用区域
 */
export function computeHandLayout(count: number, area: Rect): HandLayout {
  const lift = Math.max(0, area.height * LIFT_RATIO);
  const cardHeight = Math.max(0, area.height - lift);
  // 区域很扁时按宽度兜一次底，免得牌宽超过整个区域
  const cardWidth = Math.min(cardHeight / CARD_ASPECT, area.width);

  if (count <= 0 || cardWidth <= 0) {
    return {
      count: Math.max(0, count),
      cardWidth: 0,
      cardHeight: 0,
      step: 0,
      originX: area.x,
      baseY: area.y + lift,
      lift,
    };
  }

  const ideal = cardWidth * IDEAL_STEP_RATIO;
  // 一张牌时没有间距可言；多张时取「理想间距」与「刚好铺满」的较小值
  const fit = count > 1 ? (area.width - cardWidth) / (count - 1) : 0;
  const step = count > 1 ? Math.max(0, Math.min(ideal, fit)) : 0;

  const spread = step * (count - 1) + cardWidth;
  return {
    count,
    cardWidth,
    cardHeight,
    step,
    originX: area.x + (area.width - spread) / 2,
    baseY: area.y + lift,
    lift,
  };
}

/**
 * 第 `index` 张牌的矩形。
 *
 * @param selected 该张是否被选中。选中的牌上抬，矩形跟着上移——这一点必须
 *   和命中测试用同一份计算，否则会出现「看得见却点不中」。
 */
export function cardRect(
  layout: HandLayout,
  index: number,
  selected = false,
): Rect {
  return {
    x: layout.originX + index * layout.step,
    y: layout.baseY - (selected ? layout.lift : 0),
    width: layout.cardWidth,
    height: layout.cardHeight,
  };
}

function contains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/**
 * 命中测试：点在哪张牌上，没点中返回 `null`。
 *
 * **从右往左扫。** 牌是从左往右依次叠上去的，右边的牌压着左边的牌，所以
 * 最先命中的必须是下标最大的那张。从左往右扫会返回被压在底下的牌——玩家
 * 点最右边那张显眼的牌，选中的却是左边某张，而且牌越多错得越离谱。
 *
 * @param isSelected 查询某张是否已选中。选中的牌抬起后，露出来的那一块也
 *   要能点中（用来取消选中），所以矩形必须按当前抬起状态算。
 */
export function cardAtPixel(
  layout: HandLayout,
  x: number,
  y: number,
  isSelected: (index: number) => boolean = () => false,
): number | null {
  for (let i = layout.count - 1; i >= 0; i -= 1) {
    if (contains(cardRect(layout, i, isSelected(i)), x, y)) return i;
  }
  return null;
}

/**
 * 整个牌桌的分区。
 *
 * 三家的位置由 view.ts 的 `slotOfSeat` 给出（本家在下、上家左上、下家右上），
 * 这里只负责把画布切成对应的四块。切分比例是布局决定，不含任何规则。
 */
export interface TableLayout {
  readonly width: number;
  readonly height: number;
  /** 本家手牌区。 */
  readonly hand: Rect;
  /** 出牌区（桌面中央）。 */
  readonly trick: Rect;
  /** 上家（左上）。 */
  readonly left: Rect;
  /** 下家（右上）。 */
  readonly right: Rect;
}

/** 各区高度占比。三段相加为 1，改一处要跟着改另两处。 */
const SEAT_BAND = 0.28;
const TRICK_BAND = 0.34;
const HAND_BAND = 0.38;

/** 上下两家各占宽度的这个比例，中间留给出牌区。 */
const SIDE_WIDTH = 0.3;

export function computeTableLayout(width: number, height: number): TableLayout {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const sideWidth = w * SIDE_WIDTH;
  const seatHeight = h * SEAT_BAND;

  return {
    width: w,
    height: h,
    left: { x: 0, y: 0, width: sideWidth, height: seatHeight },
    right: { x: w - sideWidth, y: 0, width: sideWidth, height: seatHeight },
    trick: {
      x: sideWidth,
      y: seatHeight,
      width: Math.max(0, w - sideWidth * 2),
      height: h * TRICK_BAND,
    },
    hand: {
      x: 0,
      y: seatHeight + h * TRICK_BAND,
      width: w,
      height: h * HAND_BAND,
    },
  };
}
