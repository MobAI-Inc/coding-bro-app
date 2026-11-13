/**
 * 游戏区路由。
 *
 * 大厅 ↔ 对局之间只有这一条路，入场扣费也只发生在这一处。大厅那边的
 * 「积分不足就禁用按钮」是给人看的提示，这里的 `chargeEntry` 才是判定
 * ——禁用状态挡不住键盘、挡不住并发点击，也挡不住以后哪个新入口忘了判断。
 *
 * 目前扣费只落在本地假账本上。接上服务端之后，扣费要变成一次请求，且
 * **由服务端返回新余额**，客户端不再自己算——积分余额是服务端的事，客户端
 * 算出来的数字只能用于显示。
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { usePointLedger } from "../points/mock";
import { awardResult, balanceOf, chargeEntry } from "../points/types";
import { Match3Game } from "../games/match3/Match3Game";
import { HoldemGame, type HoldemRoomConfig } from "../games/holdem/HoldemGame";
import {
  BaccaratGame,
  type BaccaratRoomConfig,
} from "../games/baccarat/BaccaratGame";
import {
  BlackjackGame,
  type BlackjackRoomConfig,
} from "../games/blackjack/BlackjackGame";
import { SlotsGame } from "../games/slots/SlotsGame";
import { GoldMinerGame } from "../games/gold-miner/GoldMinerGame";
import { GameLobby } from "./GameLobby";
import { GameRoomSelector } from "./GameRoomSelector";
import {
  GAME_CATALOG,
  findGame,
  isEnterable,
  mergeGameEconomy,
} from "./catalog";
import type { GameEntry, GameId, GameRoom } from "./catalog";
import { playArcadeCue } from "../games/core/audio";
import type {
  CreatedGameSession,
  GameRealtimeAccess,
} from "../games/core/realtime";
import { useCodingBroBackend } from "../api/BackendProvider";
// 对局页顶栏的样式也在这个文件里。不靠 GameLobby 的那次 import 顺带带进来
// ——那样一旦大厅拆走，顶栏会静默失去样式
import "./lobby.css";

/**
 * 对局页分发表。
 *
 * 写成表而不是一串 `if (playing === "go")`：六款游戏摊开就是六个分支，而
 * 分支漏一个的表现是**点进去一片空白**——catalog.ts 开头那句「摆一张点进去
 * 是空白页的卡片，比不摆更糟」说的就是这个。表的好处不在少打几个字，在于
 * 「目录里 playable 的游戏是否都有页面」变成了一句能测的话：两个键集合相等。
 * 末尾的测试直接比对这两个集合，改 status 忘了接页面会立刻变红。
 *
 * 值是 `() => ReactNode` 而不是组件引用：各游戏的 props 不同（围棋要棋盘
 * 大小，象棋要座位），在这里定死默认参数，路由层就不必认识每款游戏的
 * 参数形状。
 */
interface GameViewProps {
  readonly onSettle?: (points: number) => void;
  readonly onServerSettled?: () => void;
  readonly room?: GameRoom;
  readonly pointsBalance?: number;
  readonly entryPoints?: number;
  readonly realtime?: GameRealtimeAccess | null;
}

type GameViewFactory = (props?: GameViewProps) => ReactNode;

export const GAME_VIEWS: Partial<Record<GameId, GameViewFactory>> = {
  baccarat: ({
    onSettle,
    onServerSettled,
    room,
    entryPoints,
    realtime,
  } = {}) => (
    <BaccaratGame
      entryPoints={entryPoints}
      onSettle={onSettle}
      onServerSettled={onServerSettled}
      realtime={realtime}
      room={baccaratRoom(room)}
    />
  ),
  slots: ({ onSettle } = {}) => <SlotsGame onSettle={onSettle} />,
  match3: ({ onSettle } = {}) => <Match3Game onSettle={onSettle} />,
  holdem: ({ onSettle, onServerSettled, room, entryPoints, realtime } = {}) => (
    <HoldemGame
      entryPoints={entryPoints}
      onSettle={onSettle}
      onServerSettled={onServerSettled}
      realtime={realtime}
      room={holdemRoom(room)}
    />
  ),
  blackjack: ({
    onSettle,
    onServerSettled,
    room,
    pointsBalance,
    entryPoints,
    realtime,
  } = {}) => (
    <BlackjackGame
      accountPoints={pointsBalance}
      entryPoints={entryPoints}
      onSettle={onSettle}
      onServerSettled={onServerSettled}
      realtime={realtime}
      room={blackjackRoom(room)}
    />
  ),
  "gold-miner": ({ onSettle } = {}) => <GoldMinerGame onSettle={onSettle} />,
};

function holdemRoom(room?: GameRoom): HoldemRoomConfig | undefined {
  if (!room) return undefined;
  if (room.id === "holdem-mainframe") {
    return {
      id: room.id,
      name: room.name,
      startingStack: 4_000,
      smallBlind: 80,
      bigBlind: 160,
      winPoints: 1_360,
    };
  }
  if (room.id === "holdem-studio") {
    return {
      id: room.id,
      name: room.name,
      startingStack: 1_500,
      smallBlind: 30,
      bigBlind: 60,
      winPoints: 510,
    };
  }
  return {
    id: room.id,
    name: room.name,
    startingStack: 500,
    smallBlind: 10,
    bigBlind: 20,
    winPoints: 170,
  };
}

function baccaratRoom(room?: GameRoom): BaccaratRoomConfig | undefined {
  if (!room) return undefined;
  if (room.id === "baccarat-vault") {
    return {
      id: room.id,
      name: room.name,
      initialBalance: 2_000,
      stakeOptions: [100, 250, 500],
    };
  }
  if (room.id === "baccarat-club") {
    return {
      id: room.id,
      name: room.name,
      initialBalance: 600,
      stakeOptions: [30, 75, 150],
    };
  }
  return {
    id: room.id,
    name: room.name,
    initialBalance: 200,
    stakeOptions: [10, 25, 50],
  };
}

function blackjackRoom(room?: GameRoom): BlackjackRoomConfig | undefined {
  if (!room) return undefined;
  if (room.id === "blackjack-penthouse") {
    return {
      id: room.id,
      label: room.name,
      tableLabel: "HIGH LIMIT / OPEN TABLE",
      startingChips: 4_000,
      minBet: 75,
      defaultBet: 150,
      rewardMultiplier: 1,
    };
  }
  if (room.id === "blackjack-counter") {
    return {
      id: room.id,
      label: room.name,
      tableLabel: "NIGHT COUNTER / OPEN TABLE",
      startingChips: 1_500,
      minBet: 30,
      defaultBet: 60,
      rewardMultiplier: 1,
    };
  }
  return {
    id: room.id,
    label: room.name,
    tableLabel: "LOUNGE / OPEN TABLE",
    startingChips: 500,
    minBet: 10,
    defaultBet: 20,
    rewardMultiplier: 1,
  };
}

/**
 * 这款游戏现在能不能真的进去（扣费之前问的那一句）。
 *
 * 两个条件缺一不可：目录标了 `playable`，**且**分发表里有页面。第二个条件
 * 在正常状态下永远成立——`GamesRoute.test.ts` 盯着两个集合相等——但它防的
 * 恰恰是那个不变量被破坏的瞬间：目录改成 playable、页面还没接，中间这一次
 * 提交里点进去就是扣了积分再退回大厅。用户只看到分少了，看不出为什么。
 *
 * 宁可不让进：不能玩比扣了钱不能玩强。
 *
 * 单独提成函数而不是写在 `onEnter` 里，是为了让这条判断可测。埋在组件里的
 * 话，要触发它得先制造出「目录与分发表不一致」的状态，而那个状态被另一条
 * 测试禁止了——于是这半个条件永远跑不到，删掉它测试也全绿（变异测试确认
 * 过：删掉守卫逃逸）。提出来之后，传参就能直接问它。
 *
 * `views` 作参数而不是直接读 `GAME_VIEWS`，正是为了能传一张残缺的表进来。
 * `lookup` 同理：六款现在全部 `playable`，「目录没标 playable」这一半在真
 * 目录下已经取不到值了 —— 但它防的事没消失，加第七款游戏的当天它就回来。
 * 把目录查询也变成参数，这一半才继续测得动。
 */
export function canEnter(
  id: GameId,
  views: Partial<Record<GameId, unknown>> = GAME_VIEWS,
  lookup: (id: GameId) => GameEntry | undefined = findGame,
): boolean {
  const game = lookup(id);
  return !!game && isEnterable(game) && !!views[id];
}

interface PlayingSession {
  readonly id: GameId;
  readonly room?: GameRoom;
  readonly serverSession?: CreatedGameSession;
}

export function GamesRoute() {
  const fallback = usePointLedger();
  const backend = useCodingBroBackend();
  const catalog = backend
    ? backend.gameEconomy.length
      ? mergeGameEconomy(GAME_CATALOG, backend.gameEconomy)
      : []
    : GAME_CATALOG;
  const ledger = backend?.ledger ?? fallback.ledger;
  const setLedger = fallback.setLedger;
  const [playing, setPlaying] = useState<PlayingSession | null>(null);
  const [selectingRoomsFor, setSelectingRoomsFor] = useState<GameId | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** 入场流水的自增号。真实账本里这个 id 由服务端发。 */
  const [seq, setSeq] = useState(0);
  /** 奖励流水序号。ref 避免游戏异步回调闭包拿到旧序号。 */
  const awardSeq = useRef(0);
  const settledSessions = useRef(new Set<string>());

  // 大厅是长页，从下面的游戏柜进入时外层滚动位置会被 React 保留；如果不复位，
  // 对局会从牌桌中段开始，看起来像顶栏和 HUD 被裁掉。进入与返回都从各自首屏开始。
  useLayoutEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".coding-bro-content");
    if (scroller) scroller.scrollTop = 0;
  }, [playing, selectingRoomsFor]);

  const chargeAndPlay = useCallback(
    async (game: GameEntry, room?: GameRoom) => {
      const price = room?.price ?? game.price;
      if (backend) {
        try {
          const serverSession = await backend.createGameSession(
            game.id,
            room?.id,
          );
          setError(null);
          setPlaying({ id: game.id, room, serverSession });
          playArcadeCue("enter");
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }
      const next = chargeEntry(ledger, {
        id: `entry-${seq}`,
        price,
        at: Date.now(),
        memo: room ? `${game.name} · ${room.name}入场` : `${game.name}入场`,
      });
      if (!next) {
        setError(`积分不足，${room?.name ?? game.name}需要 ${price}`);
        return;
      }
      setLedger(next);
      setSeq((n) => n + 1);
      setError(null);
      setPlaying({ id: game.id, room });
      playArcadeCue("enter");
    },
    [backend, ledger, seq, setLedger],
  );

  const onEnter = useCallback(
    (id: GameId) => {
      const game = findGame(id, catalog);
      if (
        !game ||
        !canEnter(id, GAME_VIEWS, (candidate) => findGame(candidate, catalog))
      ) {
        return;
      }
      if (game.rooms?.length) {
        setError(null);
        setSelectingRoomsFor(game.id);
        playArcadeCue("enter");
        return;
      }
      void chargeAndPlay(game);
    },
    [catalog, chargeAndPlay],
  );

  if (backend && catalog.length === 0) {
    return (
      <p className="bro-lobby__error" role="status">
        {backend.error ?? "正在同步服务端游戏目录…"}
      </p>
    );
  }

  const entry = playing ? findGame(playing.id, catalog) : undefined;
  const view = playing ? GAME_VIEWS[playing.id] : undefined;
  if (entry && view && playing) {
    const onSettle = (points: number) => {
      if (backend && playing.serverSession) {
        const sessionId = playing.serverSession.id;
        if (playing.serverSession.realtime) return;
        if (settledSessions.current.has(sessionId)) return;
        settledSessions.current.add(sessionId);
        void backend.settleGameSession(sessionId).catch((reason) => {
          settledSessions.current.delete(sessionId);
          setError(reason instanceof Error ? reason.message : String(reason));
        });
        return;
      }
      const id = `award-${entry.id}-${awardSeq.current}`;
      const next = awardResult(ledger, {
        id,
        points,
        at: Date.now(),
        memo: `${entry.name} · 对局奖励`,
      });
      if (next === ledger) return;
      awardSeq.current += 1;
      setLedger(next);
    };

    return (
      <div
        className="bro-games"
        onPointerDownCapture={(event: PointerEvent<HTMLDivElement>) => {
          const button = (event.target as HTMLElement).closest("button");
          if (button && !button.disabled) playArcadeCue("tap");
        }}
      >
        <GameBar
          name={
            playing.room ? `${entry.name} · ${playing.room.name}` : entry.name
          }
          backLabel={playing.room ? "← 返回场次" : "← 返回大厅"}
          onBack={() => {
            playArcadeCue("back");
            setPlaying(null);
            if (!playing.room) setSelectingRoomsFor(null);
          }}
        />
        {view({
          onSettle,
          onServerSettled: () => void backend?.refresh(),
          room: playing.room,
          pointsBalance: balanceOf(ledger),
          entryPoints: playing.serverSession
            ? Number(playing.serverSession.entryPoints)
            : undefined,
          realtime: playing.serverSession?.realtime,
        })}
      </div>
    );
  }

  const roomEntry = selectingRoomsFor
    ? findGame(selectingRoomsFor, catalog)
    : undefined;
  if (roomEntry?.rooms?.length) {
    return (
      <div
        className="bro-games"
        onPointerDownCapture={(event: PointerEvent<HTMLDivElement>) => {
          const button = (event.target as HTMLElement).closest("button");
          if (button && !button.disabled) playArcadeCue("tap");
        }}
      >
        <GameBar
          name={`${roomEntry.name} · 选择场次`}
          onBack={() => {
            playArcadeCue("back");
            setSelectingRoomsFor(null);
          }}
        />
        {error && (
          <p className="bro-lobby__error" role="alert">
            {error}
          </p>
        )}
        <GameRoomSelector
          game={roomEntry}
          balance={balanceOf(ledger)}
          onSelect={(room) => void chargeAndPlay(roomEntry, room)}
        />
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="bro-lobby__error" role="alert">
          {error}
        </p>
      )}
      <GameLobby ledger={ledger} onEnter={onEnter} catalog={catalog} />
    </>
  );
}

/**
 * 对局页顶栏。
 *
 * 这里的返回只回大厅；应用顶栏那个箭头是离开游戏区。两个返回去往不同的地方，
 * 所以都必须带文字标签，光一个箭头说不清回到哪。
 *
 * TODO(退款)：现在中途退出不退入场费。账本里已经留了 refund_entry 这一种
 * 流水，等对局有了「是否已开始」的判定再接上——在那之前宁可不退，也不要
 * 退得不对。
 */
function GameBar({
  name,
  onBack,
  backLabel = "← 返回大厅",
}: {
  name: string;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <div className="bro-games__bar">
      <button type="button" className="bro-games__back" onClick={onBack}>
        {backLabel}
      </button>
      <span className="bro-games__title">{name}</span>
    </div>
  );
}
