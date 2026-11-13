import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CircleDot,
  Gem,
  Grid3X3,
  Layers3,
  Pickaxe,
  Radio,
  Spade,
} from "lucide-react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { balanceOf } from "../points/types";
import type { LedgerEntry } from "../points/types";
import { GAME_CATALOG, isEnterable } from "./catalog";
import type { GameEntry, GameId } from "./catalog";
import "./lobby.css";

type EntryState = "ready" | "poor" | "unbuilt";

function entryState(entry: GameEntry, balance: number): EntryState {
  if (!isEnterable(entry)) return "unbuilt";
  return balance >= entry.price ? "ready" : "poor";
}

const STATUS_NOTE: Record<EntryState, string> = {
  ready: "AVAILABLE",
  poor: "积分不足",
  unbuilt: "建设中",
};

const GAME_ART = {
  baccarat: {
    number: "01",
    label: "LIVE TABLE",
    icon: Layers3,
    tone: "ruby",
    mark: "B",
    detail: "PLAYER / BANKER / TIE",
  },
  slots: {
    number: "02",
    label: "SOLO RUN",
    icon: Gem,
    tone: "amber",
    mark: "777",
    detail: "SPIN / MATCH / SCORE",
  },
  holdem: {
    number: "03",
    label: "LIVE TABLE",
    icon: Spade,
    tone: "ruby",
    mark: "♠",
    detail: "BLIND / RAISE / SHOWDOWN",
  },
  match3: {
    number: "04",
    label: "SOLO RUN",
    icon: Grid3X3,
    tone: "violet",
    mark: "◇",
    detail: "SWAP / CHAIN / CLEAR",
  },
  blackjack: {
    number: "05",
    label: "LIVE TABLE",
    icon: CircleDot,
    tone: "teal",
    mark: "21",
    detail: "HIT / STAND / DOUBLE",
  },
  "gold-miner": {
    number: "06",
    label: "SOLO RUN",
    icon: Pickaxe,
    tone: "gold",
    mark: "AU",
    detail: "AIM / GRAB / HAUL",
  },
} as const;

export interface GameLobbyProps {
  readonly ledger: readonly LedgerEntry[];
  readonly onEnter: (id: GameId) => void;
  readonly catalog?: readonly GameEntry[];
}

interface Row {
  readonly entry: GameEntry;
  readonly state: EntryState;
}

interface LobbyProps {
  readonly rows: readonly Row[];
  readonly balance: number;
  readonly onEnter: (id: GameId) => void;
}

export function GameLobby({
  ledger,
  onEnter,
  catalog = GAME_CATALOG,
}: GameLobbyProps) {
  const isDark = useDarkMode();
  const balance = useMemo(() => balanceOf(ledger), [ledger]);
  const rows = catalog.map((entry) => ({
    entry,
    state: entryState(entry, balance),
  }));

  return isDark ? (
    <TuiLobby rows={rows} balance={balance} onEnter={onEnter} />
  ) : (
    <GlassLobby rows={rows} balance={balance} onEnter={onEnter} />
  );
}

function BrandHero({
  balance,
  dark = false,
}: {
  balance: number;
  dark?: boolean;
}) {
  return (
    <header className="bro-after-hours" data-terminal={dark ? "" : undefined}>
      <div className="bro-after-hours__copy">
        <p className="bro-after-hours__eyebrow">
          <span className="bro-after-hours__signal" aria-hidden="true" />
          Coding Bro / After Hours
        </p>
        <h1>
          今晚，<span>开一局。</span>
        </h1>
        <p className="bro-after-hours__lede">
          入座实时牌桌，或开启一段无尽挑战。积分入场、按结果结算；打得好，
          积分就能越玩越多。
        </p>
        <div className="bro-after-hours__ticker" aria-label="大厅概览">
          <span>06 GAMES</span>
          <span>03 LIVE TABLES</span>
          <span>03 SOLO RUNS</span>
        </div>
      </div>
      <div className="bro-after-hours__wallet">
        {dark ? (
          <>
            <span className="bro-after-hours__wallet-label">
              AVAILABLE POINTS
            </span>
            <strong className="bro-tabular">{balance}</strong>
            <span className="bro-after-hours__wallet-note">
              SKILL SETTLED / NO BALANCE CAP
            </span>
          </>
        ) : (
          <>
            <span className="bro-after-hours__wallet-label">
              AVAILABLE POINTS
            </span>
            <strong className="bro-tabular">{balance}</strong>
            <span className="bro-after-hours__wallet-note">
              每局入场前确认 · 按结果结算 · 余额不设上限
            </span>
          </>
        )}
      </div>
    </header>
  );
}

function GlassLobby({ rows, balance, onEnter }: LobbyProps) {
  return (
    <main className="bro-lobby">
      <BrandHero balance={balance} />
      <div className="bro-lobby__section-head">
        <div>
          <span>CHOOSE YOUR TABLE</span>
          <h2>六款游戏，直接开玩</h2>
        </div>
        <p>牌桌有节奏，单机有进度</p>
      </div>

      <ul className="bro-lobby__grid">
        {rows.map(({ entry, state }) => {
          const art = GAME_ART[entry.id];
          return (
            <li key={entry.id}>
              <button
                type="button"
                className="bro-lobby__card"
                data-tone={art.tone}
                disabled={state !== "ready"}
                onClick={() => onEnter(entry.id)}
                aria-label={
                  state === "ready"
                    ? `进入${entry.name}，${entry.price} 积分`
                    : `${entry.name}，${STATUS_NOTE[state]}`
                }
              >
                <GameCover entry={entry} state={state} />
                <span className="bro-lobby__body">
                  <span className="bro-lobby__kicker">
                    {art.label} <i aria-hidden="true">/</i> {art.number}
                  </span>
                  <span className="bro-lobby__name">{entry.name}</span>
                  <span className="bro-lobby__blurb">{entry.blurb}</span>
                  <span className="bro-lobby__foot">
                    <span className="bro-lobby__price bro-tabular">
                      {entry.price} 积分{entry.rooms ? " 起" : ""}
                    </span>
                    {state === "ready" ? (
                      <span className="bro-lobby__enter">
                        进入 <ArrowUpRight size={15} aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="bro-lobby__note">
                        {STATUS_NOTE[state]}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function GameCover({ entry, state }: Row) {
  const art = GAME_ART[entry.id];
  const Icon = art.icon;
  return (
    <span className="bro-game-cover" aria-hidden="true">
      <span className="bro-game-cover__wash" />
      <span className="bro-game-cover__grid" />
      <span className="bro-game-cover__number">{art.number}</span>
      <span className="bro-game-cover__icon">
        <Icon size={18} strokeWidth={1.5} />
      </span>
      <span className="bro-game-cover__mark">{art.mark}</span>
      <span className="bro-game-cover__detail">{art.detail}</span>
      <span className="bro-game-cover__status">
        <i /> {state === "ready" ? STATUS_NOTE[state] : "LOCKED"}
      </span>
    </span>
  );
}

function TuiLobby({ rows, balance, onEnter }: LobbyProps) {
  const [cursor, setCursor] = useState(0);
  const current = rows[cursor];

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (current?.state === "ready") onEnter(current.entry.id);
    }
  };

  return (
    <main className="tui bro-lobby-tui">
      <BrandHero balance={balance} dark />
      <div className="bro-lobby-tui__command" aria-hidden="true">
        <span>after-hours@coding-bro:~/arcade</span>
        <span>session=open</span>
      </div>
      <div className="bro-lobby-tui__head">
        <span>
          <Radio size={13} aria-hidden="true" /> CABINET / SELECT GAME
        </span>
        <span>
          POINTS <b className="bro-tabular">{balance}</b> <small>PT</small>
        </span>
      </div>

      <ul
        className="bro-lobby-tui__list"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="游戏列表"
      >
        {rows.map(({ entry, state }, index) => {
          const art = GAME_ART[entry.id];
          return (
            <li
              key={entry.id}
              className="bro-lobby-tui__row"
              data-tone={art.tone}
              aria-current={index === cursor ? "true" : undefined}
              aria-disabled={state !== "ready"}
              data-selected={index === cursor ? "" : undefined}
              data-locked={state !== "ready" ? "" : undefined}
              onMouseEnter={() => setCursor(index)}
              onClick={() => state === "ready" && onEnter(entry.id)}
            >
              <span className="bro-lobby-tui__rail" aria-hidden="true">
                <span className="bro-lobby-tui__caret">
                  {index === cursor ? "›" : " "}
                </span>
                <span>{art.number}</span>
              </span>
              <GameCover entry={entry} state={state} />
              <span className="bro-lobby-tui__body">
                <span className="bro-lobby-tui__meta">
                  <span>{art.label}</span>
                  <span>
                    {state === "ready" ? STATUS_NOTE[state] : "LOCKED"}
                  </span>
                </span>
                <span className="bro-lobby-tui__name">{entry.name}</span>
                <span className="bro-lobby-tui__blurb">{entry.blurb}</span>
                <span className="bro-lobby-tui__foot">
                  <span>{art.detail}</span>
                  <span className="bro-lobby-tui__price bro-tabular">
                    {entry.price}
                    {entry.rooms ? " 起" : ""}
                  </span>
                  {state !== "ready" && (
                    <span className="bro-lobby-tui__note">
                      {STATUS_NOTE[state]}
                    </span>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="bro-lobby-tui__status">
        <span>
          {current?.state === "ready"
            ? "jk/方向键 选择 · Enter 进入"
            : "jk/方向键 选择"}
        </span>
        <span>CODING BRO AFTER HOURS / {current?.entry.name ?? "IDLE"}</span>
      </div>
    </main>
  );
}
