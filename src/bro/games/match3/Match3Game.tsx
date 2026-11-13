/**
 * 消消乐对局页。
 *
 * 与围棋页同构：会话与服务端的生命周期由**玩法参数**决定，渲染器的生命周期
 * 由主题决定。两个 effect 依赖不同，切主题只重挂渲染器，这一局的盘面、分数、
 * 步数原封不动。
 *
 * 页面里没有任何规则判断——能不能换、换完消掉几个、够不够通关，全在服务端
 * 那侧。页面只做三件事：把快照喂给会话、把意图转给服务端、显示被拒的原因。
 *
 * ## 两个刻意的「没有」
 *
 * 1. **没有 `seed` 属性。** 种子由服务端产生（见 server/local.ts 文件头）。
 *    页面接受种子，等于把重摇盘面的能力交到调用方手里，而调用方就是客户端。
 * 2. **关卡结束前没有重开。** 失败或通关后才允许重玩本关，避免在局中通过
 *    免费重摇盘面筛选优势开局；进入下一关则沿用单机进度的首次奖励规则。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { GameSession } from "../core/session";
import type { InputIntent } from "../core/types";
import { CanvasMatch3Renderer } from "./render/canvas";
import {
  settleFirstCompletion,
  SoloProgression,
  type SoloLevelDefinition,
} from "../solo/progression";
import type { Rejection } from "./server/local";
import { LocalMatch3Server } from "./server/local";
import type { Match3Snapshot } from "./view";
import {
  DEFAULT_MOVE_LIMIT,
  DEFAULT_TARGET_SCORE,
  goalProgress,
  movesLeft,
  totalGained,
} from "./view";
import "./match3.css";

/**
 * 被拒原因的中文说法。服务端回的是稳定标识，展示文案在客户端。
 *
 * `no_match` 是这里唯一高频的一条：新手最容易的误解就是「相邻就能换」。
 * 文案必须说清楚规则，只回一句「非法操作」会让人以为是程序坏了。
 */
const REJECT_TEXT: Record<string, string> = {
  no_match: "这样换消不掉任何元素，换个位置试试",
  not_adjacent: "只能和上下左右相邻的元素交换",
  same_cell: "选中了同一格",
  out_of_bounds: "选点在盘面外",
  match_finished: "本局已经结束",
  stale_version: "盘面已更新，请重试",
  bad_payload: "操作数据异常，请重试",
};

export interface Match3GameProps {
  /**
   * 步数上限与通关分数线。
   *
   * 用两个原始值而不是一个 `Match3Goal` 对象：对象字面量每次渲染都是新引用，
   * 放进 effect 依赖会让父组件一重渲染就重开一局——盘面和分数一起清零。
   */
  readonly moveLimit?: number;
  readonly targetScore?: number;
  readonly onSettle?: (points: number) => void;
}

const MAX_DIFFICULTY = 10;
export interface Match3Level extends SoloLevelDefinition {
  readonly moveLimit: number;
  readonly targetScore: number;
}
export function match3Level(
  levelNumber: number,
  baseMoves = DEFAULT_MOVE_LIMIT,
  baseTarget = DEFAULT_TARGET_SCORE,
): Match3Level {
  const difficulty = Math.min(MAX_DIFFICULTY, Math.max(1, levelNumber));
  return {
    levelNumber,
    difficulty,
    rewardPoints: 45 + difficulty * 10,
    moveLimit: Math.max(16, baseMoves - Math.floor((difficulty - 1) / 3)),
    targetScore: Math.round(baseTarget * (1 + (difficulty - 1) * 0.07)),
  };
}

export function Match3Game({
  moveLimit: baseMoveLimit = DEFAULT_MOVE_LIMIT,
  targetScore: baseTargetScore = DEFAULT_TARGET_SCORE,
  onSettle,
}: Match3GameProps = {}) {
  const isDark = useDarkMode();
  const progression = useMemo(
    () =>
      new SoloProgression({
        gameId: "match3",
        levelFor: (number) =>
          match3Level(number, baseMoveLimit, baseTargetScore),
      }),
    [baseMoveLimit, baseTargetScore],
  );
  const [levelNumber, setLevelNumber] = useState(
    () => progression.snapshot().nextUnlockedLevel,
  );
  const [runId, setRunId] = useState(0);
  const level = match3Level(levelNumber, baseMoveLimit, baseTargetScore);
  const moveLimit = level.moveLimit;
  const targetScore = level.targetScore;
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession<Match3Snapshot["board"]> | null>(null);

  const [snapshot, setSnapshot] = useState<Match3Snapshot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [settlementNote, setSettlementNote] = useState<string | null>(null);

  // 会话与服务端：只跟玩法参数走。主题绝不能进这个依赖数组，
  // 否则切一次主题就重开一局。
  useEffect(() => {
    const server = new LocalMatch3Server({
      goal: { moveLimit, targetScore },
      onSnapshot: (next) => {
        setSnapshot(next);
        sessionRef.current?.applySnapshot(next);
      },
      onReject: (r: Rejection) =>
        setRejection(REJECT_TEXT[r.reason] ?? r.reason),
    });
    const session = new GameSession<Match3Snapshot["board"]>(
      (intent: InputIntent) => {
        setRejection(null);
        server.submit(intent);
      },
    );

    sessionRef.current = session;
    server.start();

    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [moveLimit, targetScore, runId]);

  // 渲染器：只跟主题走。会话持有状态，换渲染器后会立刻用现有盘面重绘。
  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    session.attachRenderer(
      new CanvasMatch3Renderer({ theme: isDark ? "terminal" : "ceramic" }),
      host,
    );
    return () => session.detachRenderer();
  }, [isDark, moveLimit, targetScore, runId]);

  useEffect(() => {
    if (snapshot?.board.outcome?.verdict !== "cleared") return;
    const completion = settleFirstCompletion(
      progression,
      levelNumber,
      onSettle,
    );
    setSettlementNote(
      completion.firstCompletion
        ? `首次通关奖励 ${completion.awardedPoints} 积分已结算`
        : "本关奖励已领取，本次不重复发放",
    );
  }, [levelNumber, onSettle, progression, snapshot?.board.outcome?.verdict]);

  const startLevel = (nextLevel: number) => {
    setLevelNumber(nextLevel);
    setSnapshot(null);
    setRejection(null);
    setSettlementNote(null);
    setRunId((id) => id + 1);
  };

  const currentChain = Math.max(
    0,
    ...(snapshot?.board.steps.map((step) => step.chain) ?? []),
  );
  const outcome = snapshot?.board.outcome;
  const stageState = outcome
    ? outcome.verdict === "cleared"
      ? "LEVEL CLEAR"
      : "RUN COMPLETE"
    : currentChain >= 2
      ? `CASCADE ×${currentChain}`
      : "SWAP READY";

  return (
    <div
      className="bro-match3"
      data-visual-theme={isDark ? "terminal" : "ceramic"}
    >
      {/* .bro-game-viewport 让玻璃护栏关掉这块区域内的模糊与投影：
          对局区帧率优先（glass.css §性能护栏） */}
      <section className="bro-match3__stage" aria-label="消消乐盘面">
        <div className="bro-match3__stage-head" aria-hidden="true">
          <span>PRISM ARRAY · 06</span>
          <span className="bro-match3__live">{stageState}</span>
        </div>
        <div className="bro-match3__board bro-game-viewport" ref={hostRef} />
        {outcome && (
          <div
            className={`bro-match3__stage-result is-${outcome.verdict}`}
            aria-hidden="true"
          >
            <span>
              {outcome.verdict === "cleared" ? "PRISM COMPLETE" : "SHIFT END"}
            </span>
            <strong>
              {outcome.verdict === "cleared" ? "目标达成" : "能量不足"}
            </strong>
            <small>
              {outcome.score} / {outcome.targetScore} · BEST CHAIN ×
              {Math.max(1, outcome.bestChain)}
            </small>
          </div>
        )}
      </section>

      <aside className="bro-match3__panel" aria-label="关卡信息">
        <div className="bro-match3__panel-kicker" aria-hidden="true">
          <span>MISSION CONTROL</span>
          <span>LIVE SCORE</span>
        </div>
        <div className="bro-match3__level">
          <span>第 {levelNumber} 关</span>
          <span>
            难度 {level.difficulty}/{MAX_DIFFICULTY}
          </span>
          <span>首次奖励 {level.rewardPoints}</span>
        </div>
        <Scoreboard
          snapshot={snapshot}
          levelNumber={levelNumber}
          onReplay={() => startLevel(levelNumber)}
          onNext={() => startLevel(levelNumber + 1)}
          settlementNote={settlementNote}
        />

        {rejection && (
          <p className="bro-match3__reject" role="alert">
            {rejection}
          </p>
        )}
      </aside>
    </div>
  );
}

function Scoreboard({
  snapshot,
  levelNumber,
  onReplay,
  onNext,
  settlementNote,
}: {
  snapshot: Match3Snapshot | null;
  levelNumber: number;
  onReplay: () => void;
  onNext: () => void;
  settlementNote: string | null;
}) {
  if (!snapshot) return <p className="bro-match3__status">正在开局…</p>;

  const view = snapshot.board;
  const { outcome } = view;
  const gained = totalGained(view.steps);
  // 百分比只作宽度用，读数一律看分数本身——进度条约到 100% 而分数没到线时
  // 玩家会以为已经通关
  const percent = `${Math.round(goalProgress(view) * 100)}%`;

  return (
    <>
      <p
        className={`bro-match3__status ${outcome ? "is-finished" : "is-playing"}`}
      >
        {outcome
          ? outcome.verdict === "cleared"
            ? "通关"
            : "未通关"
          : `剩余 ${movesLeft(view)} 步`}
      </p>

      <div className="bro-match3__score">
        <span className="bro-match3__score-value">{view.score}</span>
        <span className="bro-match3__score-target">/ {view.targetScore}</span>
        {gained > 0 && !outcome && (
          // key 让每次得分都重新触发一次入场动画；不加 key 时 React 复用同一个
          // 节点，连续两次同样的加分就不会有任何视觉反馈
          <span className="bro-match3__gain" key={snapshot.version}>
            +{gained}
          </span>
        )}
        {view.steps.length > 1 && !outcome && (
          <span className="bro-match3__combo" key={`combo-${snapshot.version}`}>
            CASCADE ×{Math.max(...view.steps.map((step) => step.chain))}
          </span>
        )}
      </div>

      <div
        className="bro-match3__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={view.targetScore}
        aria-valuenow={Math.min(view.score, view.targetScore)}
        aria-label="通关进度"
      >
        <div className="bro-match3__progress-fill" style={{ width: percent }} />
      </div>

      <dl className="bro-match3__stats">
        <div className="bro-match3__stat">
          <dt>步数</dt>
          <dd>
            {view.movesUsed} / {view.moveLimit}
          </dd>
        </div>
        <div className="bro-match3__stat">
          <dt>最高连锁</dt>
          <dd>{view.bestChain > 0 ? `×${view.bestChain}` : "—"}</dd>
        </div>
      </dl>

      {view.reshuffled && !outcome && (
        <p className="bro-match3__hint" role="status">
          已无可行交换，盘面重排
        </p>
      )}

      {outcome && (
        <div className={`bro-match3__finish is-${outcome.verdict}`}>
          <p className="bro-match3__outcome">
            {outcome.verdict === "cleared"
              ? `第 ${levelNumber} 关通关 · 用 ${outcome.movesUsed} 步达成目标`
              : `挑战失败 · 差 ${outcome.targetScore - outcome.score} 分未达线`}
          </p>
          {outcome.verdict === "cleared" && settlementNote && (
            <p className="bro-match3__settlement" role="status">
              {settlementNote}
            </p>
          )}
          <div className="bro-match3__actions">
            <button type="button" onClick={onReplay}>
              重玩本关
            </button>
            {outcome.verdict === "cleared" && (
              <button type="button" onClick={onNext}>
                下一关
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
