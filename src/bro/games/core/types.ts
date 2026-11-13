

/** 六款游戏的标识。与服务端 match 类型一一对应。 */
export type GameId =
  | "billiards"
  | "doudizhu"
  | "riichi"
  | "match3"
  | "xiangqi"
  | "go";


export type RenderMode = "canvas" | "tui";

/** 对局阶段。 */
export type MatchPhase =
  /** 匹配中。无房间概念，玩家只能排队等待撮合。 */
  | "matchmaking"
  | "playing"
  /** 对手掉线，等待重连或判定超时。 */
  | "opponent_disconnected"
  | "finished";

/**
 * 服务端下发的对局状态快照。
 *
 * `T` 是各游戏自己的局面类型（棋盘、手牌、球桌……）。内核不理解它，
 * 只负责传递——内核一旦理解具体游戏，就会变成六款游戏的公共耦合点。
 */
export interface GameState<T> {
  matchId: string;
  gameId: GameId;
  phase: MatchPhase;
  /**
   * 服务端状态版本号，单调递增。
   *
   * 用于丢弃乱序到达的旧快照。网络层不保证顺序，比较时间戳会在
   * 时钟漂移下出错，因此用服务端序号而非时间。
   */
  version: number;
  /** 轮到谁行动。`null` 表示当前无人可行动（结算中、等待中）。 */
  activeSeat: number | null;
  /** 本机玩家的座位号。观战时为 `null`。 */
  mySeat: number | null;
  /** 各游戏自有的局面数据。 */
  board: T;
}

/**
 * 玩家输入意图。
 *
 * 命名刻意用 intent 而非 action：这是请求，不是既成事实。
 * 服务端可能拒绝（非法、不是你的回合、状态已变）。
 */
export interface InputIntent<P = unknown> {
  matchId: string;
  /** 意图基于的状态版本。服务端据此拒绝基于过期局面的操作。 */
  basedOnVersion: number;
  type: string;
  payload: P;
}

/**
 * 渲染器接口。
 *
 * Canvas 与 TUI 两种实现共用此接口，因此上层无需知道当前是哪种模式。
 * 注意接口中没有任何「计算下一步状态」的方法——这是刻意的，规则不在
 * 渲染层，写不进来。
 */
export interface GameRenderer<T> {
  readonly mode: RenderMode;

  /** 挂载到容器。 */
  mount(container: HTMLElement): void;

  /** 渲染一帧。同一状态重复调用必须产生相同结果（幂等）。 */
  render(state: GameState<T>): void;

  /**
   * 注册输入意图回调。
   *
   * 渲染器捕获用户操作（点击/键盘）后调用它，不直接改状态。
   */
  onIntent(handler: (intent: InputIntent) => void): void;

  /** 卸载并释放资源（Canvas 上下文、事件监听、动画帧）。 */
  unmount(): void;
}

/**
 * 判断新快照是否应当被采纳。
 *
 * 网络层不保证顺序，晚到的旧快照会让画面回退。丢弃条件是版本号不前进；
 * 同版本重复下发也丢弃，避免无谓重绘。
 */
export function shouldAccept<T>(
  current: GameState<T> | null,
  incoming: GameState<T>,
): boolean {
  if (current === null) return true;
  if (current.matchId !== incoming.matchId) return true;
  return incoming.version > current.version;
}

/**
 * 本机玩家当前是否可以行动。
 *
 * 观战（`mySeat === null`）与非本人回合都不可行动。渲染器据此决定是否
 * 接受输入——但这只是体验优化，真正的裁定在服务端。
 */
export function canAct<T>(state: GameState<T>): boolean {
  return (
    state.phase === "playing" &&
    state.mySeat !== null &&
    state.activeSeat === state.mySeat
  );
}

/**
 * 游戏始终使用可交互的 H5 Canvas。暗色主题由 CSS 提供终端/TUI 视觉语言，
 * 不再切换到真正的字符画渲染器。
 */
export function renderModeForTheme(_theme: "light" | "dark"): RenderMode {
  return "canvas";
}
