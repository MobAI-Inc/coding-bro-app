

import type { GameState, InputIntent } from "../../core/types";
import type { Match3Config, Match3State, Pos } from "../logic";
import {
  DEFAULT_CONFIG,
  applySwap,
  createInitialState,
  hashSeed,
} from "../logic";
import type {
  Match3Goal,
  Match3Outcome,
  Match3Step,
  Match3View,
  SwapPayload,
} from "../view";
import { DEFAULT_GOAL, MATCH3_INTENT, SEAT_PLAYER, viewCellsOf } from "../view";

/** 意图被拒的原因。透传给界面用于提示，不影响状态。 */
export interface Rejection {
  readonly reason: string;
  readonly detail?: string;
}

export interface LocalMatch3ServerOptions {
  readonly matchId?: string;
  readonly config?: Match3Config;
  readonly goal?: Match3Goal;
  /**
   * 显式种子。**只有测试与复盘该传。**
   *
   * 留这个口子是因为「同一个种子必然长出同一局」正是需要被断言的性质，不给
   * 注入口就只能靠捞随机结果来测。生产路径（Match3Game）不传，见文件头。
   */
  readonly seed?: number;
  readonly onSnapshot: (snapshot: GameState<Match3View>) => void;
  readonly onReject?: (rejection: Rejection) => void;
}

/**
 * 本地 matchId 的自增序号。
 *
 * 真服务端的 matchId 来自撮合，本地没有撮合，只好自己造一个。用「时间 +
 * 进程内自增」而不是随机数：一是不必引入 `Math.random`（引擎明令禁用它，
 * 同一个模块里再出现容易被后人照抄进规则），二是自增能保证同一毫秒内连开
 * 两局也不会撞成同一个盘面。
 */
let localMatchSeq = 0;

function nextLocalMatchId(): string {
  localMatchSeq += 1;
  return `local-m3-${Date.now().toString(36)}-${localMatchSeq}`;
}

export class LocalMatch3Server {
  private state: Match3State;
  private version = 0;
  private lastSwap: readonly [Pos, Pos] | null = null;
  private steps: readonly Match3Step[] = [];
  private bestChain = 0;
  private reshuffled = false;
  private outcome: Match3Outcome | null = null;

  private readonly matchId: string;
  private readonly seed: number;
  private readonly goal: Match3Goal;
  private readonly onSnapshot: (snapshot: GameState<Match3View>) => void;
  private readonly onReject: (rejection: Rejection) => void;

  constructor(options: LocalMatch3ServerOptions) {
    this.matchId = options.matchId ?? nextLocalMatchId();
    this.seed = options.seed ?? hashSeed(this.matchId);
    this.goal = options.goal ?? DEFAULT_GOAL;
    this.state = createInitialState(
      this.seed,
      options.config ?? DEFAULT_CONFIG,
    );
    this.onSnapshot = options.onSnapshot;
    this.onReject = options.onReject ?? (() => {});
  }

  /** 下发首帧快照。对应真服务端开局推送。 */
  start(): void {
    this.emit();
  }

  /**
   * 处理一条意图。
   *
   * 校验顺序是刻意的：对局 → 版本 → 是否已终局 → 意图类型 → 载荷 → 规则。
   * 先粗后细，每一层都不依赖后一层的前置条件成立。尤其是「已终局」必须排在
   * 规则之前——终局后盘面仍是合法的可交换状态，交给引擎它会照单全收，分数
   * 就能在结算之后继续涨。
   */
  submit(intent: InputIntent): void {
    if (intent.matchId !== this.matchId) {
      return this.onReject({ reason: "wrong_match" });
    }
    if (intent.basedOnVersion !== this.version) {
      // 客户端基于旧盘面操作。多发生在动画未播完就连点，属正常流程。
      return this.onReject({
        reason: "stale_version",
        detail: `客户端基于 v${intent.basedOnVersion}，当前 v${this.version}`,
      });
    }
    if (this.outcome !== null) {
      return this.onReject({ reason: "match_finished" });
    }
    if (intent.type !== MATCH3_INTENT.swap) {
      return this.onReject({ reason: "unknown_intent", detail: intent.type });
    }

    const payload = parseSwapPayload(intent.payload);
    if (payload === null) {
      // 坐标不是整数、或者根本没有坐标。引擎的越界判断挡得住 NaN，却挡不住
      // 载荷缺字段——那会在读 `.row` 时抛异常，把一次脏输入升级成服务端崩溃。
      return this.onReject({ reason: "bad_payload" });
    }

    const result = applySwap(this.state, payload.a, payload.b);
    if (!result.accepted) {
      return this.onReject({ reason: result.rejection ?? "rejected" });
    }

    this.state = result.state;
    this.steps = result.steps.map((step) => ({
      chain: step.chain,
      cleared: step.cleared,
      gained: step.gained,
      groups: step.groups.length,
    }));
    this.bestChain = Math.max(this.bestChain, this.steps.length);
    this.lastSwap = [payload.a, payload.b];
    this.reshuffled = result.reshuffled;
    this.outcome = this.settle();
    this.version += 1;
    this.emit();
  }

  /** 当前权威状态。仅供测试断言，界面一律走快照。 */
  authoritativeState(): Match3State {
    return this.state;
  }

  /**
   * 本局种子。仅供测试与复盘。
   *
   * 单独开一个读取口而不是让调用方从快照里取，是为了让「种子来自服务端」
   * 这件事在测试里能被直接断言，而不是绕道视图去推断。
   */
  authoritativeSeed(): number {
    return this.seed;
  }

  /**
   * 终局判定。返回 `null` 表示未终局。
   *
   * **达标优先于步数耗尽。** 最后一步刚好打到目标分的那一局，两个条件同时
   * 成立；若先判步数，这局会被判成未通关——玩家明明看到分数够了却没过关，
   * 这是最伤信任的一类结算错误。顺序不能调换，测试里有专门的用例钉住它。
   */
  private settle(): Match3Outcome | null {
    const base = {
      score: this.state.score,
      targetScore: this.goal.targetScore,
      movesUsed: this.state.moves,
      bestChain: this.bestChain,
    };
    if (this.state.score >= this.goal.targetScore) {
      return { verdict: "cleared", ...base };
    }
    if (this.state.moves >= this.goal.moveLimit) {
      return { verdict: "failed", ...base };
    }
    return null;
  }

  private emit(): void {
    const view: Match3View = {
      width: this.state.grid.width,
      height: this.state.grid.height,
      kinds: this.state.config.kinds,
      cells: viewCellsOf(this.state.grid),
      score: this.state.score,
      targetScore: this.goal.targetScore,
      movesUsed: this.state.moves,
      moveLimit: this.goal.moveLimit,
      seed: this.seed,
      lastSwap: this.lastSwap,
      steps: this.steps,
      bestChain: this.bestChain,
      reshuffled: this.reshuffled,
      outcome: this.outcome,
    };

    this.onSnapshot({
      matchId: this.matchId,
      gameId: "match3",
      phase: this.outcome ? "finished" : "playing",
      version: this.version,
      // 终局后置空：`canAct` 据此关掉输入，渲染器不必各自判断 outcome
      activeSeat: this.outcome ? null : SEAT_PLAYER,
      mySeat: SEAT_PLAYER,
      board: view,
    });
  }
}

/**
 * 校验交换载荷。
 *
 * 只认整数坐标。不在这里判越界与相邻——那是规则，规则归引擎；这里只挡
 * 「结构上就不是一次交换」的输入。两者混在一起会出现两份边界判断，改盘面
 * 尺寸时必漏一处。
 */
function parseSwapPayload(payload: unknown): SwapPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { a, b } = payload as { a?: unknown; b?: unknown };
  const posA = parsePos(a);
  const posB = parsePos(b);
  if (posA === null || posB === null) return null;
  return { a: posA, b: posB };
}

function parsePos(value: unknown): Pos | null {
  if (typeof value !== "object" || value === null) return null;
  const { row, col } = value as { row?: unknown; col?: unknown };
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row: row as number, col: col as number };
}
