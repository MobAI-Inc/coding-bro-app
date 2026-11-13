/**
 * 游戏内核契约测试。
 *
 * 重点验证「切主题不重建对局」与「渲染器不持有规则」两条约束——它们是
 * 双模式 UI 与服务端权威两个设计前提的落点，不是实现细节。
 */

import { describe, expect, it, vi } from "vitest";
import { GameSession } from "@/bro/games/core/session";
import type {
  GameRenderer,
  GameState,
  InputIntent,
  RenderMode,
} from "@/bro/games/core/types";
import {
  canAct,
  renderModeForTheme,
  shouldAccept,
} from "@/bro/games/core/types";

/** 极简局面类型，仅用于测试内核不理解具体游戏。 */
interface TestBoard {
  cells: string[];
}

function state(
  version: number,
  over: Partial<GameState<TestBoard>> = {},
): GameState<TestBoard> {
  return {
    matchId: "m1",
    gameId: "go",
    phase: "playing",
    version,
    activeSeat: 0,
    mySeat: 0,
    board: { cells: [] },
    ...over,
  };
}

/** 记录调用的假渲染器。不含任何规则逻辑——接口也不允许它含有。 */
class FakeRenderer implements GameRenderer<TestBoard> {
  rendered: GameState<TestBoard>[] = [];
  mounted = 0;
  unmounted = 0;
  private handler: ((i: InputIntent) => void) | null = null;

  constructor(readonly mode: RenderMode) {}

  mount(): void {
    this.mounted += 1;
  }
  render(s: GameState<TestBoard>): void {
    this.rendered.push(s);
  }
  onIntent(h: (i: InputIntent) => void): void {
    this.handler = h;
  }
  unmount(): void {
    this.unmounted += 1;
  }

  /** 模拟用户操作。 */
  emit(intent: InputIntent): void {
    this.handler?.(intent);
  }
}

describe("快照顺序", () => {
  it("首个快照总是采纳", () => {
    expect(shouldAccept(null, state(7))).toBe(true);
  });

  it("版本前进则采纳", () => {
    expect(shouldAccept(state(3), state(4))).toBe(true);
  });

  it("丢弃乱序到达的旧快照 — 否则画面回退", () => {
    expect(shouldAccept(state(5), state(4))).toBe(false);
  });

  it("丢弃同版本重复下发 — 避免无谓重绘", () => {
    expect(shouldAccept(state(5), state(5))).toBe(false);
  });

  it("换局时无条件采纳，不比较版本", () => {
    // 新对局的 version 会从头计数，按版本比较会把新局第一帧当旧帧丢掉
    const next = state(1, { matchId: "m2" });
    expect(shouldAccept(state(99), next)).toBe(true);
  });
});

describe("行动权", () => {
  it("轮到本人且对局进行中才可行动", () => {
    expect(canAct(state(1, { activeSeat: 0, mySeat: 0 }))).toBe(true);
  });

  it("非本人回合不可行动", () => {
    expect(canAct(state(1, { activeSeat: 1, mySeat: 0 }))).toBe(false);
  });

  it("观战者不可行动", () => {
    expect(canAct(state(1, { mySeat: null }))).toBe(false);
  });

  it("observer 与 activeSeat 同为 null 时仍不可行动", () => {
    // 这是 mySeat !== null 判断真正生效的场合：结算中服务端下发
    // activeSeat: null，若不显式排除观战者，null === null 会判定为
    // 「轮到我了」。上一条用例因 activeSeat 为 0 而恰好通过，挡不住这个洞。
    expect(canAct(state(1, { activeSeat: null, mySeat: null }))).toBe(false);
  });

  it("对局未开始或已结束不可行动", () => {
    expect(canAct(state(1, { phase: "matchmaking" }))).toBe(false);
    expect(canAct(state(1, { phase: "finished" }))).toBe(false);
  });

  it("对手掉线期间不可行动 — 等待重连或超时判定", () => {
    expect(canAct(state(1, { phase: "opponent_disconnected" }))).toBe(false);
  });
});

describe("主题不改变 H5 游戏渲染器", () => {
  it("暗色仍使用 Canvas，仅套终端视觉皮肤", () => {
    expect(renderModeForTheme("dark")).toBe("canvas");
  });

  it("亮色为 Canvas", () => {
    expect(renderModeForTheme("light")).toBe("canvas");
  });
});

describe("会话 — 切主题不重建对局", () => {
  it("换渲染器后状态保留，并立即以现状态重绘", () => {
    const session = new GameSession<TestBoard>(vi.fn());
    const canvas = new FakeRenderer("canvas");
    const el = document.createElement("div");

    session.attachRenderer(canvas, el);
    session.applySnapshot(state(5, { board: { cells: ["a"] } }));

    // 用户切到暗色
    const tui = new FakeRenderer("tui");
    session.attachRenderer(tui, el);

    expect(canvas.unmounted).toBe(1);
    // 新渲染器不等下一个快照就能画出当前局面
    expect(tui.rendered).toHaveLength(1);
    expect(tui.rendered[0].version).toBe(5);
    expect(tui.rendered[0].board.cells).toEqual(["a"]);
    expect(session.currentState()?.version).toBe(5);
  });

  it("无状态时挂载渲染器不触发渲染", () => {
    const session = new GameSession<TestBoard>(vi.fn());
    const r = new FakeRenderer("canvas");
    session.attachRenderer(r, document.createElement("div"));
    expect(r.mounted).toBe(1);
    expect(r.rendered).toHaveLength(0);
  });

  it("卸载渲染器保留状态 — 临时离开对局界面后可返回", () => {
    const session = new GameSession<TestBoard>(vi.fn());
    session.attachRenderer(
      new FakeRenderer("canvas"),
      document.createElement("div"),
    );
    session.applySnapshot(state(3));
    session.detachRenderer();

    expect(session.currentState()?.version).toBe(3);

    const back = new FakeRenderer("tui");
    session.attachRenderer(back, document.createElement("div"));
    expect(back.rendered[0].version).toBe(3);
  });

  it("dispose 后状态清空", () => {
    const session = new GameSession<TestBoard>(vi.fn());
    const r = new FakeRenderer("canvas");
    session.attachRenderer(r, document.createElement("div"));
    session.applySnapshot(state(1));
    session.dispose();

    expect(session.currentState()).toBeNull();
    expect(r.unmounted).toBe(1);
  });
});

describe("会话 — 状态只来自服务端", () => {
  it("渲染器上报意图只触发发送，不改状态", () => {
    const send = vi.fn();
    const session = new GameSession<TestBoard>(send);
    const r = new FakeRenderer("canvas");
    session.attachRenderer(r, document.createElement("div"));
    session.applySnapshot(state(4));

    r.emit({
      matchId: "m1",
      basedOnVersion: 4,
      type: "place",
      payload: { x: 3, y: 4 },
    });

    expect(send).toHaveBeenCalledTimes(1);
    // 关键：意图发出后状态纹丝不动，等服务端下一帧
    expect(session.currentState()?.version).toBe(4);
    expect(r.rendered).toHaveLength(1);
  });

  it("旧快照被丢弃时不重绘", () => {
    const session = new GameSession<TestBoard>(vi.fn());
    const r = new FakeRenderer("canvas");
    session.attachRenderer(r, document.createElement("div"));

    expect(session.applySnapshot(state(5))).toBe(true);
    expect(session.applySnapshot(state(4))).toBe(false);

    expect(r.rendered).toHaveLength(1);
    expect(session.currentState()?.version).toBe(5);
  });

  it("换渲染器后新渲染器的意图能送达 — 回调必须重新接线", () => {
    const send = vi.fn();
    const session = new GameSession<TestBoard>(send);
    session.attachRenderer(
      new FakeRenderer("canvas"),
      document.createElement("div"),
    );

    const tui = new FakeRenderer("tui");
    session.attachRenderer(tui, document.createElement("div"));
    tui.emit({ matchId: "m1", basedOnVersion: 1, type: "pass", payload: null });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
