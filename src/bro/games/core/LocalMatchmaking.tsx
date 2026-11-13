import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Radio,
  RefreshCw,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  LocalDemoMatchmaker,
  type Matchmaker,
  type MatchmakingSnapshot,
} from "./matchmaking";
import { NakamaMatchmaker } from "./nakama";
import type { GameRealtimeAccess } from "./realtime";
import "./matchmaking.css";

export interface LocalMatchmakingProps {
  readonly gameId: string;
  readonly roomId?: string;
  readonly seatCount: number;
  readonly playerNames?: readonly string[];
  readonly fillDelayMs?: number;
  readonly realtime?: GameRealtimeAccess | null;
  readonly children: (match: MatchmakingSnapshot) => React.ReactNode;
}

export function LocalMatchmaking({
  gameId,
  roomId,
  seatCount,
  playerNames,
  fillDelayMs,
  realtime,
  children,
}: LocalMatchmakingProps) {
  const matchmakerRef = useRef<Matchmaker | null>(null);
  const [snapshot, setSnapshot] = useState<MatchmakingSnapshot | null>(null);
  const [forceLocal, setForceLocal] = useState(false);

  useEffect(() => {
    const options = {
      gameId,
      roomId,
      seatCount,
      playerNames,
      fillDelayMs,
      onChange: setSnapshot,
    };
    const matchmaker: Matchmaker =
      realtime && !forceLocal
        ? new NakamaMatchmaker({ ...options, access: realtime })
        : new LocalDemoMatchmaker(options);
    matchmakerRef.current = matchmaker;
    setSnapshot(matchmaker.snapshot());
    matchmaker.start();
    return () => {
      matchmaker.dispose();
      matchmakerRef.current = null;
    };
  }, [
    gameId,
    roomId,
    seatCount,
    playerNames,
    fillDelayMs,
    realtime,
    forceLocal,
  ]);

  if (!snapshot) return null;

  const matched = snapshot.phase === "matched";

  return (
    <MatchmakingStage
      snapshot={snapshot}
      fillDelayMs={fillDelayMs}
      onCancel={() => matchmakerRef.current?.cancel()}
      onRetry={() => matchmakerRef.current?.start()}
      onLocalFallback={() => {
        matchmakerRef.current?.dispose();
        setForceLocal(true);
      }}
      allowLocalFallback={!realtime}
    >
      <div
        className="bro-matchmaking__scene"
        aria-hidden={matched ? undefined : true}
      >
        {matched ? children(snapshot) : null}
      </div>
    </MatchmakingStage>
  );
}

interface MatchmakingStageProps {
  readonly snapshot: MatchmakingSnapshot;
  readonly fillDelayMs?: number;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onLocalFallback: () => void;
  readonly allowLocalFallback?: boolean;
  readonly children: React.ReactNode;
}

/** 纯状态视图也对测试开放；网络实现仍由 LocalMatchmaking 持有。 */
export function MatchmakingStage({
  snapshot,
  fillDelayMs,
  onCancel,
  onRetry,
  onLocalFallback,
  allowLocalFallback = true,
  children,
}: MatchmakingStageProps) {
  const matched = snapshot.phase === "matched";
  const searching =
    snapshot.phase === "connecting" || snapshot.phase === "searching";
  const retryable =
    snapshot.phase === "cancelled" || snapshot.phase === "error";
  const queueElapsedMs = useElapsed(searching, snapshot.ticketId ?? "connect");
  const searchElapsedMs = useElapsed(
    snapshot.phase === "searching",
    snapshot.ticketId ?? "search",
  );
  const fillDelayTargetMs =
    snapshot.source === "local-demo"
      ? (fillDelayMs ?? 900)
      : Math.max(fillDelayMs ?? 8_000, 8_000);
  const progress =
    snapshot.phase === "searching"
      ? Math.min(searchElapsedMs / fillDelayTargetMs, 0.95)
      : 0;

  return (
    <div
      className="bro-matchmaking"
      data-phase={snapshot.phase}
      data-source={snapshot.source}
    >
      {children}

      <div
        className="bro-matchmaking__veil"
        aria-hidden={matched ? true : undefined}
      >
        <section
          className="bro-matchmaking__panel"
          role={snapshot.phase === "error" ? "alert" : "status"}
          aria-label="匹配状态"
          aria-live="polite"
        >
          <MatchmakingHeading snapshot={snapshot} />

          {searching && (
            <div className="bro-matchmaking__timing">
              <span>
                已等待
                <strong className="bro-tabular">
                  {formatDuration(queueElapsedMs)}
                </strong>
              </span>
              {snapshot.phase === "searching" && (
                <span>
                  <strong>
                    {matchingProgressCopy(searchElapsedMs, fillDelayTargetMs)}
                  </strong>
                </span>
              )}
            </div>
          )}

          {searching && (
            <div
              className="bro-matchmaking__progress"
              data-indeterminate={snapshot.phase === "connecting"}
              role="progressbar"
              aria-label={
                snapshot.phase === "connecting" ? "正在连接" : "正在组桌"
              }
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                snapshot.phase === "searching"
                  ? Math.round(progress * 100)
                  : undefined
              }
            >
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
          )}

          <SeatGrid snapshot={snapshot} />

          {snapshot.phase === "error" && snapshot.error && (
            <p className="bro-matchmaking__error">
              <CircleAlert size={16} aria-hidden="true" />
              {snapshot.error}
            </p>
          )}

          <div className="bro-matchmaking__actions">
            {searching && (
              <button
                className="bro-matchmaking__button bro-matchmaking__button--quiet"
                type="button"
                onClick={onCancel}
                aria-label="取消匹配"
              >
                <X size={17} aria-hidden="true" />
                取消匹配
              </button>
            )}
            {retryable && (
              <button
                className="bro-matchmaking__button bro-matchmaking__button--primary"
                type="button"
                onClick={onRetry}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {snapshot.phase === "error" ? "重新连接" : "重新匹配"}
              </button>
            )}
            {retryable &&
              allowLocalFallback &&
              snapshot.source !== "local-demo" && (
                <button
                  className="bro-matchmaking__button bro-matchmaking__button--quiet"
                  type="button"
                  onClick={onLocalFallback}
                >
                  <UsersRound size={17} aria-hidden="true" />
                  快速开始
                </button>
              )}
          </div>
        </section>
      </div>

      {matched && <MatchedDock snapshot={snapshot} />}
    </div>
  );
}

function MatchmakingHeading({ snapshot }: { snapshot: MatchmakingSnapshot }) {
  const occupiedCount = snapshot.seats.filter(
    (seat) => seat.kind !== "open",
  ).length;
  const network = networkCopy(snapshot);
  const copy = phaseCopy(snapshot);

  return (
    <header className="bro-matchmaking__heading">
      <div className="bro-matchmaking__signal" data-tone={network.tone}>
        {network.icon === "online" ? (
          <Wifi size={15} aria-hidden="true" />
        ) : network.icon === "offline" ? (
          <WifiOff size={15} aria-hidden="true" />
        ) : (
          <Radio size={15} aria-hidden="true" />
        )}
        {network.label}
      </div>
      <div>
        <span className="bro-matchmaking__eyebrow">MATCH / TABLE READY</span>
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
      </div>
      <div className="bro-matchmaking__found bro-tabular">
        <UsersRound size={18} aria-hidden="true" />
        <strong>{occupiedCount}</strong>
        <span>/ {snapshot.seats.length} 席位已确认</span>
      </div>
    </header>
  );
}

function SeatGrid({ snapshot }: { snapshot: MatchmakingSnapshot }) {
  return (
    <div className="bro-matchmaking__seats" role="list" aria-label="对局席位">
      {snapshot.seats.map((seat) => {
        const isSelf = seat.isSelf;
        const name = isSelf ? "你" : seat.name.replace(/\s*\(YOU\)$/i, "");
        const role = isSelf
          ? "你的席位"
          : seat.kind === "open"
            ? "正在寻找"
            : "同桌玩家";
        return (
          <div
            className="bro-matchmaking__seat"
            key={seat.seat}
            data-kind={seat.kind === "open" ? "open" : "player"}
            role="listitem"
          >
            <span className="bro-matchmaking__avatar" aria-hidden="true">
              <UserRound size={20} />
            </span>
            <span>
              <strong>{name}</strong>
              <small>{role}</small>
            </span>
            <i aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}

function MatchedDock({ snapshot }: { snapshot: MatchmakingSnapshot }) {
  return (
    <section
      className="bro-matchmaking__dock"
      aria-label="匹配与席位状态"
      aria-live="polite"
    >
      <span className="bro-matchmaking__dock-status">
        <i aria-hidden="true" />
        对局已就绪
      </span>
      <div className="bro-matchmaking__dock-seats" aria-label="当前席位">
        {snapshot.seats.map((seat) => (
          <span
            key={seat.seat}
            data-kind={seat.kind === "open" ? "open" : "player"}
          >
            <UserRound size={14} aria-hidden="true" />
            {seat.isSelf ? "你" : seat.name}
          </span>
        ))}
      </div>
      <small>牌桌已连接 · 对局进行中</small>
    </section>
  );
}

function phaseCopy(snapshot: MatchmakingSnapshot): {
  title: string;
  detail: string;
} {
  switch (snapshot.phase) {
    case "connecting":
      return {
        title: "正在连接对局服务",
        detail: "确认网络状态后，马上为你寻找同桌玩家。",
      };
    case "searching":
      return {
        title: "正在为你组桌",
        detail: "同桌玩家会依次入座，席位确认后自动开始。",
      };
    case "cancelled":
      return {
        title: "已停止匹配",
        detail: "尚未创建对局，也不会产生积分结算。",
      };
    case "error":
      return {
        title: "暂时无法加入线上队列",
        detail: "可以重新连接，或直接快速开始。",
      };
    case "matched":
      return { title: "对局已就绪", detail: "席位已确认。" };
    default:
      return { title: "准备匹配", detail: "正在初始化对局。" };
  }
}

function matchingProgressCopy(elapsedMs: number, targetMs: number): string {
  const ratio = targetMs > 0 ? elapsedMs / targetMs : 1;
  if (ratio < 0.4) return "正在搜寻空闲牌桌";
  if (ratio < 0.9) return "正在确认同桌席位";
  return "牌桌确认中，即将开始";
}

function networkCopy(snapshot: MatchmakingSnapshot): {
  label: string;
  tone: "active" | "danger" | "local";
  icon: "online" | "offline" | "local";
} {
  if (snapshot.source === "local-demo") {
    return { label: "牌桌服务就绪", tone: "local", icon: "local" };
  }
  if (snapshot.phase === "error") {
    return { label: "连接异常", tone: "danger", icon: "offline" };
  }
  if (snapshot.phase === "connecting") {
    return { label: "正在连线", tone: "active", icon: "online" };
  }
  return { label: "匹配服务在线", tone: "active", icon: "online" };
}

function useElapsed(active: boolean, resetKey: string): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [active, resetKey]);

  return elapsedMs;
}

function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
