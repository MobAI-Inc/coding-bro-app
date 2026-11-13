/**
 * 游戏目录。
 *
 * 六款游戏的唯一事实来源：大厅按这份表渲染，入场费按这份表收，路由按这份
 * 表分发。新增一款游戏只改这一处。
 *
 * `status` 必须如实反映能不能玩。大厅上摆一张点进去是空白页的卡片，比不
 * 摆这张卡片更糟——用户会以为是坏了而不是没做完。
 */

/** 游戏标识。同时用作路由片段与账本 memo 的前缀，改名等于改数据。 */
export type GameId =
  | "baccarat"
  | "slots"
  | "holdem"
  | "match3"
  | "blackjack"
  | "gold-miner";

export type GameStatus =
  /** 能进能玩 */
  | "playable"
  /** 规则引擎已就绪，界面还没做完 */
  | "engine_ready"
  /** 还没开工 */
  | "planned";

export interface GameEntry {
  readonly id: GameId;
  readonly name: string;
  /** 一句话说清这局要花多久、跟谁玩。大厅卡片上就显示这句。 */
  readonly blurb: string;
  
  readonly price: number;
  readonly status: GameStatus;
  /**
   * TUI 大厅里代表这款游戏的字符。不用 emoji（UI-DESIGN.md §8）。
   *
   * 这些字符宽度不齐：`帥萬` 是全宽，`●◆♠◉` 在 Unicode 里属 Ambiguous，
   * 实际宽度随字体变。所以 TUI 大厅**不靠字符对齐排版**，字形放在固定宽度
   * 的 CSS 格子里——跟围棋盘上那个光标是同一个教训。
   */
  readonly glyph: string;
  /**
   * 有场次的牌桌先选房间，再按所选房间扣入场积分。`price` 始终等于最便宜
   * 房间的价格，因此大厅的余额门槛与“x 积分起”不会互相打架。
   */
  readonly rooms?: readonly GameRoom[];
}

export interface GameRoom {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly label: string;
  readonly detail: string;
  readonly featured?: boolean;
}

/** Economic values returned by GET /api/games and enforced by the backend. */
export interface GameEconomy {
  readonly id: GameId;
  readonly entryPoints: number;
  readonly rooms: readonly {
    readonly id: string;
    readonly entryPoints: number;
  }[];
}

export const GAME_CATALOG: readonly GameEntry[] = [
  {
    id: "baccarat",
    name: "百家乐",
    blurb: "托管牌桌 · 三门下注 · 即时开奖",
    price: 80,
    status: "playable",
    glyph: "B",
    rooms: [
      {
        id: "baccarat-salon",
        name: "霁光厅",
        price: 80,
        label: "新手场",
        detail: "10 / 25 / 50 筹码 · 轻量牌桌",
      },
      {
        id: "baccarat-club",
        name: "长夜俱乐部",
        price: 240,
        label: "进阶场",
        detail: "30 / 75 / 150 筹码 · 节奏更快",
        featured: true,
      },
      {
        id: "baccarat-vault",
        name: "金库厅",
        price: 600,
        label: "高额场",
        detail: "100 / 250 / 500 筹码 · 高波动",
      },
    ],
  },
  {
    id: "slots",
    name: "老虎机",
    blurb: "单机 · 三轴连线 · 即开即玩",
    price: 30,
    status: "playable",
    glyph: "7",
  },
  {
    id: "holdem",
    name: "德州扑克",
    blurb: "三席牌桌 · 完整四轮下注 · 即时组桌",
    price: 100,
    status: "playable",
    glyph: "♠",
    rooms: [
      {
        id: "holdem-garage",
        name: "车库桌",
        price: 100,
        label: "10 / 20",
        detail: "500 起始筹码 · 适合热身",
      },
      {
        id: "holdem-studio",
        name: "Studio 桌",
        price: 300,
        label: "30 / 60",
        detail: "1,500 起始筹码 · 标准强度",
        featured: true,
      },
      {
        id: "holdem-mainframe",
        name: "Mainframe 桌",
        price: 800,
        label: "80 / 160",
        detail: "4,000 起始筹码 · 高额对局",
      },
    ],
  },
  {
    id: "match3",
    name: "消消乐",
    blurb: "标准三消 · 特殊元素与连击",
    price: 30,
    status: "playable",
    glyph: "◆",
  },
  {
    id: "blackjack",
    name: "21 点",
    blurb: "三席牌桌 · 对战庄家 · 即时组桌",
    price: 60,
    status: "playable",
    glyph: "21",
    rooms: [
      {
        id: "blackjack-lounge",
        name: "休息室",
        price: 60,
        label: "新手场",
        detail: "10 最低下注 · 轻松熟悉规则",
      },
      {
        id: "blackjack-counter",
        name: "深夜柜台",
        price: 180,
        label: "进阶场",
        detail: "30 最低下注 · 更高结算",
        featured: true,
      },
      {
        id: "blackjack-penthouse",
        name: "顶层桌",
        price: 450,
        label: "高额场",
        detail: "75 最低下注 · 高额牌局",
      },
    ],
  },
  {
    id: "gold-miner",
    name: "黄金矿工",
    blurb: "单机 · 限时抓取 · 连续闯关",
    price: 30,
    status: "playable",
    glyph: "G",
  },
];

export function mergeGameEconomy(
  presentation: readonly GameEntry[],
  economy: readonly GameEconomy[],
): readonly GameEntry[] {
  const byId = new Map(economy.map((game) => [game.id, game]));
  return presentation.map((game) => {
    const server = byId.get(game.id);
    if (!server) throw new Error(`服务端缺少 ${game.id} 的游戏经济配置`);
    const rooms = game.rooms?.map((room) => {
      const serverRoom = server.rooms.find((item) => item.id === room.id);
      if (!serverRoom) {
        throw new Error(`服务端缺少 ${game.id}/${room.id} 的场次经济配置`);
      }
      return { ...room, price: serverRoom.entryPoints };
    });
    return { ...game, price: server.entryPoints, rooms };
  });
}

export function findGame(
  id: GameId,
  catalog: readonly GameEntry[] = GAME_CATALOG,
): GameEntry | undefined {
  return catalog.find((g) => g.id === id);
}

/** 只有 playable 的游戏能真的进去。大厅、路由、扣费三处都要用这一个判断。 */
export function isEnterable(entry: GameEntry): boolean {
  return entry.status === "playable";
}
