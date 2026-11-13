import {
  Client,
  Session,
  type Match,
  type MatchmakerMatched,
  type Presence,
  type Socket,
} from "@heroiclabs/nakama-js";
import type { GameRealtimeAccess } from "./realtime";
import type {
  Matchmaker,
  MatchSeat,
  MatchmakingPhase,
  MatchmakingSnapshot,
  MatchmakingSource,
} from "./matchmaking";

export interface NakamaMatchmakerOptions {
  readonly gameId: string;
  readonly roomId?: string;
  readonly seatCount: number;
  readonly playerNames?: readonly string[];
  /** 公开队列等待时间；超时后仍进入服务端托管的正式 match。 */
  readonly fillDelayMs?: number;
  readonly access: GameRealtimeAccess;
  readonly onChange: (snapshot: MatchmakingSnapshot) => void;
}

/** Nakama query 用冒号分隔字段和值，场次 key 先收敛成安全的 term。 */
export function nakamaMatchKey(gameId: string): string {
  const normalized = gameId.replace(/[^a-zA-Z0-9_]/g, "_");
  return normalized || "coding_bro_game";
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (
      typeof candidate.code === "string" ||
      typeof candidate.code === "number"
    ) {
      return `Nakama 连接失败（${String(candidate.code)}）`;
    }
  }
  return "无法连接对局服务，请确认服务地址和运行状态";
}

export class NakamaMatchmaker implements Matchmaker {
  private readonly options: NakamaMatchmakerOptions;
  private socket: Socket | null = null;
  private client: Client | null = null;
  private session: Session | null = null;
  private ticketId: string | null = null;
  private match: Match | null = null;
  private fillTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private current: MatchmakingSnapshot;

  constructor(options: NakamaMatchmakerOptions) {
    if (!Number.isInteger(options.seatCount) || options.seatCount < 2) {
      throw new Error("Nakama matchmaking needs at least two seats");
    }
    this.options = options;
    this.current = this.makeSnapshot(
      "idle",
      "nakama",
      null,
      null,
      [],
      false,
      null,
    );
  }

  snapshot(): MatchmakingSnapshot {
    return this.current;
  }

  start(): void {
    if (
      this.current.phase === "connecting" ||
      this.current.phase === "searching" ||
      this.current.phase === "matched"
    ) {
      return;
    }
    this.dispose();
    const generation = ++this.generation;
    this.clearFillTimer();
    this.publish(
      this.makeSnapshot("connecting", "nakama", null, null, [], false, null),
    );
    void this.connectAndSearch(generation);
  }

  cancel(): void {
    if (
      this.current.phase !== "connecting" &&
      this.current.phase !== "searching"
    ) {
      return;
    }
    ++this.generation;
    this.clearFillTimer();
    const ticketId = this.ticketId;
    this.ticketId = null;
    if (ticketId && this.socket) {
      void this.socket.removeMatchmaker(ticketId).catch(() => undefined);
    }
    this.publish(
      this.makeSnapshot("cancelled", "nakama", ticketId, null, [], false, null),
    );
  }

  dispose(): void {
    ++this.generation;
    this.clearFillTimer();
    const socket = this.socket;
    const ticketId = this.ticketId;
    const matchId = this.match?.match_id ?? null;
    this.socket = null;
    this.client = null;
    this.session = null;
    this.ticketId = null;
    this.match = null;
    if (!socket) return;
    this.cleanupSocket(socket, ticketId, matchId);
  }

  private async connectAndSearch(generation: number): Promise<void> {
    try {
      const endpoint = new URL(this.options.access.endpoint);
      const useSSL = endpoint.protocol === "https:";
      const host = endpoint.hostname;
      const port = endpoint.port || (useSSL ? "443" : "80");
      const serverKey = this.options.access.serverKey;
      const client = new Client(serverKey, host, port, useSSL);
      const session = Session.restore(
        this.options.access.token,
        this.options.access.refreshToken ?? "",
      );
      this.client = client;
      this.session = session;
      if (generation !== this.generation) return;

      const socket = client.createSocket(useSSL, false);
      this.socket = socket;
      socket.onmatchmakermatched = (matched) => {
        void this.joinMatched(generation, matched);
      };
      socket.onmatchdata = (message) => {
        if (
          generation !== this.generation ||
          message.match_id !== this.match?.match_id
        ) {
          return;
        }
        const payload = parseMatchPayload(message.data);
        if (message.op_code === 101) {
          this.publish({
            ...this.current,
            seats: seatsFromServerState(payload, this.current.seats),
            serverState: payload,
          });
        } else if (message.op_code === 102) {
          this.publish({
            ...this.current,
            error: rejectionMessage(payload),
          });
        }
      };
      socket.onerror = () => {
        if (generation === this.generation) {
          this.fail("实时连接中断，请重试");
        }
      };
      await socket.connect(session, true);
      if (generation !== this.generation) {
        socket.disconnect(false);
        return;
      }

      const roomId = this.options.roomId ?? `${this.options.gameId}-default`;
      const roomKey = nakamaMatchKey(roomId);
      const ticket = await socket.addMatchmaker(
        `+properties.game_id:${nakamaMatchKey(this.options.gameId)} +properties.room_key:${roomKey}`,
        2,
        this.options.seatCount,
        {
          game_id: nakamaMatchKey(this.options.gameId),
          room_id: roomId,
          room_key: roomKey,
        },
      );
      if (generation !== this.generation) {
        void socket.removeMatchmaker(ticket.ticket).catch(() => undefined);
        return;
      }
      this.ticketId = ticket.ticket;
      this.publish(
        this.makeSnapshot(
          "searching",
          "nakama",
          ticket.ticket,
          null,
          [],
          false,
          null,
        ),
      );
      this.fillTimer = setTimeout(
        () => {
          void this.startHostedMatch(generation);
        },
        Math.max(this.options.fillDelayMs ?? 8_000, 8_000),
      );
    } catch (error) {
      if (generation === this.generation) this.fail(readableError(error));
    }
  }

  private async joinMatched(
    generation: number,
    matched: MatchmakerMatched,
  ): Promise<void> {
    if (generation !== this.generation || !this.socket) return;
    try {
      this.clearFillTimer();
      this.ticketId = null;
      const match = await this.socket.joinMatch(undefined, matched.token, {
        joinTicket: this.options.access.joinTicket,
      });
      if (generation !== this.generation) return;
      this.match = match;
      const players = uniquePresences([
        matched.self.presence,
        ...matched.users.map((user) => user.presence),
      ]);
      this.publish(
        this.makeSnapshot(
          "matched",
          "nakama",
          matched.ticket,
          match.match_id,
          players,
          true,
          null,
        ),
      );
    } catch (error) {
      if (generation === this.generation) this.fail(readableError(error));
    }
  }

  private async startHostedMatch(generation: number): Promise<void> {
    if (
      generation !== this.generation ||
      !this.socket ||
      !this.client ||
      !this.session ||
      this.current.phase !== "searching"
    ) {
      return;
    }
    try {
      const ticketId = this.ticketId;
      this.ticketId = null;
      if (ticketId) await this.socket.removeMatchmaker(ticketId);
      if (generation !== this.generation) return;
      const response = await this.client.rpc(
        this.session,
        "coding_bro_create_table",
        {
          gameId: this.options.gameId,
          roomId: this.options.roomId ?? `${this.options.gameId}-default`,
        },
      );
      const created = (
        typeof response.payload === "string"
          ? JSON.parse(response.payload || "{}")
          : response.payload
      ) as { matchId?: unknown };
      if (typeof created.matchId !== "string") {
        throw new Error("对局服务没有返回权威 match id");
      }
      const match = await this.socket.joinMatch(created.matchId, undefined, {
        joinTicket: this.options.access.joinTicket,
      });
      if (generation !== this.generation) return;
      this.match = match;
      this.publish(
        this.makeSnapshot(
          "matched",
          "nakama-hosted",
          ticketId,
          match.match_id,
          [match.self],
          true,
          null,
        ),
      );
    } catch (error) {
      if (generation === this.generation) this.fail(readableError(error));
    }
  }

  private fail(message: string): void {
    this.clearFillTimer();
    const socket = this.socket;
    const ticketId = this.ticketId;
    const matchId = this.match?.match_id ?? null;
    this.socket = null;
    this.client = null;
    this.session = null;
    this.ticketId = null;
    this.match = null;
    if (socket) this.cleanupSocket(socket, ticketId, matchId);
    this.publish(
      this.makeSnapshot("error", "nakama", ticketId, null, [], false, message),
    );
  }

  private publish(snapshot: MatchmakingSnapshot): void {
    this.current = snapshot;
    this.options.onChange(snapshot);
  }

  private makeSnapshot(
    phase: MatchmakingPhase,
    source: MatchmakingSource,
    ticketId: string | null,
    matchId: string | null,
    players: readonly Presence[],
    fillSeats: boolean,
    error: string | null,
  ): MatchmakingSnapshot {
    const seats: MatchSeat[] = [];
    const visiblePlayers = players.slice(0, this.options.seatCount);
    visiblePlayers.forEach((presence, seat) => {
      seats.push({
        seat,
        kind: "player",
        name: seat === 0 ? `${presence.username} (YOU)` : presence.username,
        isSelf: seat === 0,
      });
    });
    if (visiblePlayers.length === 0) {
      seats.push({ seat: 0, kind: "player", name: "YOU", isSelf: true });
    }
    const names = this.options.playerNames ?? [];
    while (seats.length < this.options.seatCount) {
      const seat = seats.length;
      seats.push(
        fillSeats
          ? {
              seat,
              kind: "player",
              name: names[seat - 1] ?? `玩家 ${seat + 1}`,
              isSelf: false,
            }
          : { seat, kind: "open", name: "等待玩家", isSelf: false },
      );
    }
    return {
      phase,
      gameId: this.options.gameId,
      ticketId,
      matchId,
      source,
      seats,
      error,
      serverState: null,
      sendAction: matchId
        ? async (opCode, payload) => {
            const socket = this.socket;
            if (!socket) throw new Error("牌桌连接已经断开");
            await socket.sendMatchState(
              matchId,
              opCode,
              JSON.stringify(payload),
            );
          }
        : null,
    };
  }

  private clearFillTimer(): void {
    if (this.fillTimer !== null) clearTimeout(this.fillTimer);
    this.fillTimer = null;
  }

  private cleanupSocket(
    socket: Socket,
    ticketId: string | null,
    matchId: string | null,
  ): void {
    void (async () => {
      try {
        if (ticketId) await socket.removeMatchmaker(ticketId);
        if (matchId) await socket.leaveMatch(matchId);
      } catch {
        // The socket may already be unavailable; disconnect still releases timers.
      } finally {
        socket.disconnect(false);
      }
    })();
  }
}

function uniquePresences(presences: readonly Presence[]): Presence[] {
  const seen = new Set<string>();
  return presences.filter((presence) => {
    const key = presence.user_id || presence.session_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseMatchPayload(data: Uint8Array | string): unknown {
  try {
    const text =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function seatsFromServerState(
  payload: unknown,
  fallback: readonly MatchSeat[],
): readonly MatchSeat[] {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as {
    selfSeat?: unknown;
    seats?: unknown;
  };
  if (!Array.isArray(candidate.seats)) return fallback;
  const selfSeat =
    typeof candidate.selfSeat === "number" ? candidate.selfSeat : null;
  const seats = candidate.seats.flatMap((raw): MatchSeat[] => {
    if (!raw || typeof raw !== "object") return [];
    const seat = raw as {
      seat?: unknown;
      name?: unknown;
    };
    if (typeof seat.seat !== "number" || typeof seat.name !== "string") {
      return [];
    }
    return [
      {
        seat: seat.seat,
        kind: "player",
        name: seat.name,
        isSelf: seat.seat === selfSeat,
      },
    ];
  });
  return seats.length ? seats : fallback;
}

function rejectionMessage(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "牌桌拒绝了这次操作";
}
