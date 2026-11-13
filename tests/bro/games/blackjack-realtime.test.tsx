import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlackjackGame } from "@/bro/games/blackjack/BlackjackGame";
import { DEFAULT_BLACKJACK_ROOM } from "@/bro/games/blackjack/logic";
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

describe("BlackjackGame 云端权威牌桌", () => {
  it("使用房间 ticket、只发送 OP1 行动，并在服务端结算后刷新账本", async () => {
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
    const playingState = {
      gameId: "blackjack",
      version: 4,
      roundId: 7,
      phase: "players",
      phaseEndsInMs: 7_400,
      selfSeat: 1,
      activeSeat: 1,
      dealer: {
        cards: [
          { id: "dealer-10", rank: 10, suit: "spades" },
          { id: "dealer-6", rank: 6, suit: "hearts" },
        ],
        total: 16,
      },
      seats: [
        {
          seat: 0,
          name: "森川",
          connected: true,
          hand: [
            { id: "seat-0-9", rank: 9, suit: "clubs" },
            { id: "seat-0-7", rank: 7, suit: "diamonds" },
          ],
          total: 16,
          wager: 20,
          outcome: null,
          payout: 0,
          settlementState: null,
        },
        {
          seat: 1,
          name: "coding",
          connected: true,
          hand: [
            { id: "self-a", rank: "A", suit: "spades" },
            { id: "self-8", rank: 8, suit: "hearts" },
          ],
          total: 19,
          wager: 20,
          outcome: null,
          payout: 0,
          settlementState: "pending",
        },
        {
          seat: 2,
          name: "Mika",
          connected: true,
          hand: [
            { id: "seat-2-10", rank: "K", suit: "clubs" },
            { id: "seat-2-8", rank: 8, suit: "diamonds" },
          ],
          total: 18,
          wager: 20,
          outcome: null,
          payout: 0,
          settlementState: null,
        },
      ],
    };
    harness.match = matchWith(playingState, sendAction);

    const view = () => (
      <BlackjackGame
        accountPoints={1_280}
        entryPoints={60}
        onServerSettled={onServerSettled}
        onSettle={onSettle}
        realtime={realtime}
      />
    );
    const { rerender } = render(view());

    expect(harness.props).toMatchObject({
      gameId: "blackjack",
      roomId: DEFAULT_BLACKJACK_ROOM.id,
      realtime,
    });
    expect(screen.getByLabelText("本局入场积分")).toHaveTextContent("60");
    expect(screen.getByLabelText("森川 公开手牌")).toBeVisible();
    expect(screen.getByLabelText("Mika 公开手牌")).toBeVisible();
    expect(screen.getAllByAltText("庄家暗牌")).toHaveLength(1);
    expect(
      screen.getByRole("timer", { name: /决策倒计时剩余 8 秒/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /加倍/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "要牌" }));
    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith(1, { type: "hit" }),
    );
    expect(onSettle).not.toHaveBeenCalled();

    harness.match = matchWith(
      {
        ...playingState,
        version: 8,
        phase: "settled",
        phaseEndsInMs: 0,
        activeSeat: null,
        dealer: { ...playingState.dealer, total: 20 },
        seats: playingState.seats.map((seat) =>
          seat.seat === 1
            ? {
                ...seat,
                outcome: "win",
                payout: 40,
                settlementState: "settled",
              }
            : { ...seat, outcome: "loss" },
        ),
      },
      sendAction,
    );
    rerender(view());

    await waitFor(() => expect(onServerSettled).toHaveBeenCalledTimes(1));
    expect(onSettle).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("这一手你赢了");
    expect(screen.queryByAltText("庄家暗牌")).not.toBeInTheDocument();

    rerender(view());
    expect(onServerSettled).toHaveBeenCalledTimes(1);
  });
});

function matchWith(
  serverState: unknown,
  sendAction: MatchmakingSnapshot["sendAction"],
): MatchmakingSnapshot {
  return {
    phase: "matched",
    gameId: "blackjack",
    ticketId: null,
    matchId: "blackjack-match-1",
    source: "nakama-hosted",
    seats: [
      { seat: 0, kind: "player", name: "森川", isSelf: false },
      { seat: 1, kind: "player", name: "coding", isSelf: true },
      { seat: 2, kind: "player", name: "Mika", isSelf: false },
    ],
    error: null,
    serverState,
    sendAction,
  };
}
