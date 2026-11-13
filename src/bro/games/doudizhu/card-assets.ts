import type { Card } from "./logic";

const CARD_IMAGES = import.meta.glob(
  "../../../assets/games/kenney-playing-cards/*.png",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

const SUIT_NAMES = {
  S: "spades",
  H: "hearts",
  C: "clubs",
  D: "diamonds",
} as const;

const SUIT_LABELS = {
  S: "黑桃",
  H: "红桃",
  C: "梅花",
  D: "方块",
} as const;

const RANK_NAMES: Record<number, string> = {
  3: "03",
  4: "04",
  5: "05",
  6: "06",
  7: "07",
  8: "08",
  9: "09",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "02",
};

const RANK_LABELS: Record<number, string> = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "2",
};

/** Pure filename mapping, kept separate so the 54-card deck can be unit-tested. */
export function cardAssetFilename(card: Card): string {
  if (card.rank === 16) return "card_joker_black.png";
  if (card.rank === 17) return "card_joker_red.png";
  if (!card.suit || !RANK_NAMES[card.rank]) {
    throw new Error(`Unsupported card: ${card.id}`);
  }
  return `card_${SUIT_NAMES[card.suit]}_${RANK_NAMES[card.rank]}.png`;
}

export function cardAssetUrl(card: Card): string {
  const filename = cardAssetFilename(card);
  const entry = Object.entries(CARD_IMAGES).find(([path]) =>
    path.endsWith(`/${filename}`),
  );
  if (!entry) throw new Error(`Missing Kenney card asset: ${filename}`);
  return entry[1];
}

export function cardAccessibleLabel(card: Card): string {
  if (card.rank === 16) return "小王";
  if (card.rank === 17) return "大王";
  if (!card.suit || !RANK_LABELS[card.rank]) return "未知牌";
  return `${SUIT_LABELS[card.suit]} ${RANK_LABELS[card.rank]}`;
}
