import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState, InputIntent } from "@/bro/games/core/types";
import type { BallView, BilliardsView } from "@/bro/games/billiards/view";
import { BILLIARDS_INTENT } from "@/bro/games/billiards/view";
import {
  CanvasBilliardsRenderer,
  MAX_SHOT_PLAYBACK_MS,
  MIN_SHOT_DRAG_PX,
  SHOT_PLAYBACK_FPS,
  interpolateShotFrame,
  shotGesture,
  shotPlaybackDuration,
} from "@/bro/games/billiards/render/canvas";
import {
  computeTableLayout,
  metersToPixel,
  powerToFixed,
} from "@/bro/games/billiards/render/layout";
import { rackEightBall, shoot } from "@/bro/games/billiards/logic/rules";

const cue = (x: number, pocketed = false): BallView => ({
  id: 0,
  x,
  y: 0,
  pocketed,
});

function state(
  version: number,
  balls: readonly BallView[],
  motion: readonly (readonly BallView[])[] | null = null,
): GameState<BilliardsView> {
  return {
    matchId: "timeline",
    gameId: "billiards",
    phase: "playing",
    version,
    activeSeat: 0,
    mySeat: 0,
    board: {
      balls,
      motion,
      myGroup: null,
      targets: [1],
      ballInHand: false,
      broken: true,
      lastShot: null,
      winner: null,
    },
  };
}

function pointer(type: string, x: number, y: number, pointerType: string) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
  });
  return event;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("台球权威时间轴", () => {
  it("权威解算保留完整中间帧，最后一帧与裁决状态逐位一致", () => {
    const result = shoot(
      rackEightBall(0),
      { angle: 0, power: powerToFixed(0.85), offsetX: 0, offsetY: 0 },
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.frames.length).toBeGreaterThan(10);
    const finalFrame = result.frames.at(-1)!;
    expect(finalFrame.balls).toEqual(result.state.table.balls);
  });

  it("按真实时长插值，并且到截止时间才交付最后一帧", () => {
    const frames = [[cue(-1)], [cue(0)], [cue(1, true)]];
    const duration = shotPlaybackDuration(frames.length);

    const middle = interpolateShotFrame(frames, duration / 2);
    expect(middle.done).toBe(false);
    expect(middle.balls[0].x).toBeCloseTo(0);

    const beforeEnd = interpolateShotFrame(frames, duration - 0.01);
    expect(beforeEnd.done).toBe(false);
    expect(beforeEnd.balls[0].pocketed).toBe(false);
    expect(beforeEnd.balls[0].scale).toBeLessThan(1);

    const end = interpolateShotFrame(frames, duration);
    expect(end.done).toBe(true);
    expect(end.balls[0]).toMatchObject({ x: 1, pocketed: true });
  });

  it("超长物理尾帧完整映射到八秒内，不让单杆动画拖到一分钟", () => {
    const frames = Array.from(
      { length: SHOT_PLAYBACK_FPS * 60 },
      (_, index) => [cue(index)],
    );
    expect(shotPlaybackDuration(frames.length)).toBe(MAX_SHOT_PLAYBACK_MS);
    expect(interpolateShotFrame(frames, MAX_SHOT_PLAYBACK_MS).balls[0].x).toBe(
      frames.length - 1,
    );
    expect(interpolateShotFrame(frames, MAX_SHOT_PLAYBACK_MS).done).toBe(true);
  });

  it("渲染器不会提前结束回放，回放中锁住输入", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 400 },
    });
    const playing: boolean[] = [];
    const intents: InputIntent[] = [];
    const renderer = new CanvasBilliardsRenderer({
      onPlaybackChange: (value) => playing.push(value),
    });
    renderer.mount(host);
    renderer.onIntent((intent) => intents.push(intent));

    const frames = [[cue(-1)], [cue(-0.5)], [cue(0)], [cue(0.5)]];
    renderer.render(state(1, frames.at(-1)!, frames));
    const canvas = host.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 400,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    });

    const layout = computeTableLayout(800, 400);
    const cuePoint = metersToPixel(layout, -1, 0);
    canvas.dispatchEvent(
      pointer("pointerdown", cuePoint.x, cuePoint.y, "mouse"),
    );
    canvas.dispatchEvent(
      pointer("pointermove", cuePoint.x + 100, cuePoint.y, "mouse"),
    );
    canvas.dispatchEvent(
      pointer("pointerup", cuePoint.x + 100, cuePoint.y, "mouse"),
    );
    expect(intents).toHaveLength(0);
    expect(canvas.getAttribute("aria-busy")).toBe("true");

    const first = callbacks.shift()!;
    first(1000);
    const duration = shotPlaybackDuration(frames.length);
    callbacks.shift()!(1000 + duration - 0.01);
    expect(playing).toEqual([true]);
    expect(canvas.getAttribute("aria-busy")).toBe("true");

    callbacks.shift()!(1000 + duration);
    expect(playing).toEqual([true, false]);
    expect(canvas.hasAttribute("aria-busy")).toBe(false);
    renderer.unmount();
  });
});

describe("台球鼠标与触控瞄准", () => {
  it("短拖拽不误触，合法拖拽输出方向与力度", () => {
    expect(
      shotGesture({ x: 0, y: 0 }, { x: MIN_SHOT_DRAG_PX - 1, y: 0 }),
    ).toBeNull();
    const gesture = shotGesture({ x: 20, y: 20 }, { x: 120, y: 20 });
    expect(gesture).toMatchObject({ angle: 0, direction: { x: 1, y: 0 } });
    expect(gesture!.ratio).toBeGreaterThan(0.5);
  });

  it.each(["mouse", "touch"])(
    "%s 指针从母球拖动并松手会提交一杆",
    (pointerType) => {
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => 1),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      const host = document.createElement("div");
      Object.defineProperties(host, {
        clientWidth: { value: 800 },
        clientHeight: { value: 400 },
      });
      const intents: InputIntent[] = [];
      const renderer = new CanvasBilliardsRenderer();
      renderer.mount(host);
      renderer.onIntent((intent) => intents.push(intent));
      renderer.render(state(0, [cue(-1)]));

      const canvas = host.querySelector("canvas")!;
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON: () => ({}),
      });
      const cuePoint = metersToPixel(computeTableLayout(800, 400), -1, 0);
      canvas.dispatchEvent(
        pointer("pointerdown", cuePoint.x, cuePoint.y, pointerType),
      );
      canvas.dispatchEvent(
        pointer("pointermove", cuePoint.x + 120, cuePoint.y, pointerType),
      );
      canvas.dispatchEvent(
        pointer("pointerup", cuePoint.x + 120, cuePoint.y, pointerType),
      );

      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        matchId: "timeline",
        basedOnVersion: 0,
        type: BILLIARDS_INTENT.strike,
        payload: { angle: 0 },
      });
      renderer.unmount();
    },
  );
});
