import { ArrowRight, CircleDollarSign, Radio, Sparkles } from "lucide-react";
import type { GameEntry, GameRoom } from "./catalog";

export interface GameRoomSelectorProps {
  readonly game: GameEntry;
  readonly balance: number;
  readonly onSelect: (room: GameRoom) => void;
}

export function GameRoomSelector({
  game,
  balance,
  onSelect,
}: GameRoomSelectorProps) {
  const rooms = game.rooms ?? [];
  return (
    <main className="bro-room-select">
      <header className="bro-room-select__hero">
        <div>
          <span className="bro-room-select__kicker">
            <Radio size={13} aria-hidden="true" /> LIVE TABLE / ROOM SELECT
          </span>
          <h1>选择你的{game.name}牌桌</h1>
          <p>
            不同场次使用同一套规则，只改变入场门槛、桌内筹码与结算强度。按牌局结果结算，打得好才有机会净赚积分。
          </p>
        </div>
        <div className="bro-room-select__balance">
          <CircleDollarSign size={17} aria-hidden="true" />
          <span>可用积分</span>
          <strong className="bro-tabular">{balance}</strong>
        </div>
      </header>

      <section
        className="bro-room-select__grid"
        aria-label={`${game.name}场次`}
      >
        {rooms.map((room, index) => {
          const affordable = balance >= room.price;
          return (
            <button
              key={room.id}
              type="button"
              className="bro-room-card"
              data-featured={room.featured ? "" : undefined}
              disabled={!affordable}
              onClick={() => onSelect(room)}
              aria-label={
                affordable
                  ? `进入${room.name}，${room.price} 积分`
                  : `${room.name}，需要 ${room.price} 积分`
              }
            >
              <span className="bro-room-card__index">
                ROOM {String(index + 1).padStart(2, "0")}
              </span>
              {room.featured && (
                <span className="bro-room-card__featured">
                  <Sparkles size={12} aria-hidden="true" /> 推荐
                </span>
              )}
              <span className="bro-room-card__label">{room.label}</span>
              <strong>{room.name}</strong>
              <span className="bro-room-card__detail">{room.detail}</span>
              <span className="bro-room-card__foot">
                <span className="bro-tabular">
                  {room.price} <small>积分</small>
                </span>
                <span>
                  {affordable ? "进入牌桌" : "积分不足"}
                  {affordable && <ArrowRight size={15} aria-hidden="true" />}
                </span>
              </span>
            </button>
          );
        })}
      </section>
      <p className="bro-room-select__note">
        入场积分在确认场次后扣除；离桌不会自动退回本局入场积分。积分余额不设总上限。
      </p>
    </main>
  );
}
