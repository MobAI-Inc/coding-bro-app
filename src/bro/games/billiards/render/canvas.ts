/**
 * Canvas 渲染器（亮色模式）。
 *
 * 交互是「拖拽定角度与力度」：在母球附近按下，拖出去的方向就是击球方向，拖的
 * 距离就是力度，松手出杆。这比「先点角度再拉力度条」少一次模式切换 —— 台球
 * 本来就是一个连续动作，拆成两步的界面每一杆都要来回两次。
 *
 * 球桌区不套玻璃效果：`backdrop-filter` 在每帧重绘的区域上会吃光 GPU
 * （UI-DESIGN.md §5，tokens 测试里有护栏）。质感靠画布内的渐变做。
 */

import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "../../core/types";
import { canAct } from "../../core/types";
import type { BallView, BilliardsView } from "../view";
import { BILLIARDS_INTENT } from "../view";
import type { TableLayout } from "./layout";
import {
  TABLE_HALF_LENGTH_M,
  TABLE_HALF_WIDTH_M,
  angleToBrad,
  computeTableLayout,
  metersToPixel,
  pixelToMeters,
  powerToFixed,
} from "./layout";


const PALETTE = {
  cloth: "#167258",
  clothMid: "#0f604b",
  clothEdge: "#094535",
  rail: "#5a321d",
  railMid: "#8b5a32",
  railHi: "#c99a5d",
  pocket: "#090807",
  cue: "#fbfaf7",
  cueEdge: "#c9c2b2",
  eight: "#14110c",
  line: "rgba(255,255,255,0.55)",
  power: "#e8b93a",
  target: "rgba(255,255,255,0.85)",
} as const;

/** 全色球的颜色，按号码。花色球用同色加白条。 */
const BALL_COLORS: Record<number, string> = {
  1: "#e5b53a",
  2: "#2f5fa8",
  3: "#c0392b",
  4: "#7b4397",
  5: "#e07b39",
  6: "#2f7d5d",
  7: "#8c3b2e",
};

/** 拖多远算满力，像素。超过就截断。 */
const MAX_DRAG_PX = 180;
export const SHOT_PLAYBACK_FPS = 64;
export const MIN_SHOT_DRAG_PX = 12;
export const MAX_SHOT_PLAYBACK_MS = 8_000;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface DisplayBall extends BallView {
  readonly scale?: number;
  readonly opacity?: number;
}

export interface ShotGesture {
  readonly angle: number;
  readonly power: number;
  readonly ratio: number;
  readonly direction: Point;
}

/** Pure gesture conversion shared by pointer handling and tests. */
export function shotGesture(from: Point, to: Point): ShotGesture | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < MIN_SHOT_DRAG_PX) return null;
  const ratio = Math.min(1, distance / MAX_DRAG_PX);
  return {
    angle: angleToBrad(dx, dy),
    power: powerToFixed(ratio),
    ratio,
    direction: { x: dx / distance, y: dy / distance },
  };
}

export function shotPlaybackDuration(frameCount: number): number {
  return Math.min(
    MAX_SHOT_PLAYBACK_MS,
    Math.max(0, frameCount - 1) * (1000 / SHOT_PLAYBACK_FPS),
  );
}

/**
 * Interpolate authoritative samples for the display refresh rate. Pocketing is
 * eased into a short shrink instead of making the ball disappear between two
 * solver samples.
 */
export function interpolateShotFrame(
  frames: readonly (readonly BallView[])[],
  elapsedMs: number,
): { readonly balls: readonly DisplayBall[]; readonly done: boolean } {
  if (frames.length === 0) return { balls: [], done: true };
  if (frames.length === 1) return { balls: frames[0], done: true };

  const duration = shotPlaybackDuration(frames.length);
  const framePosition =
    duration === 0
      ? frames.length - 1
      : (Math.max(0, elapsedMs) / duration) * (frames.length - 1);
  const fromIndex = Math.min(frames.length - 1, Math.floor(framePosition));
  const toIndex = Math.min(frames.length - 1, fromIndex + 1);
  const alpha = Math.min(1, Math.max(0, framePosition - fromIndex));
  const from = frames[fromIndex];
  const toById = new Map(frames[toIndex].map((ball) => [ball.id, ball]));

  const balls = from.map((ball): DisplayBall => {
    const next = toById.get(ball.id) ?? ball;
    const enteringPocket = !ball.pocketed && next.pocketed;
    return {
      ...next,
      x: ball.x + (next.x - ball.x) * alpha,
      y: ball.y + (next.y - ball.y) * alpha,
      pocketed: enteringPocket ? false : next.pocketed,
      scale: enteringPocket ? Math.max(0.08, 1 - alpha) : 1,
      opacity: enteringPocket ? Math.max(0.12, 1 - alpha) : 1,
    };
  });

  return {
    balls,
    done: elapsedMs >= shotPlaybackDuration(frames.length),
  };
}

export interface CanvasBilliardsRendererOptions {
  readonly onPlaybackChange?: (playing: boolean) => void;
}

export class CanvasBilliardsRenderer implements GameRenderer<BilliardsView> {
  readonly mode: RenderMode = "canvas";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handler: ((intent: InputIntent) => void) | null = null;
  private latest: GameState<BilliardsView> | null = null;
  private layout: TableLayout | null = null;
  private observer: ResizeObserver | null = null;
  private playbackFrame: number | null = null;
  private playbackStartedAt: number | null = null;
  private playbackElapsedMs = 0;
  private playbackState: GameState<BilliardsView> | null = null;
  private displayedBalls: readonly DisplayBall[] | null = null;
  private queuedPlayback: GameState<BilliardsView> | null = null;
  private shotFeedback: ShotGesture | null = null;

  /** 拖拽起点与当前点，像素。纯本地视觉状态，不进快照。 */
  private dragFrom: { x: number; y: number } | null = null;
  private dragTo: { x: number; y: number } | null = null;

  constructor(private readonly options: CanvasBilliardsRendererOptions = {}) {}

  mount(container: HTMLElement): void {
    const canvas = document.createElement("canvas");
    canvas.className = "bro-billiards-canvas";
    container.append(canvas);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(state: GameState<BilliardsView>): void {
    this.latest = state;
    if (state.board.motion && state.board.motion.length > 1) {
      if (this.playbackFrame !== null) {
        this.queuedPlayback = state;
      } else {
        this.play(state);
      }
    } else {
      this.resize();
    }
  }

  onIntent(handler: (intent: InputIntent) => void): void {
    this.handler = handler;
  }

  unmount(): void {
    if (this.playbackFrame !== null) cancelAnimationFrame(this.playbackFrame);
    this.observer?.disconnect();
    this.canvas?.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas?.removeEventListener("pointermove", this.onPointerMove);
    this.canvas?.removeEventListener("pointerup", this.onPointerUp);
    this.canvas?.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas?.remove();
    this.observer = null;
    this.canvas = null;
    this.ctx = null;
    this.handler = null;
    this.latest = null;
    this.layout = null;
    this.dragFrom = null;
    this.dragTo = null;
    this.playbackFrame = null;
    this.playbackStartedAt = null;
    this.playbackElapsedMs = 0;
    this.playbackState = null;
    this.displayedBalls = null;
    this.queuedPlayback = null;
    this.shotFeedback = null;
  }

  private play(state: GameState<BilliardsView>) {
    const frames = state.board.motion;
    if (!frames || frames.length < 2) return;
    this.playbackState = state;
    this.playbackStartedAt = null;
    this.displayedBalls = frames[0];
    this.resize();
    this.canvas?.setAttribute("aria-busy", "true");
    this.options.onPlaybackChange?.(true);

    const animate = (now: number) => {
      if (this.playbackStartedAt === null) this.playbackStartedAt = now;
      const elapsed = now - this.playbackStartedAt;
      this.playbackElapsedMs = elapsed;
      const visual = interpolateShotFrame(frames, elapsed);
      this.displayedBalls = visual.balls;
      this.drawMotionFrame(visual.balls);
      if (!visual.done) {
        this.playbackFrame = requestAnimationFrame(animate);
      } else {
        this.playbackFrame = null;
        this.playbackStartedAt = null;
        this.playbackElapsedMs = 0;
        this.playbackState = null;
        this.displayedBalls = null;
        this.shotFeedback = null;
        const queued = this.queuedPlayback;
        this.queuedPlayback = null;
        if (queued) {
          this.play(queued);
        } else {
          this.canvas?.removeAttribute("aria-busy");
          this.resize();
          this.options.onPlaybackChange?.(false);
        }
      }
    };
    this.playbackFrame = requestAnimationFrame(animate);
  }

  private drawMotionFrame(balls: readonly DisplayBall[]) {
    const state = this.playbackState ?? this.latest;
    const layout = this.layout;
    const canvas = this.canvas;
    if (!state || !layout || !canvas) return;
    this.draw(
      { ...state, board: { ...state.board, balls } },
      layout,
      canvas.clientWidth,
      canvas.clientHeight,
    );
  }

  private resize(): void {
    const canvas = this.canvas;
    const state = this.latest;
    if (!canvas || !state) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 0;
    const height = parent?.clientHeight ?? 0;
    if (width === 0 || height === 0) return;

    const layout = computeTableLayout(width, height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    this.layout = layout;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const balls = this.displayedBalls;
    this.draw(
      balls ? { ...state, board: { ...state.board, balls } } : state,
      layout,
      width,
      height,
    );
  }

  private draw(
    state: GameState<BilliardsView>,
    layout: TableLayout,
    width: number,
    height: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    this.drawTable(ctx, layout);
    this.drawPockets(ctx, layout);

    for (const ball of state.board.balls as readonly DisplayBall[]) {
      if (ball.pocketed) continue;
      const { x, y } = metersToPixel(layout, ball.x, ball.y);
      ctx.save();
      ctx.globalAlpha = ball.opacity ?? 1;
      this.drawBall(ctx, x, y, layout.ballRadius * (ball.scale ?? 1), ball.id);
      ctx.restore();
      if (
        state.board.targets.includes(ball.id) &&
        canAct(state) &&
        this.playbackFrame === null
      ) {
        ctx.beginPath();
        ctx.arc(x, y, layout.ballRadius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = PALETTE.target;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    this.drawAim(ctx, state, layout);
  }

  private drawTable(ctx: CanvasRenderingContext2D, layout: TableLayout): void {
    const { centerX, centerY, width, height } = layout;
    const left = centerX - width / 2;
    const top = centerY - height / 2;
    const railWidth = Math.max(8, layout.ballRadius * 1.4);

    // 深色外框模拟实木球桌：纵向高光在陶瓷白会所里显得温润，在夜场外壳里
    // 仍保留真实材质，不会退化成一块纯色矩形。
    const wood = ctx.createLinearGradient(
      left - railWidth,
      top - railWidth,
      left - railWidth,
      top + height + railWidth,
    );
    wood.addColorStop(0, PALETTE.railHi);
    wood.addColorStop(0.16, PALETTE.railMid);
    wood.addColorStop(0.52, PALETTE.rail);
    wood.addColorStop(0.84, PALETTE.railMid);
    wood.addColorStop(1, "#3b2115");
    ctx.fillStyle = wood;
    ctx.fillRect(
      left - railWidth,
      top - railWidth,
      width + railWidth * 2,
      height + railWidth * 2,
    );
    ctx.strokeStyle = "rgba(255, 230, 190, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      left - railWidth,
      top - railWidth,
      width + railWidth * 2,
      height + railWidth * 2,
    );

    const gradient = ctx.createRadialGradient(
      centerX,
      centerY - height * 0.08,
      height * 0.05,
      centerX,
      centerY,
      width * 0.62,
    );
    gradient.addColorStop(0, PALETTE.cloth);
    gradient.addColorStop(0.6, PALETTE.clothMid);
    gradient.addColorStop(1, PALETTE.clothEdge);
    ctx.fillStyle = gradient;
    ctx.fillRect(left, top, width, height);

    // 内库边与开球线让球桌有竞技场的尺度感。
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 1, top + 1, width - 2, height - 2);
    const headX = left + width * 0.25;
    ctx.beginPath();
    ctx.moveTo(headX, top);
    ctx.lineTo(headX, top + height);
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    ctx.stroke();

    // 木库上的母贝标记；用形状而非图片，DPR 下依然清晰。
    ctx.fillStyle = "rgba(255, 240, 207, 0.72)";
    for (let i = 1; i < 8; i += 1) {
      const x = left + (width * i) / 8;
      for (const y of [
        top - railWidth * 0.52,
        top + height + railWidth * 0.52,
      ]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-2, -2, 4, 4);
        ctx.restore();
      }
    }
  }

  /**
   * 画袋口。
   *
   * 位置直接按台面四角与两长边中点算，与 table.ts 的 POCKETS 同构 —— 这里
   * 不 import 那份常量，因为那边是定点数，而画袋口只需要一个视觉近似。真正
   * 判定球有没有进袋的是解算器，不是这几个圆。
   */
  private drawPockets(
    ctx: CanvasRenderingContext2D,
    layout: TableLayout,
  ): void {
    const radius = layout.ballRadius * 1.9;
    const xs = [-TABLE_HALF_LENGTH_M, 0, TABLE_HALF_LENGTH_M];
    const ys = [-TABLE_HALF_WIDTH_M, TABLE_HALF_WIDTH_M];

    ctx.fillStyle = PALETTE.pocket;
    for (const y of ys) {
      for (const x of xs) {
        const p = metersToPixel(layout, x, y);
        ctx.beginPath();
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = radius * 0.75;
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  private drawBall(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    id: number,
  ): void {
    if (radius <= 0) return;
    const solid = id >= 1 && id <= 7;
    const striped = id >= 9 && id <= 15;
    const base =
      id === 0
        ? PALETTE.cue
        : id === 8
          ? PALETTE.eight
          : (BALL_COLORS[solid ? id : id - 8] ?? PALETTE.cue);

    const gradient = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.35,
      radius * 0.1,
      x,
      y,
      radius,
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.75)");
    gradient.addColorStop(0.35, base);
    gradient.addColorStop(1, base);

    // 接触阴影先于球体绘制，球不再像贴纸浮在台呢上。
    ctx.beginPath();
    ctx.ellipse(
      x + radius * 0.18,
      y + radius * 0.34,
      radius * 0.88,
      radius * 0.45,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = Math.max(0.75, radius * 0.08);
    ctx.stroke();

    // 漆面高光，和径向渐变一起形成双层反射。
    ctx.beginPath();
    ctx.ellipse(
      x - radius * 0.34,
      y - radius * 0.42,
      radius * 0.2,
      radius * 0.11,
      -0.45,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fill();

    // 花色球：中间一条白带。这是花色与全色唯一的视觉区别，不能省 ——
    // 分不清自己该打哪一组，整局就没法玩。
    if (striped) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(x - radius, y - radius * 0.38, radius * 2, radius * 0.76);
      ctx.restore();
    }

    if (id === 0) {
      ctx.strokeStyle = PALETTE.cueEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 号码。球太小时不画，糊成一团反而更难认。
    if (id > 0 && radius >= 9) {
      ctx.fillStyle = striped || id === 8 ? "#14110c" : "#ffffff";
      if (striped) {
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.fillStyle = "#14110c";
      }
      ctx.font = `${Math.round(radius * 0.85)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), x, y);
    }
  }

  /** 画球杆、碰球预测线与力度。 */
  private drawAim(
    ctx: CanvasRenderingContext2D,
    state: GameState<BilliardsView>,
    layout: TableLayout,
  ): void {
    const from = this.dragFrom;
    const to = this.dragTo;
    const liveGesture = from && to ? shotGesture(from, to) : null;
    const gesture = liveGesture ?? this.shotFeedback;
    if (!gesture) return;
    // 松手即完成击打；从第一帧滚动开始隐藏球杆，绝不能追着母球或留在桌边。
    if (!liveGesture && this.playbackFrame !== null) return;

    const cue = state.board.balls.find(
      (ball) => ball.id === 0 && !ball.pocketed,
    );
    if (!cue) return;
    const cuePoint = metersToPixel(layout, cue.x, cue.y);
    const direction = gesture.direction;

    // 球杆始终在击球方向背后。回放开头 120ms 内快速前送，形成明确击球反馈。
    const strikeProgress =
      this.playbackFrame === null
        ? 0
        : Math.min(1, this.playbackElapsedMs / 120);
    const pullback =
      (liveGesture ? 18 + gesture.ratio * 46 : 28) * (1 - strikeProgress);
    const tipGap = layout.ballRadius + 5 + pullback;
    const cueLength = Math.max(110, layout.width * 0.24);
    const cueStart = {
      x: cuePoint.x - direction.x * tipGap,
      y: cuePoint.y - direction.y * tipGap,
    };
    const cueEnd = {
      x: cueStart.x - direction.x * cueLength,
      y: cueStart.y - direction.y * cueLength,
    };

    const wood = ctx.createLinearGradient(
      cueEnd.x,
      cueEnd.y,
      cueStart.x,
      cueStart.y,
    );
    wood.addColorStop(0, "#312015");
    wood.addColorStop(0.18, "#87603e");
    wood.addColorStop(0.86, "#e4c48d");
    wood.addColorStop(1, "#f4ead6");
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cueEnd.x + 2, cueEnd.y + 2);
    ctx.lineTo(cueStart.x + 2, cueStart.y + 2);
    ctx.stroke();
    ctx.strokeStyle = wood;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cueEnd.x, cueEnd.y);
    ctx.lineTo(cueStart.x, cueStart.y);
    ctx.stroke();
    ctx.restore();

    // 击出后球杆只做前送，不再叠加预测线和力度条。
    if (!liveGesture) return;

    const prediction = this.predictionEnd(state, layout, cuePoint, direction);

    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cuePoint.x, cuePoint.y);
    ctx.lineTo(prediction.x, prediction.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(prediction.x, prediction.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.restore();

    // 固定位置力度槽比沿球杆画一小段线更易读，触控时也不会被手指遮住。
    const barWidth = Math.min(180, layout.width * 0.28);
    const barHeight = 10;
    const barX = layout.centerX - barWidth / 2;
    const barY = layout.centerY + layout.height / 2 - 22;
    ctx.fillStyle = "rgba(7,28,22,0.72)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const powerGradient = ctx.createLinearGradient(
      barX,
      barY,
      barX + barWidth,
      barY,
    );
    powerGradient.addColorStop(0, "#f7df71");
    powerGradient.addColorStop(0.7, PALETTE.power);
    powerGradient.addColorStop(1, "#e5633b");
    ctx.fillStyle = powerGradient;
    ctx.fillRect(barX, barY, barWidth * gesture.ratio, barHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  private predictionEnd(
    state: GameState<BilliardsView>,
    layout: TableLayout,
    origin: Point,
    direction: Point,
  ): Point {
    const left = layout.centerX - layout.width / 2 + layout.ballRadius;
    const right = layout.centerX + layout.width / 2 - layout.ballRadius;
    const top = layout.centerY - layout.height / 2 + layout.ballRadius;
    const bottom = layout.centerY + layout.height / 2 - layout.ballRadius;
    const edges = [
      direction.x > 0
        ? (right - origin.x) / direction.x
        : Number.POSITIVE_INFINITY,
      direction.x < 0
        ? (left - origin.x) / direction.x
        : Number.POSITIVE_INFINITY,
      direction.y > 0
        ? (bottom - origin.y) / direction.y
        : Number.POSITIVE_INFINITY,
      direction.y < 0
        ? (top - origin.y) / direction.y
        : Number.POSITIVE_INFINITY,
    ].filter((distance) => distance > 0);
    let distance = Math.min(...edges);

    for (const ball of state.board.balls) {
      if (ball.id === 0 || ball.pocketed) continue;
      const center = metersToPixel(layout, ball.x, ball.y);
      const ox = center.x - origin.x;
      const oy = center.y - origin.y;
      const projection = ox * direction.x + oy * direction.y;
      if (projection <= 0) continue;
      const perpendicularSq = ox * ox + oy * oy - projection * projection;
      const combinedRadius = layout.ballRadius * 2;
      if (perpendicularSq > combinedRadius * combinedRadius) continue;
      const hit =
        projection -
        Math.sqrt(combinedRadius * combinedRadius - perpendicularSq);
      if (hit > 0) distance = Math.min(distance, hit);
    }

    return {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
    };
  }

  private localPoint(event: PointerEvent): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent): void => {
    const state = this.latest;
    const layout = this.layout;
    const point = this.localPoint(event);
    if (
      event.button !== 0 ||
      !state ||
      !layout ||
      !point ||
      !canAct(state) ||
      this.playbackFrame !== null
    )
      return;

    // 持球在手时，按下即摆球 —— 不进入拖拽。摆完再来一次才是击球。
    if (state.board.ballInHand) {
      const meters = pixelToMeters(layout, point.x, point.y);
      this.handler?.({
        matchId: state.matchId,
        basedOnVersion: state.version,
        type: BILLIARDS_INTENT.place,
        payload: { x: meters.x, y: meters.y },
      });
      return;
    }

    const cue = state.board.balls.find(
      (ball) => ball.id === 0 && !ball.pocketed,
    );
    if (!cue) return;
    const cuePoint = metersToPixel(layout, cue.x, cue.y);
    // 至少 44px 的命中直径；移动端不要求精确点中视觉上十几像素的小球。
    const hitRadius = Math.max(22, layout.ballRadius * 1.8);
    if (Math.hypot(point.x - cuePoint.x, point.y - cuePoint.y) > hitRadius)
      return;

    event.preventDefault();
    this.canvas?.setPointerCapture?.(event.pointerId);
    this.dragFrom = cuePoint;
    this.dragTo = point;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragFrom) return;
    event.preventDefault();
    this.dragTo = this.localPoint(event);
    this.resize();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const state = this.latest;
    const from = this.dragFrom;
    const to = this.localPoint(event) ?? this.dragTo;
    this.dragFrom = null;
    this.dragTo = null;

    this.canvas?.releasePointerCapture?.(event.pointerId);
    if (
      !state ||
      !from ||
      !to ||
      !canAct(state) ||
      this.playbackFrame !== null
    ) {
      this.resize();
      return;
    }

    const gesture = shotGesture(from, to);
    if (!gesture) {
      this.resize();
      return;
    }

    this.shotFeedback = gesture;
    this.handler?.({
      matchId: state.matchId,
      basedOnVersion: state.version,
      type: BILLIARDS_INTENT.strike,
      payload: {
        angle: gesture.angle,
        power: gesture.power,
        offsetX: 0,
        offsetY: 0,
      },
    });
    this.resize();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.canvas?.releasePointerCapture?.(event.pointerId);
    if (!this.dragFrom) return;
    this.dragFrom = null;
    this.dragTo = null;
    this.resize();
  };
}
