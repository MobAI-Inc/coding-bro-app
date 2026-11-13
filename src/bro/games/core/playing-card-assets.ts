const KENNEY_CARD_IMAGES = import.meta.glob(
  "../../../assets/games/kenney-playing-cards/*.png",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

const OPENDECKS_CARD_IMAGES = import.meta.glob(
  "../../../assets/games/opendecks-svg/*.svg",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

export type PlayingCardDeck = "opendecks-svg" | "kenney-png";

/** 高清矢量牌组为默认值；Kenney PNG 保留为显式回退。 */
export const DEFAULT_PLAYING_CARD_DECK: PlayingCardDeck = "opendecks-svg";

export type PlayingCardSuit = "S" | "H" | "C" | "D" | "♠" | "♥" | "♣" | "♦";

export type PlayingCardRank =
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

const SUIT_NAMES: Record<PlayingCardSuit, string> = {
  S: "spades",
  H: "hearts",
  C: "clubs",
  D: "diamonds",
  "♠": "spades",
  "♥": "hearts",
  "♣": "clubs",
  "♦": "diamonds",
};

const SUIT_LABELS: Record<PlayingCardSuit, string> = {
  S: "黑桃",
  H: "红桃",
  C: "梅花",
  D: "方块",
  "♠": "黑桃",
  "♥": "红桃",
  "♣": "梅花",
  "♦": "方块",
};

const RANK_NAMES: Record<string, string> = {
  "2": "02",
  "3": "03",
  "4": "04",
  "5": "05",
  "6": "06",
  "7": "07",
  "8": "08",
  "9": "09",
  "10": "10",
  "11": "J",
  "12": "Q",
  "13": "K",
  "14": "A",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

const OPENDECKS_RANK_NAMES: Record<string, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  "11": "jack",
  "12": "queen",
  "13": "king",
  "14": "ace",
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
};

const RANK_LABELS: Record<string, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  "11": "J",
  "12": "Q",
  "13": "K",
  "14": "A",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

function resolve(
  images: Readonly<Record<string, string>>,
  filename: string,
  deck: PlayingCardDeck,
): string {
  const entry = Object.entries(images).find(([path]) =>
    path.endsWith(`/${filename}`),
  );
  if (!entry) throw new Error(`Missing ${deck} card asset: ${filename}`);
  return entry[1];
}

export function playingCardAssetUrl(
  card: {
    readonly suit: PlayingCardSuit;
    readonly rank: PlayingCardRank;
  },
  deck: PlayingCardDeck = DEFAULT_PLAYING_CARD_DECK,
): string {
  if (deck === "kenney-png") {
    return resolve(
      KENNEY_CARD_IMAGES,
      `card_${SUIT_NAMES[card.suit]}_${RANK_NAMES[String(card.rank)]}.png`,
      deck,
    );
  }
  return resolve(
    OPENDECKS_CARD_IMAGES,
    `${SUIT_NAMES[card.suit]}-${OPENDECKS_RANK_NAMES[String(card.rank)]}.svg`,
    deck,
  );
}

export function playingCardBackUrl(
  deck: PlayingCardDeck = DEFAULT_PLAYING_CARD_DECK,
): string {
  return deck === "kenney-png"
    ? resolve(KENNEY_CARD_IMAGES, "card_back.png", deck)
    : resolve(OPENDECKS_CARD_IMAGES, "back-blue.svg", deck);
}

export function playingCardLabel(card: {
  readonly suit: PlayingCardSuit;
  readonly rank: PlayingCardRank;
}): string {
  return `${SUIT_LABELS[card.suit]} ${RANK_LABELS[String(card.rank)] ?? card.rank}`;
}
