export interface GameRealtimeAccess {
  readonly endpoint: string;
  readonly serverKey: string;
  readonly token: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly joinTicket: string;
}

export interface CreatedGameSession {
  readonly id: string;
  readonly entryPoints: string;
  readonly status: string;
  readonly realtime: GameRealtimeAccess | null;
}
