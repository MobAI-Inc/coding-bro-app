import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldemGame } from "@/bro/games/holdem/HoldemGame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("德扑房间配置", () => {
  it("把场次名、筹码和盲注带进同一张牌桌", () => {
    vi.useFakeTimers();
    render(
      <HoldemGame
        seed={19}
        matchmakingDelayMs={0}
        room={{
          id: "holdem-test",
          name: "测试 Studio 桌",
          startingStack: 1_500,
          smallBlind: 30,
          bigBlind: 60,
          winPoints: 510,
        }}
      />,
    );
    act(() => vi.runOnlyPendingTimers());
    const table = screen.getByRole("region", { name: "德州扑克牌桌" });
    expect(table).toHaveTextContent("测试 Studio 桌");
    expect(table).toHaveTextContent("1470");
    expect(table).toHaveTextContent("1440");
    expect(table).toHaveTextContent("底池");
    expect(table).not.toHaveTextContent(/BOT|AI|POT/);
    expect(screen.getByRole("button", { name: /弃牌/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /跟注/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /加注/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /半池/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /满池/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /全押/ })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "加注筹码" })).toHaveValue("120");
    expect(screen.getByLabelText("我的下注明细")).toHaveTextContent(
      /本轮下注\s*0/,
    );
    expect(
      screen.getByRole("timer", { name: /你的决策剩余 15 秒/ }),
    ).toBeVisible();
  });
});
