import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  LocalMatchmaking,
  MatchmakingStage,
} from "@/bro/games/core/LocalMatchmaking";
import type { MatchmakingSnapshot } from "@/bro/games/core/matchmaking";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("本地匹配界面", () => {
  it("在游戏场景内播报等待、展示席位并允许取消", () => {
    vi.useFakeTimers();
    render(
      <LocalMatchmaking gameId="billiards" seatCount={2} fillDelayMs={500}>
        {() => <div>球桌已挂载</div>}
      </LocalMatchmaking>,
    );

    expect(screen.getByText("正在为你组桌")).toBeInTheDocument();
    expect(screen.getByText("你的席位")).toBeInTheDocument();
    expect(screen.getByText("正在寻找")).toBeInTheDocument();
    expect(screen.queryByText("球桌已挂载")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消匹配" }));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("已停止匹配")).toBeInTheDocument();
    expect(screen.queryByText("球桌已挂载")).not.toBeInTheDocument();
  });

  it("超时后隐式补齐席位并挂载对局", () => {
    vi.useFakeTimers();
    render(
      <LocalMatchmaking
        gameId="holdem"
        seatCount={3}
        playerNames={["甲", "乙"]}
        fillDelayMs={400}
      >
        {(match) => <div>对局 {match.matchId}</div>}
      </LocalMatchmaking>,
    );

    act(() => vi.advanceTimersByTime(400));
    expect(screen.getAllByText("甲")).toHaveLength(2);
    expect(screen.getAllByText("乙")).toHaveLength(2);
    expect(screen.getByText(/对局 local-demo-holdem/)).toBeInTheDocument();
    expect(screen.queryByText(/AI|Bot|电脑|补位|本地陪练/i)).toBeNull();
    expect(screen.getByText("牌桌已连接 · 对局进行中")).toBeInTheDocument();
    expect(screen.getByLabelText("匹配与席位状态")).toBeInTheDocument();
    expect(
      screen.getByText(/对局 local-demo-holdem/).parentElement,
    ).not.toHaveAttribute("aria-hidden");
  });

  it("在线异常时提供重连和快速开始", () => {
    const onRetry = vi.fn();
    const onLocalFallback = vi.fn();
    render(
      <MatchmakingStage
        snapshot={snapshot({
          phase: "error",
          source: "nakama",
          error: "对局服务暂时不可用",
        })}
        onCancel={vi.fn()}
        onRetry={onRetry}
        onLocalFallback={onLocalFallback}
      >
        <div>牌桌背景</div>
      </MatchmakingStage>,
    );

    expect(screen.getByText("连接异常")).toBeInTheDocument();
    expect(screen.getByText("暂时无法加入线上队列")).toBeInTheDocument();
    expect(screen.getByText("对局服务暂时不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    fireEvent.click(screen.getByRole("button", { name: "快速开始" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onLocalFallback).toHaveBeenCalledOnce();
  });

  it("展示真实等待时长、自然的组桌阶段和进度", () => {
    vi.useFakeTimers();
    render(
      <MatchmakingStage
        snapshot={snapshot({ phase: "searching", source: "nakama" })}
        fillDelayMs={500}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onLocalFallback={vi.fn()}
      >
        <div>牌桌背景</div>
      </MatchmakingStage>,
    );

    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.getByText("正在搜寻空闲牌桌")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    act(() => vi.advanceTimersByTime(3_250));
    expect(screen.getByText("00:03")).toBeInTheDocument();
    expect(screen.getByText("正在确认同桌席位")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "41",
    );
  });

  it("匹配完成后收起浮层并只展示普通玩家席位", () => {
    render(
      <MatchmakingStage
        snapshot={snapshot({
          phase: "matched",
          source: "nakama",
          matchId: "match-42",
          seats: [
            { seat: 0, kind: "player", name: "bro_me (YOU)", isSelf: true },
            { seat: 1, kind: "player", name: "同桌玩家", isSelf: false },
          ],
        })}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onLocalFallback={vi.fn()}
      >
        <div>牌桌已就绪</div>
      </MatchmakingStage>,
    );

    expect(screen.getByLabelText("匹配与席位状态")).toBeInTheDocument();
    expect(screen.getAllByText("对局已就绪")).toHaveLength(2);
    expect(screen.getAllByText("同桌玩家").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("牌桌已连接 · 对局进行中")).toBeInTheDocument();
    expect(screen.queryByText(/真人|AI|Bot|电脑|补位|本地陪练/i)).toBeNull();
  });
});

function snapshot(
  overrides: Partial<MatchmakingSnapshot>,
): MatchmakingSnapshot {
  return {
    phase: "searching",
    gameId: "baccarat",
    ticketId: "ticket-1",
    matchId: null,
    source: "nakama",
    seats: [
      { seat: 0, kind: "player", name: "YOU", isSelf: true },
      { seat: 1, kind: "open", name: "等待玩家", isSelf: false },
    ],
    error: null,
    serverState: null,
    sendAction: null,
    ...overrides,
  };
}
