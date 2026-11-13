import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOLDEM_ROOM, HoldemGame } from "@/bro/games/holdem/HoldemGame";
import type { MatchmakingSnapshot } from "@/bro/games/core/matchmaking";
import type { GameRealtimeAccess } from "@/bro/games/core/realtime";

interface MatchmakingHarnessProps {
  readonly gameId: string;
  readonly roomId?: string;
  readonly realtime?: GameRealtimeAccess | null;
  readonly children: (match: MatchmakingSnapshot) => ReactNode;
}

const harness = vi.hoisted(() => ({
  match: null as MatchmakingSnapshot | null,
  props: null as MatchmakingHarnessProps | null,
}));

vi.mock("@/bro/games/core/LocalMatchmaking", () => ({
  LocalMatchmaking: (props: MatchmakingHarnessProps) => {
    harness.props = props;
    return props.children(harness.match!);
  },
}));

vi.mock("@/bro/games/core/audio", () => ({
  playArcadeCue: vi.fn(),
}));

afterEach(() => {
  harness.match = null;
  harness.props = null;
  vi.clearAllMocks();
});

describe("HoldemGame 云端权威牌桌", () => {
  it("只发送 OP1 行动，并只按服务端结算刷新账本", async () => {
    const sendAction = vi.fn().mockResolvedValue(undefined);
    const onSettle = vi.fn();
    const onServerSettled = vi.fn();
    const realtime: GameRealtimeAccess = {
      endpoint: "ws://127.0.0.1:7350",
      serverKey: "server-key",
      token: "token",
      refreshToken: null,
      expiresAt: "2026-09-01T12:00:00.000Z",
      joinTicket: "join-ticket",
    };
    const playingState = serverState();
    harness.match = matchWith(playingState, sendAction);

    const view = () => (
      <HoldemGame
        entryPoints={60}
        onServerSettled={onServerSettled}
        onSettle={onSettle}
        realtime={realtime}
      />
    );
    const { rerender } = render(view());

    expect(harness.props).toMatchObject({
      gameId: "holdem",
      roomId: DEFAULT_HOLDEM_ROOM.id,
      realtime,
    });
    expect(screen.getByText(/第 7 手 · 入场 60/)).toBeVisible();
    expect(screen.getByLabelText("我的下注明细")).toHaveTextContent(
      /本轮下注\s*20.*本手投入\s*40.*剩余筹码\s*460/,
    );
    expect(screen.getAllByAltText("对手手牌")).toHaveLength(4);
    expect(
      screen.getByRole("timer", { name: /服务端倒计时剩余 8 秒/ }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /跟注/ }));
    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith(1, { type: "call" }),
    );
    expect(onSettle).not.toHaveBeenCalled();

    harness.match = matchWith(
      {
        ...playingState,
        version: 8,
        phase: "settled",
        phaseEndsInMs: 0,
        activeSeat: null,
        community: [
          { id: "h2", rank: 2, suit: "hearts" },
          { id: "d8", rank: 8, suit: "diamonds" },
          { id: "ca", rank: "A", suit: "clubs" },
          { id: "s7", rank: 7, suit: "spades" },
          { id: "hk", rank: "K", suit: "hearts" },
        ],
        seats: playingState.seats.map((seat) => ({
          ...seat,
          outcome: seat.seat === 1 ? "win" : "loss",
          settlementState: seat.seat === 1 ? "settled" : null,
        })),
      },
      sendAction,
    );
    rerender(view());

    await waitFor(() => expect(onServerSettled).toHaveBeenCalledTimes(1));
    expect(onSettle).not.toHaveBeenCalled();
    expect(screen.getAllByText("奖励已到账").length).toBeGreaterThan(0);
    rerender(view());
    expect(onServerSettled).toHaveBeenCalledTimes(1);
  });
});

function serverState() {
  return {
    gameId: "holdem",
    version: 4,
    roundId: 7,
    phase: "flop",
    phaseEndsInMs: 7_400,
    selfSeat: 1,
    activeSeat: 1,
    dealerSeat: 0,
    currentBet: 40,
    minRaise: 20,
    pot: 120,
    community: [
      { id: "h2", rank: 2, suit: "hearts" },
      { id: "d8", rank: 8, suit: "diamonds" },
      { id: "ca", rank: "A", suit: "clubs" },
    ],
    seats: [
      {
        seat: 0,
        name: "林川",
        connected: true,
        hole: [],
        stack: 460,
        committedRound: 40,
        committedHand: 40,
        status: "active",
        outcome: null,
        settlementState: null,
      },
      {
        seat: 1,
        name: "coding",
        connected: true,
        hole: [
          { id: "sa", rank: "A", suit: "spades" },
          { id: "sk", rank: "K", suit: "spades" },
        ],
        stack: 460,
        committedRound: 20,
        committedHand: 40,
        status: "active",
        outcome: null,
        settlementState: "pending",
      },
      {
        seat: 2,
        name: "Mika",
        connected: true,
        hole: [],
        stack: 460,
        committedRound: 40,
        committedHand: 40,
        status: "active",
        outcome: null,
        settlementState: null,
      },
    ],
    legal: {
      fold: true,
      check: false,
      call: 20,
      minRaiseTo: 80,
      maxRaiseTo: 480,
    },
  };
}

function matchWith(
  state: unknown,
  sendAction: MatchmakingSnapshot["sendAction"],
): MatchmakingSnapshot {
  return {
    phase: "matched",
    gameId: "holdem",
    ticketId: null,
    matchId: "holdem-match-1",
    source: "nakama-hosted",
    seats: [
      { seat: 0, kind: "player", name: "林川", isSelf: false },
      { seat: 1, kind: "player", name: "coding", isSelf: true },
      { seat: 2, kind: "player", name: "Mika", isSelf: false },
    ],
    error: null,
    serverState: state,
    sendAction,
  };
}
