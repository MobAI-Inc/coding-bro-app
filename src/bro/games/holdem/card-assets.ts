import type { PokerCard } from "./logic";
import {
  playingCardAssetUrl,
  playingCardBackUrl,
  playingCardLabel,
} from "../core/playing-card-assets";

export function pokerCardAssetUrl(card: PokerCard): string {
  return playingCardAssetUrl(card);
}

export function pokerCardBackUrl(): string {
  return playingCardBackUrl();
}

export function pokerCardLabel(card: PokerCard): string {
  return playingCardLabel(card);
}
