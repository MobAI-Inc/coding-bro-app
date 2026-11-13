import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDemoMatchmaker } from "@/bro/games/core/matchmaking";
import { nakamaMatchKey } from "@/bro/games/core/nakama";

afterEach(() => {
  vi.useRealTimers();
});

describe("本地匹配模拟", () => {
  it("公开场次生成 Nakama 可解析且彼此隔离的匹配 key", () => {
    expect(nakamaMatchKey("blackjack:blackjack-lounge")).toBe(
      "blackjack_blackjack_lounge",
    );
    expect(nakamaMatchKey("blackjack:blackjack-counter")).not.toBe(
      nakamaMatchKey("blackjack:blackjack-lounge"),
    );
  });

  it("先进入等待队列，超时后补足普通玩家席位并创建本地对局", () => {
    vi.useFakeTimers();
    const updates: ReturnType<LocalDemoMatchmaker["snapshot"]>[] = [];
    const queue = new LocalDemoMatchmaker({
      gameId: "holdem",
      seatCount: 3,
      playerNames: ["甲", "乙"],
      fillDelayMs: 500,
      onChange: (snapshot) => updates.push(snapshot),
    });

    queue.start();
    expect(queue.snapshot().phase).toBe("searching");
    expect(queue.snapshot().seats.map((seat) => seat.kind)).toEqual([
      "player",
      "open",
      "open",
    ]);

    vi.advanceTimersByTime(500);
    expect(queue.snapshot().phase).toBe("matched");
    expect(queue.snapshot().source).toBe("local-demo");
    expect(queue.snapshot().matchId).toMatch(/^local-demo-holdem-/);
    expect(queue.snapshot().seats.map((seat) => seat.kind)).toEqual([
      "player",
      "player",
      "player",
    ]);
    expect(updates).toHaveLength(2);
  });

  it("取消后不会在原超时时刻偷偷开局，并可重新排队", () => {
    vi.useFakeTimers();
    const queue = new LocalDemoMatchmaker({
      gameId: "billiards",
      seatCount: 2,
      fillDelayMs: 300,
      onChange: () => undefined,
    });

    queue.start();
    queue.cancel();
    vi.advanceTimersByTime(600);
    expect(queue.snapshot().phase).toBe("cancelled");
    expect(queue.snapshot().matchId).toBeNull();

    queue.start();
    vi.advanceTimersByTime(300);
    expect(queue.snapshot().phase).toBe("matched");
  });

  it("拒绝一人局，保证真人席位之外至少有一个对手席位", () => {
    expect(
      () =>
        new LocalDemoMatchmaker({
          gameId: "bad",
          seatCount: 1,
          onChange: () => undefined,
        }),
    ).toThrow(/at least two seats/);
  });
});
