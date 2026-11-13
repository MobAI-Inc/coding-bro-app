import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACCARAT_DEAL_DURATION_MS,
  AuthoritativeBaccaratTable,
  BaccaratGame,
  chooseBaccaratTableBet,
  settleBaccarat,
} from "@/bro/games/baccarat/BaccaratGame";
import type { MatchmakingSnapshot } from "@/bro/games/core/matchmaking";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("百家乐筹码结算", () => {
  it("补位席位按 95% 策略质量选择低优势主注，不碰和局", () => {
    expect(chooseBaccaratTableBet(() => 0)).toBe("庄");
    expect(chooseBaccaratTableBet(() => 0.949)).toBe("庄");
    expect(chooseBaccaratTableBet(() => 0.95)).toBe("闲");
    expect(chooseBaccaratTableBet(() => 0.999)).toBe("闲");
  });

  it("房间配置决定牌桌名、初始筹码和下注档位", () => {
    vi.useFakeTimers();
    render(
      <BaccaratGame
        matchmakingDelayMs={0}
        room={{
          id: "test-room",
          name: "测试高额厅",
          initialBalance: 600,
          stakeOptions: [30, 75, 150],
        }}
      />,
    );
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByText("测试高额厅")).toBeInTheDocument();
    expect(screen.getByLabelText("当前筹码余额")).toHaveTextContent("600");
    expect(screen.getByRole("button", { name: "30" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "闲家，净赢 1 : 1" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "庄家，净赢 0.95 : 1" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "和局，净赢 8 : 1" }),
    ).toBeVisible();
    expect(
      screen.getByText("庄赢收取 5% 佣金", { exact: false }),
    ).toBeVisible();
  });

  it("覆盖闲、庄、和赔率以及主注遇和退回本金", () => {
    expect(settleBaccarat("闲", "闲", 10)).toEqual({ payout: 20, net: 10 });
    expect(settleBaccarat("庄", "庄", 10)).toEqual({
      payout: 19.5,
      net: 9.5,
    });
    expect(settleBaccarat("和", "和", 10)).toEqual({ payout: 90, net: 80 });
    expect(settleBaccarat("庄", "闲", 10)).toEqual({ payout: 0, net: -10 });
    expect(settleBaccarat("和", "闲", 10)).toEqual({ payout: 10, net: 0 });
  });

  it("下注时先扣筹码，开牌后显示净盈亏并连续记账", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.8);
    const onSettle = vi.fn();
    render(<BaccaratGame onSettle={onSettle} />);
    act(() => vi.advanceTimersByTime(900));

    fireEvent.click(screen.getByRole("button", { name: /闲家，净赢 1 : 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /下注 10 · 发牌/ }));
    expect(screen.getByLabelText("当前筹码余额")).toHaveTextContent("190");
    expect(
      screen.getByRole("timer", { name: /封盘倒计时剩余 3 秒/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /等待封盘/ })).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "百家乐牌桌" }),
    ).toHaveTextContent("已开 0 张");

    act(() => vi.advanceTimersByTime(BACCARAT_DEAL_DURATION_MS));
    expect(screen.getByRole("status")).toHaveTextContent("本局 +10");
    expect(screen.getByLabelText("当前筹码余额")).toHaveTextContent("210");
    expect(screen.getByLabelText("连续战绩")).toHaveTextContent("押闲 10");
    expect(screen.getByLabelText("连续战绩")).toHaveTextContent("余额 210");
    expect(onSettle).toHaveBeenCalledWith(10);

    fireEvent.click(screen.getByRole("button", { name: /下注 10 · 发牌/ }));
    act(() => vi.advanceTimersByTime(BACCARAT_DEAL_DURATION_MS));
    expect(screen.getByLabelText("连续战绩")).toHaveTextContent("已完成 2 局");
    expect(screen.getAllByText("押闲 10")).toHaveLength(2);
  });

  it("云端牌桌只发送下注意图，倒计时和投入来自服务端", async () => {
    const sendAction = vi.fn().mockResolvedValue(undefined);
    const match: MatchmakingSnapshot = {
      phase: "matched",
      gameId: "baccarat",
      ticketId: null,
      matchId: "match-1",
      source: "nakama-hosted",
      seats: [
        { seat: 0, kind: "player", name: "YOU", isSelf: true },
        { seat: 1, kind: "player", name: "林舟", isSelf: false },
      ],
      error: null,
      serverState: {
        schemaVersion: 1,
        gameId: "baccarat",
        matchId: "match-1",
        version: 3,
        roundId: 1,
        phase: "betting",
        phaseEndsInMs: 7_400,
        selfSeat: 0,
        seats: [
          {
            seat: 0,
            name: "coding",
            connected: true,
            balance: 30,
            bet: null,
            lastResult: null,
            settlementState: "pending",
          },
          {
            seat: 1,
            name: "林舟",
            connected: true,
            balance: 200,
            bet: null,
            lastResult: null,
            settlementState: null,
          },
        ],
        round: null,
        road: [],
      },
      sendAction,
    };

    render(
      <AuthoritativeBaccaratTable
        entryPoints={30}
        match={match}
        room={{
          id: "baccarat-salon",
          name: "霁光厅",
          initialBalance: 200,
          stakeOptions: [10, 25, 50],
        }}
      />,
    );
    expect(screen.getByRole("timer")).toHaveAccessibleName(/决策倒计时/);
    expect(screen.getByLabelText("本局入场积分")).toHaveTextContent("30");
    fireEvent.click(screen.getByRole("button", { name: /和局/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认下注 30" }));

    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith(1, { side: "tie" }),
    );
  });
});
