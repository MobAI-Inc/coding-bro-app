/**
 * 球桌的几何换算。
 *
 * 纯计算，从渲染器里抽出来 —— 放在渲染器内部就只能靠真实 Canvas 上下文才能测，
 * 而 jsdom 里没有 2D 上下文。
 *
 * 逻辑层用**米**（table.ts 的 HALF_LENGTH 等），这里换算成 CSS 像素。换算只在
 * 这一个方向上做：像素永远不回流进逻辑层，那边只认定点数。
 */

import { toFloat } from "../logic/fixed";
import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH } from "../logic/table";

/** 球桌半长半宽，米。转成浮点一次，布局里反复用。 */
export const TABLE_HALF_LENGTH_M = toFloat(HALF_LENGTH);
export const TABLE_HALF_WIDTH_M = toFloat(HALF_WIDTH);
export const BALL_RADIUS_M = toFloat(BALL_RADIUS);

export interface TableLayout {
  /** 台面中心在画布上的像素坐标。 */
  readonly centerX: number;
  readonly centerY: number;
  /** 米 → 像素的比例。 */
  readonly scale: number;
  /** 球半径，像素。 */
  readonly ballRadius: number;
  /** 台面绘制区尺寸，像素（不含库边装饰）。 */
  readonly width: number;
  readonly height: number;
}

/** 库边木框的厚度，占台面短边的比例。 */
const RAIL_RATIO = 0.06;

/**
 * 按容器尺寸算布局。
 *
 * 台面比例固定 2:1（table.ts 的 HALF_LENGTH : HALF_WIDTH），**不拉伸** ——
 * 拉伸的球桌会让入射角看起来不等于反射角，玩家瞄不准，这是可用性问题不是美观
 * 问题。取长宽里更受限的那一维定比例。
 */
export function computeTableLayout(width: number, height: number): TableLayout {
  const safeW = Math.max(0, width);
  const safeH = Math.max(0, height);
  // 留出库边木框
  const usableW = safeW * (1 - RAIL_RATIO * 2);
  const usableH = safeH * (1 - RAIL_RATIO * 2);

  const scale = Math.min(
    usableW / (TABLE_HALF_LENGTH_M * 2),
    usableH / (TABLE_HALF_WIDTH_M * 2),
  );

  return {
    centerX: safeW / 2,
    centerY: safeH / 2,
    scale: Math.max(0, scale),
    ballRadius: Math.max(0, scale * BALL_RADIUS_M),
    width: scale * TABLE_HALF_LENGTH_M * 2,
    height: scale * TABLE_HALF_WIDTH_M * 2,
  };
}

/** 台面坐标（米）→ 画布坐标（像素）。 */
export function metersToPixel(
  layout: TableLayout,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: layout.centerX + x * layout.scale,
    y: layout.centerY + y * layout.scale,
  };
}

/** 画布坐标（像素）→ 台面坐标（米）。摆球时用。 */
export function pixelToMeters(
  layout: TableLayout,
  x: number,
  y: number,
): { x: number; y: number } {
  if (layout.scale === 0) return { x: 0, y: 0 };
  return {
    x: (x - layout.centerX) / layout.scale,
    y: (y - layout.centerY) / layout.scale,
  };
}

/**
 * 从母球指向鼠标的方向，换算成 brad 角。
 *
 * brad（binary radian）是逻辑层的角度单位：整圈 16384，见 vec.ts。**在这里
 * 换算而不是在渲染器里**，是因为这是「像素世界」与「定点数世界」的唯一接缝，
 * 集中一处才能保证意图里发出去的永远是合法 brad。
 */
export function angleToBrad(dx: number, dy: number): number {
  const radians = Math.atan2(dy, dx);
  const full = 16384;
  return ((Math.round((radians / (Math.PI * 2)) * full) % full) + full) % full;
}

/** brad → 弧度。画瞄准线用。 */
export function bradToRadians(brad: number): number {
  return (brad / 16384) * Math.PI * 2;
}

/**
 * 力度条的取值范围。
 *
 * 逻辑层 `MAX_POWER` 是 10（定点数），界面给 0~1 的归一值，由这里映射。界面
 * 不直接碰 `fromInt` —— 一旦碰了，UI 代码里就会出现定点数运算。
 */
export function powerToFixed(normalized: number): number {
  const clamped = Math.min(1, Math.max(0, normalized));
  // MAX_POWER = fromInt(10) = 10 << 16。取 10% 为下限，0 力度的杆没有意义。
  const minRaw = 1 << 16;
  const maxRaw = 10 << 16;
  return Math.round(minRaw + (maxRaw - minRaw) * clamped);
}

/** 塞点偏移（-1~1）→ 定点数。MAX_TIP_OFFSET = HALF。 */
export function tipOffsetToFixed(normalized: number): number {
  const clamped = Math.min(1, Math.max(-1, normalized));
  return Math.round(clamped * (1 << 15));
}
