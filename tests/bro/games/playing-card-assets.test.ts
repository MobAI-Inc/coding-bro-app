import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYING_CARD_DECK,
  playingCardAssetUrl,
  playingCardBackUrl,
  type PlayingCardRank,
  type PlayingCardSuit,
} from "@/bro/games/core/playing-card-assets";

const SUITS: readonly PlayingCardSuit[] = ["S", "H", "D", "C"];
const RANKS: readonly PlayingCardRank[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

describe("共享实体牌面", () => {
  it("默认使用本地化的 OpenDecks CC0 SVG", () => {
    expect(DEFAULT_PLAYING_CARD_DECK).toBe("opendecks-svg");
    expect(playingCardAssetUrl({ suit: "S", rank: 14 })).toMatch(/\.svg$/);
    expect(playingCardBackUrl()).toMatch(/\.svg$/);
  });

  it("52 张标准牌全部能解析到 SVG", () => {
    const urls = SUITS.flatMap((suit) =>
      RANKS.map((rank) => playingCardAssetUrl({ suit, rank })),
    );
    expect(urls).toHaveLength(52);
    expect(new Set(urls).size).toBe(52);
    expect(urls.every((url) => url.endsWith(".svg"))).toBe(true);
  });

  it("Kenney PNG 仍可显式选用，避免共享切换无法回退", () => {
    expect(
      playingCardAssetUrl({ suit: "♥", rank: "Q" }, "kenney-png"),
    ).toMatch(/\.png$/);
    expect(playingCardBackUrl("kenney-png")).toMatch(/\.png$/);
  });
});
