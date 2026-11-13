/**
 * 可替换的匹配边界。
 *
 * 页面只依赖这里的 `MatchmakingSnapshot`。Nakama 与本地演示都实现同一边界，
 * 具体游戏不需要知道 WebSocket、ticket 或 matchmaker query。
 */

export type MatchmakingPhase =
  | "idle"
  | "connecting"
  | "searching"
  | "matched"
  | "cancelled"
  | "error";
export type MatchSeatKind = "player" | "open";
export type MatchmakingSource = "local-demo" | "nakama" | "nakama-hosted";

export interface MatchSeat {
  readonly seat: number;
  readonly kind: MatchSeatKind;
  readonly name: string;
  readonly isSelf: boolean;
}

export interface MatchmakingSnapshot {
  readonly phase: MatchmakingPhase;
  readonly gameId: string;
  readonly ticketId: string | null;
  readonly matchId: string | null;
  readonly source: MatchmakingSource;
  readonly seats: readonly MatchSeat[];
  readonly error: string | null;
  readonly serverState: unknown | null;
  readonly sendAction:
    | ((
        opCode: number,
        payload: Readonly<Record<string, unknown>>,
      ) => Promise<void>)
    | null;
}

export interface Matchmaker {
  snapshot(): MatchmakingSnapshot;
  start(): void;
  cancel(): void;
  dispose(): void;
}

export interface LocalDemoMatchmakerOptions {
  readonly gameId: string;
  readonly seatCount: number;
  readonly playerNames?: readonly string[];
  readonly fillDelayMs?: number;
  readonly onChange: (snapshot: MatchmakingSnapshot) => void;
}

let nextTicket = 1;

export class LocalDemoMatchmaker implements Matchmaker {
  private readonly options: LocalDemoMatchmakerOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: MatchmakingSnapshot;

  constructor(options: LocalDemoMatchmakerOptions) {
    if (!Number.isInteger(options.seatCount) || options.seatCount < 2) {
      throw new Error("Local demo matchmaking needs at least two seats");
    }
    this.options = options;
    this.current = this.makeSnapshot("idle", null, null, false);
  }

  snapshot(): MatchmakingSnapshot {
    return this.current;
  }

  start(): void {
    if (
      this.current.phase === "searching" ||
      this.current.phase === "matched"
    ) {
      return;
    }
    this.clearTimer();
    const ticketId = `local-ticket-${nextTicket++}`;
    this.publish(this.makeSnapshot("searching", ticketId, null, false));
    this.timer = setTimeout(() => {
      this.timer = null;
      const matchId = `local-demo-${this.options.gameId}-${ticketId}`;
      this.publish(this.makeSnapshot("matched", ticketId, matchId, true));
    }, this.options.fillDelayMs ?? 900);
  }

  cancel(): void {
    if (this.current.phase !== "searching") return;
    this.clearTimer();
    this.publish(
      this.makeSnapshot("cancelled", this.current.ticketId, null, false),
    );
  }

  dispose(): void {
    this.clearTimer();
  }

  private publish(snapshot: MatchmakingSnapshot): void {
    this.current = snapshot;
    this.options.onChange(snapshot);
  }

  private makeSnapshot(
    phase: MatchmakingPhase,
    ticketId: string | null,
    matchId: string | null,
    fillSeats: boolean,
  ): MatchmakingSnapshot {
    const names = this.options.playerNames ?? [];
    const seats: MatchSeat[] = Array.from(
      { length: this.options.seatCount },
      (_, seat) => {
        if (seat === 0) {
          return { seat, kind: "player", name: "YOU", isSelf: true };
        }
        if (!fillSeats) {
          return { seat, kind: "open", name: "等待玩家", isSelf: false };
        }
        return {
          seat,
          kind: "player",
          name: names[seat - 1] ?? `玩家 ${seat + 1}`,
          isSelf: false,
        };
      },
    );
    return {
      phase,
      gameId: this.options.gameId,
      ticketId,
      matchId,
      source: "local-demo",
      seats,
      error: null,
      serverState: null,
      sendAction: null,
    };
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
