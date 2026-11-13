import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  INITIAL_SESSION_BALANCE,
  JACKPOT_COUNT_MS,
  JACKPOT_PRESENTATION_MS,
  REEL_STOP_MS,
  SLOT_CONFIG,
  SLOT_SYMBOLS,
  SPIN_COST,
  SPIN_DURATION_MS,
  SlotsGame,
  settleSpin,
} from "@/bro/games/slots/SlotsGame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function readSessionMetric(label: string): number {
  const session = screen.getByLabelText("老虎机会话数据");
  const labelNode = within(session).getByText(label, { selector: "span" });
  const value = labelNode.parentElement?.querySelector("strong")?.textContent;
  if (value == null) throw new Error(`找不到会话指标：${label}`);
  return Number(value.replace("+", ""));
}

function finishSpin(): void {
  act(() => vi.advanceTimersByTime(SPIN_DURATION_MS));
}

describe("老虎机结算规则", () => {
  it("每次成本为 10，三同派彩 120、两同派彩 20、其他派彩 0", () => {
    expect(SPIN_COST).toBe(10);
    expect(settleSpin(["SEVEN", "SEVEN", "SEVEN"])).toMatchObject({
      payout: 120,
      net: 110,
    });
    expect(settleSpin(["SEVEN", "SEVEN", "BAR"])).toMatchObject({
      payout: 20,
      net: 10,
    });
    expect(settleSpin(["SEVEN", "BAR", "DIAMOND"])).toMatchObject({
      payout: 0,
      net: -10,
    });
  });

  it("8 个等概率符号下大奖率为 1/64，理论 RTP 为 84.375%", () => {
    expect(SLOT_CONFIG.symbols).toBe(SLOT_SYMBOLS);
    expect(SLOT_SYMBOLS).toHaveLength(8);
    expect(new Set(SLOT_SYMBOLS).size).toBe(8);

    const outcomes = SLOT_SYMBOLS.flatMap((first) =>
      SLOT_SYMBOLS.flatMap((second) =>
        SLOT_SYMBOLS.map((third) => settleSpin([first, second, third])),
      ),
    );
    const jackpotCount = outcomes.filter(
      (outcome) => outcome.label === "JACKPOT",
    ).length;
    const pairCount = outcomes.filter(
      (outcome) => outcome.label === "两枚同款",
    ).length;
    const expectedPayout =
      outcomes.reduce((sum, outcome) => sum + outcome.payout, 0) /
      outcomes.length;

    expect(outcomes).toHaveLength(8 ** 3);
    expect(jackpotCount).toBe(8);
    expect(pairCount).toBe(168);
    expect(jackpotCount / outcomes.length).toBe(1 / 64);
    expect(expectedPayout).toBeCloseTo(8.4375, 6);
    expect(expectedPayout / SPIN_COST).toBeCloseTo(0.84375, 6);
  });
});

describe("老虎机连续会话", () => {
  it("不再展示关卡，并持续展示余额、会话净盈亏、成本和奖表", () => {
    render(<SlotsGame />);

    expect(screen.queryByText(/第\s*\d+\s*关/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LEVEL\s*\d+/i)).not.toBeInTheDocument();
    expect(readSessionMetric("会话余额")).toBe(INITIAL_SESSION_BALANCE);
    expect(readSessionMetric("净盈亏")).toBe(0);
    expect(readSessionMetric("单次成本")).toBe(10);
    expect(screen.getByText(/8 种符号 ·\s*每次 10 积分/)).toBeInTheDocument();

    const paytable = screen.getByLabelText("奖表");
    expect(paytable).toHaveTextContent(/任意三同\s*120/);
    expect(paytable).toHaveTextContent(/任意两同\s*20/);
    expect(paytable).toHaveTextContent(/其他组合\s*0/);
    expect(screen.getByLabelText("老虎机规则摘要")).toHaveTextContent(
      "8 SYMBOLS10 POINTS / SPINJACKPOT 1 / 64",
    );

    const firstTrack = document.querySelector(
      ".bro-slots__reel:first-child .bro-slots__reel-track",
    );
    expect(firstTrack?.children).toHaveLength(24);
    expect(
      new Set(
        Array.from(firstTrack?.children ?? [])
          .slice(0, 8)
          .map((symbol) => symbol.textContent),
      ).size,
    ).toBe(8);
  });

  it("滚轴转动期间禁用按钮，完成后可立即继续 spin", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const onSettle = vi.fn();
    render(<SlotsGame onSettle={onSettle} />);

    const spin = screen.getByRole("button", { name: /SPIN/ });
    fireEvent.click(spin);
    expect(spin).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("滚轴转动中");

    fireEvent.click(spin);
    finishSpin();
    expect(spin).toBeDisabled();
    expect(
      screen.getByText("JACKPOT · 派彩 120 积分 · 净赢 110", {
        selector: "#bro-slots-result",
      }),
    ).toBeInTheDocument();
    expect(readSessionMetric("会话余额")).toBe(INITIAL_SESSION_BALANCE + 110);
    expect(readSessionMetric("净盈亏")).toBe(110);
    expect(readSessionMetric("已转")).toBe(1);
    expect(
      screen.getByRole("dialog", { name: "大奖触发" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /跳过演出/ }));
    expect(spin).toBeEnabled();

    fireEvent.click(spin);
    finishSpin();
    expect(spin).toBeDisabled();
    expect(readSessionMetric("会话余额")).toBe(INITIAL_SESSION_BALANCE + 220);
    expect(readSessionMetric("净盈亏")).toBe(220);
    expect(readSessionMetric("已转")).toBe(2);
    expect(onSettle).toHaveBeenNthCalledWith(1, 110);
    expect(onSettle).toHaveBeenNthCalledWith(2, 110);
    fireEvent.click(screen.getByRole("button", { name: /跳过演出/ }));
    expect(spin).toBeEnabled();
  });

  it("逐列停靠并在前两轴相同时进入大奖预兆", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<SlotsGame />);

    fireEvent.click(screen.getByRole("button", { name: /SPIN/ }));
    expect(screen.getByLabelText("第 1 轴转动中")).toBeInTheDocument();
    expect(screen.getByLabelText("第 2 轴转动中")).toBeInTheDocument();
    expect(screen.getByLabelText("第 3 轴转动中")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(REEL_STOP_MS[0]));
    expect(screen.getByLabelText("第 1 轴停在 7")).toBeInTheDocument();
    expect(screen.getByLabelText("第 2 轴转动中")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(REEL_STOP_MS[1] - REEL_STOP_MS[0]));
    expect(screen.getByLabelText("第 2 轴停在 7")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("进入大奖预兆");
    expect(screen.getByText(/JACKPOT WATCH/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(REEL_STOP_MS[2] - REEL_STOP_MS[1]));
    expect(screen.getByLabelText("第 3 轴停在 7")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在结算");
  });

  it("大奖触发全屏演出、计数增长，并支持跳过和自动收束", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<SlotsGame />);

    const spin = screen.getByRole("button", { name: /SPIN/ });
    fireEvent.click(spin);
    finishSpin();

    const dialog = screen.getByRole("dialog", { name: "大奖触发" });
    expect(dialog).toHaveTextContent("三枚符号命中同一中奖线");
    expect(dialog).toHaveTextContent("本轮净赢 +110");
    expect(screen.getByRole("button", { name: /跳过演出/ })).toHaveFocus();
    expect(spin).toBeDisabled();

    act(() => vi.advanceTimersByTime(JACKPOT_COUNT_MS + 50));
    expect(
      screen.getByLabelText("大奖派彩 120 积分，净赢 110 积分"),
    ).toHaveTextContent("120");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "大奖触发" })).toBeNull();
    expect(spin).toHaveFocus();

    fireEvent.click(spin);
    finishSpin();
    expect(
      screen.getByRole("dialog", { name: "大奖触发" }),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(JACKPOT_PRESENTATION_MS));
    expect(screen.queryByRole("dialog", { name: "大奖触发" })).toBeNull();
    expect(spin).toHaveFocus();
  });

  it("声音开关用可见状态和 pressed 状态反馈", () => {
    render(<SlotsGame />);

    const sound = screen.getByRole("button", { name: "关闭游戏声音" });
    expect(sound).toHaveTextContent("SOUND ON");
    expect(sound).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(sound);
    expect(
      screen.getByRole("button", { name: "打开游戏声音" }),
    ).toHaveTextContent("MUTED");
    expect(
      screen.getByRole("button", { name: "打开游戏声音" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("两同仅结算净赢 10，未中奖扣 10 且不调用 onSettle", () => {
    vi.useFakeTimers();
    const randomValues = [0, 0, 0.3, 0, 0.3, 0.6];
    let randomIndex = 0;
    vi.spyOn(Math, "random").mockImplementation(
      () => randomValues[randomIndex++ % randomValues.length],
    );
    const onSettle = vi.fn();
    render(<SlotsGame onSettle={onSettle} />);

    const spin = screen.getByRole("button", { name: /SPIN/ });
    fireEvent.click(spin);
    finishSpin();
    expect(screen.getByRole("status")).toHaveTextContent(
      "两枚同款 · 派彩 20 积分 · 净赢 10",
    );
    expect(onSettle).toHaveBeenCalledOnce();
    expect(onSettle).toHaveBeenCalledWith(10);

    fireEvent.click(spin);
    finishSpin();
    expect(screen.getByRole("status")).toHaveTextContent(
      "未中奖 · 本次净亏 10 积分",
    );
    expect(readSessionMetric("会话余额")).toBe(INITIAL_SESSION_BALANCE);
    expect(readSessionMetric("净盈亏")).toBe(0);
    expect(readSessionMetric("已转")).toBe(2);
    expect(onSettle).toHaveBeenCalledOnce();
  });
});
