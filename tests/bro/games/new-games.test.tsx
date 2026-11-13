import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  BACCARAT_DEAL_DURATION_MS,
  BaccaratGame,
  dealBaccarat,
} from "@/bro/games/baccarat/BaccaratGame";
import type { BaccaratCard } from "@/bro/games/baccarat/BaccaratGame";
import {
  SLOT_CONFIG,
  SPIN_DURATION_MS,
  SlotsGame,
} from "@/bro/games/slots/SlotsGame";
import { GoldMinerGame } from "@/bro/games/gold-miner/GoldMinerGame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("百家乐", () => {
  it("可以选门、开牌并展示积分结算", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.8);
    render(<BaccaratGame />);
    act(() => vi.advanceTimersByTime(900));
    fireEvent.click(screen.getByRole("button", { name: /闲家，净赢 1 : 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /下注 10 · 发牌/ }));
    act(() => vi.advanceTimersByTime(BACCARAT_DEAL_DURATION_MS));
    expect(screen.getByRole("status").textContent).toContain("返还 20 筹码");
  });

  it("按庄家第三张牌表补牌，并使用真实赔率", () => {
    const cards: BaccaratCard[] = [
      { rank: "2", suit: "♠", value: 2 },
      { rank: "3", suit: "♥", value: 3 },
      { rank: "2", suit: "♣", value: 2 },
      { rank: "2", suit: "♦", value: 2 },
      { rank: "8", suit: "♠", value: 8 },
    ];
    const round = dealBaccarat(() => cards.shift()!, "庄");
    expect(round.player).toHaveLength(3);
    expect(round.banker).toHaveLength(2);
    expect(round.winner).toBe("庄");
    expect(round.reward).toBe(19.5);
  });

  it("和局按 8:1 加本金返还 90", () => {
    const cards: BaccaratCard[] = [
      { rank: "4", suit: "♠", value: 4 },
      { rank: "4", suit: "♥", value: 4 },
      { rank: "3", suit: "♣", value: 3 },
      { rank: "5", suit: "♦", value: 5 },
    ];
    expect(dealBaccarat(() => cards.shift()!, "和").reward).toBe(90);
  });
});

describe("老虎机", () => {
  it("三轴同款时产出 jackpot 积分", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<SlotsGame />);
    fireEvent.click(screen.getByRole("button", { name: /SPIN/ }));
    act(() => vi.advanceTimersByTime(SPIN_DURATION_MS));
    expect(screen.getByRole("status").textContent).toContain(
      `${SLOT_CONFIG.jackpotPayout} 积分`,
    );
  });
});

describe("黄金矿工", () => {
  it("提供可访问的 Phaser 游戏画面、抓手控制和状态", () => {
    render(<GoldMinerGame />);
    expect(screen.getByText("矿区勘探简报")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始第 1 关" }));
    expect(
      screen.getByRole("application", { name: "黄金矿工第 1 关游戏画面" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下钩/ })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("点击矿区");
  });
});
