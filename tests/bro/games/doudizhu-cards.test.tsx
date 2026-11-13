import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardAccessibleLabel,
  cardAssetFilename,
} from "@/bro/games/doudizhu/card-assets";
import { DoudizhuGame } from "@/bro/games/doudizhu/DoudizhuGame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("斗地主实体牌面", () => {
  it("把普通牌、2 和双王映射到 Kenney CC0 素材", () => {
    expect(cardAssetFilename({ id: "s3", rank: 3, suit: "S" })).toBe(
      "card_spades_03.png",
    );
    expect(cardAssetFilename({ id: "ha", rank: 14, suit: "H" })).toBe(
      "card_hearts_A.png",
    );
    expect(cardAssetFilename({ id: "d2", rank: 15, suit: "D" })).toBe(
      "card_diamonds_02.png",
    );
    expect(cardAssetFilename({ id: "sj", rank: 16, suit: null })).toBe(
      "card_joker_black.png",
    );
    expect(cardAssetFilename({ id: "bj", rank: 17, suit: null })).toBe(
      "card_joker_red.png",
    );
    expect(cardAccessibleLabel({ id: "ha", rank: 14, suit: "H" })).toBe(
      "红桃 A",
    );
  });

  it("在牌桌底部展示完整图片手牌，并支持点击上浮选择", () => {
    vi.useFakeTimers();
    render(<DoudizhuGame seed={7} botDelayMs={0} />);
    act(() => vi.advanceTimersByTime(900));

    const hand = screen.getByLabelText("我的手牌");
    const cards = hand.querySelectorAll<HTMLButtonElement>("button");
    expect(cards.length).toBeGreaterThanOrEqual(17);
    expect(hand.querySelectorAll("img")).toHaveLength(cards.length);
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(cards[0]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    expect(cards[0]).toHaveClass("is-selected");
  });
});
