import { useCallback, useMemo, useRef, useState } from "react";
import { Pickaxe, Timer } from "lucide-react";
import type Phaser from "phaser";
import { PhaserGame } from "../runtime/PhaserGame";
import {
  settleFirstCompletion,
  SoloProgression,
  type SoloLevelDefinition,
} from "../solo/progression";
import "../runtime/phaser-game.css";
import "./gold-miner.css";

interface MinerHud {
  readonly score: number;
  readonly seconds: number;
  readonly target: number;
  readonly message: string;
  readonly phase: "ready" | "playing" | "cleared" | "failed";
  readonly hookState: "aiming" | "descending" | "hauling" | "finished";
}

const INITIAL_HUD: MinerHud = {
  score: 0,
  seconds: 60,
  target: 180,
  message: "点击矿区或按空格放下抓手",
  phase: "ready",
  hookState: "aiming",
};

export const GOLD_MINER_MAX_DIFFICULTY = 100;
export const GOLD_MINER_MAX_SWING_RAD = 1.3;
export const GOLD_MINER_MAX_ROPE_LENGTH = 620;

export const GOLD_MINER_GEOMETRY = {
  width: 900,
  height: 560,
  originX: 450,
  originY: 102,
  mineMinX: 58,
  mineMaxX: 842,
  mineMinY: 225,
  mineMaxY: 506,
} as const;

export interface GoldMinerDifficultyProfile {
  readonly difficulty: number;
  readonly progress: number;
  readonly oreCount: number;
  readonly rockChance: number;
  readonly rockWeight: number;
}

export function goldMinerDifficultyProfile(
  levelNumber: number,
): GoldMinerDifficultyProfile {
  const difficulty = Math.min(
    GOLD_MINER_MAX_DIFFICULTY,
    Math.max(1, Math.floor(levelNumber)),
  );
  const progress =
    (difficulty - 1) / Math.max(1, GOLD_MINER_MAX_DIFFICULTY - 1);
  return {
    difficulty,
    progress,
    // 7 → 13 objects over one hundred levels. Keeping the field sparse is
    // important: overlapping hit circles make a visually clear target lie.
    oreCount: 7 + Math.round(progress * 6),
    // Rocks grow from 15% to 39%, gradually enough that the early game still
    // teaches aiming before it starts taxing hauling time.
    rockChance: 0.15 + progress * 0.24,
    rockWeight: 2.55 + progress * 0.65,
  };
}

export interface GoldMinerLevel extends SoloLevelDefinition {
  readonly levelNumber: number;
  readonly target: number;
  readonly seconds: number;
}
export function goldMinerLevel(levelNumber: number): GoldMinerLevel {
  const profile = goldMinerDifficultyProfile(levelNumber);
  const { difficulty, progress } = profile;
  return {
    levelNumber,
    difficulty,
    // Preserve the old reward band (65 → 155) while spreading it smoothly
    // across the longer progression instead of inflating the economy 10×.
    rewardPoints: 65 + Math.round(progress * 90),
    // The quadratic part is deliberately back-loaded: early targets rise by
    // only a few points per level, while veteran levels still tighten.
    target: 135 + Math.round(progress * 110 + progress * progress * 155),
    seconds: 60 - Math.round(progress * 16),
  };
}

export function GoldMinerGame({
  onSettle,
}: { onSettle?: (points: number) => void } = {}) {
  const progression = useMemo(
    () =>
      new SoloProgression({ gameId: "gold-miner", levelFor: goldMinerLevel }),
    [],
  );
  const [levelNumber, setLevelNumber] = useState(
    () => progression.snapshot().nextUnlockedLevel,
  );
  const [runId, setRunId] = useState(0);
  const [gameMounted, setGameMounted] = useState(false);
  const level = goldMinerLevel(levelNumber);
  const [hud, setHud] = useState<MinerHud>(() => ({
    ...INITIAL_HUD,
    seconds: level.seconds,
    target: level.target,
  }));
  const controls = useMemo(() => new EventTarget(), []);
  const onHud = useCallback((next: MinerHud) => setHud(next), []);
  const onFinish = useCallback(
    (cleared: boolean) => {
      if (!cleared) return;
      const completion = settleFirstCompletion(
        progression,
        levelNumber,
        onSettle,
      );
      if (completion.firstCompletion) {
        setHud((current) => ({
          ...current,
          message: `通关 · 首次奖励 ${completion.awardedPoints} 积分`,
        }));
      } else
        setHud((current) => ({
          ...current,
          message: "通关 · 本关奖励已领取，本次不重复发放",
        }));
    },
    [levelNumber, onSettle, progression],
  );
  // Awarding points rerenders GamesRoute and creates a new onSettle callback.
  // Keep the Phaser config independent from that callback identity: otherwise
  // the completed scene is destroyed and the same mine appears to "refresh"
  // the instant a valuable ore reaches the rig.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const createConfig = useMemo(
    () =>
      createGoldMinerConfig(
        onHud,
        (cleared) => onFinishRef.current(cleared),
        controls,
        goldMinerLevel(levelNumber),
      ),
    [controls, levelNumber, onHud, runId],
  );

  const startLevel = (nextLevel: number) => {
    const next = goldMinerLevel(nextLevel);
    setLevelNumber(nextLevel);
    setGameMounted(false);
    setHud({
      ...INITIAL_HUD,
      seconds: next.seconds,
      target: next.target,
      phase: "ready",
      message: `第 ${nextLevel} 关待命 · 确认目标后开始`,
    });
  };

  const beginLevel = () => {
    setHud({
      ...INITIAL_HUD,
      seconds: level.seconds,
      target: level.target,
      phase: "playing",
    });
    setRunId((id) => id + 1);
    setGameMounted(true);
  };

  return (
    <main className="bro-miner bro-game-shell">
      <section className="bro-miner__cabinet">
        <header className="bro-miner__titlebar">
          <div className="bro-miner__identity">
            <Pickaxe size={17} aria-hidden="true" />
            <div>
              <span className="bro-game-kicker">SOLO / PHASER ARCADE</span>
              <h2>深层矿脉</h2>
            </div>
          </div>
          <p>
            <Timer size={15} aria-hidden="true" /> 逐帧抓取 · 越重回收越慢
          </p>
        </header>

        <div className="bro-miner__screen-frame">
          {gameMounted ? (
            <PhaserGame
              className="bro-phaser-game bro-miner__game"
              ariaLabel={`黄金矿工第 ${levelNumber} 关游戏画面`}
              createConfig={createConfig}
            />
          ) : (
            <div className="bro-miner__briefing">
              <span>LEVEL {String(levelNumber).padStart(2, "0")}</span>
              <h3>矿区勘探简报</h3>
              <p>
                在 {level.seconds} 秒内回收至少 {level.target} 分矿物
              </p>
              <dl>
                <div>
                  <dt>难度</dt>
                  <dd>
                    {level.difficulty}/{GOLD_MINER_MAX_DIFFICULTY}
                  </dd>
                </div>
                <div>
                  <dt>矿区编号</dt>
                  <dd>DV-{levelNumber * 17}</dd>
                </div>
                <div>
                  <dt>首次奖励</dt>
                  <dd>{level.rewardPoints} 积分</dd>
                </div>
              </dl>
              <button type="button" onClick={beginLevel}>
                开始第 {levelNumber} 关
              </button>
            </div>
          )}
        </div>

        <aside className="bro-miner__hud" aria-live="polite">
          <div>
            <span>LEVEL</span>
            <strong>{levelNumber}</strong>
          </div>
          <div>
            <span>DIFFICULTY</span>
            <strong>
              {level.difficulty}/{GOLD_MINER_MAX_DIFFICULTY}
            </strong>
          </div>
          <div>
            <span>TIME</span>
            <strong>{String(hud.seconds).padStart(2, "0")}</strong>
          </div>
          <div>
            <span>SCORE</span>
            <strong>{hud.score}</strong>
          </div>
          <div>
            <span>TARGET</span>
            <strong>{hud.target}</strong>
          </div>
          <div
            className="bro-miner__meter"
            role="progressbar"
            aria-label="本关目标进度"
            aria-valuemin={0}
            aria-valuemax={hud.target}
            aria-valuenow={Math.min(hud.score, hud.target)}
          >
            <i
              style={{
                width: `${Math.min(100, (hud.score / hud.target) * 100)}%`,
              }}
            />
          </div>
          <p role="status">{hud.message}</p>
          {hud.phase === "playing" && (
            <button
              type="button"
              onClick={() => controls.dispatchEvent(new Event("fire"))}
              disabled={hud.hookState !== "aiming"}
            >
              {hud.hookState === "aiming"
                ? "下钩"
                : hud.hookState === "descending"
                  ? "抓手下潜中"
                  : "负载回收中"}
              {hud.hookState === "aiming" && <kbd>SPACE</kbd>}
            </button>
          )}
          {(hud.phase === "cleared" || hud.phase === "failed") && (
            <div className="bro-miner__actions">
              <button type="button" onClick={() => startLevel(levelNumber)}>
                返回关卡简报
              </button>
              {hud.phase === "cleared" && (
                <button
                  type="button"
                  onClick={() => startLevel(levelNumber + 1)}
                >
                  下一关
                </button>
              )}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

type Runtime = typeof Phaser;
type HudSink = (hud: MinerHud) => void;

export interface OreSpec {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly value: number;
  readonly weight: number;
  readonly kind: "gold" | "rock" | "diamond";
}

interface OreActor extends OreSpec {
  readonly id: number;
  readonly body: Phaser.GameObjects.Container;
  caught: boolean;
}

export type GoldMinerRunPhase = "playing" | "cleared" | "failed";

export interface GoldMinerRunState {
  readonly score: number;
  readonly phase: GoldMinerRunPhase;
  readonly remainingOreIds: readonly number[];
}

export function createGoldMinerRun(oreCount: number): GoldMinerRunState {
  return {
    score: 0,
    phase: "playing",
    remainingOreIds: Array.from({ length: oreCount }, (_, index) => index),
  };
}

/**
 * Settle exactly one hauled object. The mine layout is deliberately absent
 * from this transition: removing an ore must never regenerate the field.
 */
export function settleGoldMinerOre(
  run: GoldMinerRunState,
  oreId: number,
  value: number,
  target: number,
): GoldMinerRunState {
  if (run.phase !== "playing" || !run.remainingOreIds.includes(oreId))
    return run;

  const score = run.score + value;
  return {
    score,
    phase: score >= target ? "cleared" : "playing",
    remainingOreIds: run.remainingOreIds.filter((id) => id !== oreId),
  };
}

export function goldMinerRetractSpeed(weight: number): number {
  return 440 / Math.max(0.5, weight);
}

export interface GoldMinerAim {
  readonly angle: number;
  readonly length: number;
  readonly reachable: boolean;
}

/** Geometry shared by generation tests and the live hook. */
export function goldMinerAimTo(x: number, y: number): GoldMinerAim {
  const dx = x - GOLD_MINER_GEOMETRY.originX;
  const dy = y - GOLD_MINER_GEOMETRY.originY;
  const angle = Math.atan2(dx, dy);
  const length = Math.hypot(dx, dy);
  return {
    angle,
    length,
    reachable:
      dy > 0 &&
      Math.abs(angle) <= GOLD_MINER_MAX_SWING_RAD &&
      length <= GOLD_MINER_MAX_ROPE_LENGTH,
  };
}

/** Deterministic per-level mine: a new level always creates a visibly new field. */
export function goldMinerLayout(levelNumber: number): readonly OreSpec[] {
  const profile = goldMinerDifficultyProfile(levelNumber);
  const level = goldMinerLevel(levelNumber);
  let seed = (levelNumber * 0x9e3779b1) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const xSpan = GOLD_MINER_GEOMETRY.mineMaxX - GOLD_MINER_GEOMETRY.mineMinX + 1;
  const ySpan = GOLD_MINER_GEOMETRY.mineMaxY - GOLD_MINER_GEOMETRY.mineMinY + 1;
  const count = profile.oreCount;
  const mine = Array.from({ length: count }, (_, index) => {
    const roll = random();
    const kind: OreSpec["kind"] =
      roll < profile.rockChance ? "rock" : roll > 0.88 ? "diamond" : "gold";
    const radius =
      kind === "diamond"
        ? 18 + Math.round(random() * 5)
        : 24 + Math.round(random() * 18);
    return {
      x:
        GOLD_MINER_GEOMETRY.mineMinX +
        ((index * 113 + Math.round(random() * 57) + levelNumber * 19) % xSpan),
      y:
        GOLD_MINER_GEOMETRY.mineMinY +
        ((index * 89 + Math.round(random() * 61) + levelNumber * 31) % ySpan),
      radius,
      value:
        kind === "diamond"
          ? 90
          : kind === "rock"
            ? 18
            : 38 + Math.round(random() * 27),
      weight:
        kind === "diamond"
          ? 0.7
          : kind === "rock"
            ? profile.rockWeight
            : 1.1 + radius / 42,
      kind,
    };
  });
  return ensureMineValue(mine, Math.ceil(level.target * 1.12));
}

/**
 * Seeded randomness may occasionally roll an almost all-rock field. Preserve
 * the layout but enrich the lowest-value seams until the level contains some
 * strategic slack above its target; a generated impossible level is not
 * difficulty, it is a broken contract.
 */
function ensureMineValue(
  mine: readonly OreSpec[],
  minimumValue: number,
): readonly OreSpec[] {
  let total = mine.reduce((sum, ore) => sum + ore.value, 0);
  if (total >= minimumValue) return mine;

  const enriched = mine.map((ore) => ({ ...ore }));
  const candidates = enriched
    .map((ore, index) => ({ index, value: ore.value }))
    .sort((a, b) => a.value - b.value || a.index - b.index);

  for (const { index } of candidates) {
    if (total >= minimumValue) break;
    const ore = enriched[index];
    if (ore.kind === "diamond") continue;
    const value = Math.max(68, ore.value);
    total += value - ore.value;
    enriched[index] = {
      ...ore,
      kind: "gold",
      value,
      weight: 1.1 + ore.radius / 42,
    };
  }
  return enriched;
}

function createGoldMinerConfig(
  onHud: HudSink,
  onFinish: (cleared: boolean) => void,
  controls: EventTarget,
  level: GoldMinerLevel,
) {
  const mine = goldMinerLayout(level.levelNumber);
  return (runtime: Runtime): Phaser.Types.Core.GameConfig => {
    class GoldMinerScene extends runtime.Scene {
      private rope!: Phaser.GameObjects.Graphics;
      private hook!: Phaser.GameObjects.Container;
      private ores: OreActor[] = [];
      private angle = -1.06;
      private direction = 1;
      private length = 64;
      private mode: "swing" | "extend" | "retract" | "finished" = "swing";
      private caught: OreActor | null = null;
      private run = createGoldMinerRun(mine.length);
      private seconds = level.seconds;
      private elapsed = 0;
      private message = INITIAL_HUD.message;
      private resultShown = false;

      constructor() {
        super("gold-miner");
      }

      create() {
        this.drawWorld();
        this.rope = this.add.graphics().setDepth(8);
        const hookMetal = this.add.graphics();
        hookMetal.lineStyle(7, 0xd8d2c5, 1);
        hookMetal.beginPath();
        hookMetal.arc(0, 0, 18, 0.15, Math.PI - 0.15, false);
        hookMetal.strokePath();
        hookMetal.lineStyle(3, 0x4a443b, 1);
        hookMetal.beginPath();
        hookMetal.moveTo(-17, 2);
        hookMetal.lineTo(-25, -7);
        hookMetal.moveTo(17, 2);
        hookMetal.lineTo(25, -7);
        hookMetal.strokePath();
        this.hook = this.add.container(450, 116, [hookMetal]).setDepth(10);
        this.input.on("pointerdown", () => this.fire());
        this.input.keyboard?.on("keydown-SPACE", () => this.fire());
        const fireFromHud = () => this.fire();
        controls.addEventListener("fire", fireFromHud);
        this.events.once(runtime.Scenes.Events.SHUTDOWN, () =>
          controls.removeEventListener("fire", fireFromHud),
        );
        this.emitHud();
      }

      update(_time: number, delta: number) {
        const dt = Math.min(delta, 40) / 1000;
        this.advanceClock(dt);

        if (this.mode === "swing") {
          this.angle += this.direction * dt * 1.05;
          if (
            this.angle > GOLD_MINER_MAX_SWING_RAD ||
            this.angle < -GOLD_MINER_MAX_SWING_RAD
          ) {
            this.angle = runtime.Math.Clamp(
              this.angle,
              -GOLD_MINER_MAX_SWING_RAD,
              GOLD_MINER_MAX_SWING_RAD,
            );
            this.direction *= -1;
          }
        } else if (this.mode === "extend") {
          this.length += dt * 520;
          const hit = this.findHit();
          if (hit) {
            this.caught = hit;
            hit.caught = true;
            hit.body.setDepth(9);
            this.message = `抓住了 ${oreName(hit.kind)}，正在回收`;
            this.mode = "retract";
            this.cameras.main.shake(90, 0.0025);
            this.tweens.add({
              targets: hit.body,
              scaleX: 1.13,
              scaleY: 1.13,
              duration: 95,
              yoyo: true,
              ease: "Sine.easeOut",
            });
            this.emitHud();
          } else if (
            this.length >= GOLD_MINER_MAX_ROPE_LENGTH ||
            this.outsideWorld()
          ) {
            this.mode = "retract";
            this.message = "落空，抓手回收中";
            this.emitHud();
          }
        } else if (this.mode === "retract") {
          const speed = goldMinerRetractSpeed(this.caught?.weight ?? 1);
          this.length = Math.max(64, this.length - dt * speed);
          if (this.length === 64) this.completeGrab();
        }

        this.positionHook();
      }

      private advanceClock(dt: number) {
        if (this.mode === "finished") return;
        this.elapsed += dt;
        if (this.elapsed < 1) return;
        const ticks = Math.floor(this.elapsed);
        this.elapsed -= ticks;
        this.seconds = Math.max(0, this.seconds - ticks);
        if (this.seconds === 0) this.finish("time");
        this.emitHud();
      }

      private fire() {
        if (this.mode !== "swing") return;
        this.mode = "extend";
        this.message = "抓手下潜中";
        this.emitHud();
      }

      private drawWorld() {
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x182738, 0x182738, 0x071019, 0x071019, 1);
        bg.fillRect(
          0,
          0,
          GOLD_MINER_GEOMETRY.width,
          GOLD_MINER_GEOMETRY.height,
        );
        bg.fillStyle(0xd7b26b, 1).fillRect(0, 0, GOLD_MINER_GEOMETRY.width, 92);
        bg.fillStyle(0x2a2119, 1).fillRect(
          0,
          88,
          GOLD_MINER_GEOMETRY.width,
          10,
        );
        for (let y = 115; y < GOLD_MINER_GEOMETRY.height; y += 54) {
          bg.lineStyle(2, y % 108 === 7 ? 0x4a3525 : 0x2d241d, 0.55);
          bg.strokeLineShape(
            new runtime.Geom.Line(0, y, GOLD_MINER_GEOMETRY.width, y + 22),
          );
        }
        for (let i = 0; i < 90; i += 1) {
          const x = (i * 97) % GOLD_MINER_GEOMETRY.width;
          const y = 110 + ((i * 53) % 440);
          bg.fillStyle(i % 4 === 0 ? 0x80623d : 0x3a2d23, 0.5);
          bg.fillCircle(x, y, 1 + (i % 3));
        }

        const rig = this.add.graphics().setDepth(7);
        rig.fillStyle(0x181a1c, 1).fillRoundedRect(397, 22, 106, 62, 16);
        rig.fillStyle(0xe0b64f, 1).fillRoundedRect(417, 38, 66, 25, 8);
        rig
          .fillStyle(0x25282b, 1)
          .fillCircle(424, 84, 15)
          .fillCircle(476, 84, 15);
        rig.fillStyle(0xb9c0c5, 1).fillCircle(450, 102, 10);
        this.add
          .text(
            450,
            14,
            `DEEP VEIN / LEVEL ${String(level.levelNumber).padStart(2, "0")}`,
            {
              color: "#17130d",
              fontFamily: "ui-monospace, monospace",
              fontSize: "13px",
              fontStyle: "bold",
            },
          )
          .setOrigin(0.5, 0)
          .setDepth(9);

        this.ores = mine.map((spec, id) => ({
          ...spec,
          id,
          body: this.createOre(spec),
          caught: false,
        }));
      }

      private createOre(spec: OreSpec) {
        const graphics = this.add.graphics();
        if (spec.kind === "diamond") {
          graphics.fillStyle(0x6ee7ff, 0.25).fillCircle(0, 0, spec.radius + 8);
          graphics.fillStyle(0xb8f4ff, 1);
          graphics.fillTriangle(
            0,
            -spec.radius,
            spec.radius,
            -4,
            0,
            spec.radius,
          );
          graphics.fillStyle(0x4dc7e6, 1);
          graphics.fillTriangle(
            0,
            -spec.radius,
            0,
            spec.radius,
            -spec.radius,
            -4,
          );
        } else {
          const color = spec.kind === "gold" ? 0xe8b83d : 0x66717a;
          graphics.fillStyle(0x000000, 0.28).fillCircle(4, 7, spec.radius + 3);
          graphics.fillStyle(color, 1).fillCircle(0, 0, spec.radius);
          graphics.fillStyle(spec.kind === "gold" ? 0xffe39a : 0xa8b0b5, 0.9);
          graphics.fillCircle(
            -spec.radius * 0.28,
            -spec.radius * 0.3,
            spec.radius * 0.25,
          );
          graphics.lineStyle(3, 0x171b20, 0.5).strokeCircle(0, 0, spec.radius);
        }
        const label = this.add
          .text(0, spec.radius + 10, `+${spec.value}`, {
            color: "#f8e6b2",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
            fontStyle: "bold",
            stroke: "#111820",
            strokeThickness: 4,
          })
          .setOrigin(0.5, 0);
        return this.add
          .container(spec.x, spec.y, [graphics, label])
          .setDepth(4);
      }

      private positionHook() {
        const originX = GOLD_MINER_GEOMETRY.originX;
        const originY = GOLD_MINER_GEOMETRY.originY;
        const x = originX + Math.sin(this.angle) * this.length;
        const y = originY + Math.cos(this.angle) * this.length;
        this.hook.setPosition(x, y).setRotation(-this.angle);
        this.rope.clear();
        this.rope.lineStyle(4, 0xd7c9a8, 1);
        this.rope.strokeLineShape(
          new runtime.Geom.Line(originX, originY, x, y),
        );
        this.rope.lineStyle(1, 0x2f261d, 0.8);
        this.rope.strokeLineShape(
          new runtime.Geom.Line(originX + 2, originY, x + 2, y),
        );
        if (this.caught) {
          this.caught.body
            .setPosition(x, y + this.caught.radius * 0.5)
            .setRotation(Math.sin(this.time.now / 115) * 0.045);
        }
      }

      private findHit() {
        const point = new runtime.Math.Vector2(this.hook.x, this.hook.y);
        return (
          this.ores.find(
            (ore) =>
              !ore.caught &&
              ore.body.active &&
              point.distance(new runtime.Math.Vector2(ore.body.x, ore.body.y)) <
                ore.radius + 20,
          ) ?? null
        );
      }

      private outsideWorld() {
        return (
          this.hook.x < 8 ||
          this.hook.x > GOLD_MINER_GEOMETRY.width - 8 ||
          this.hook.y > GOLD_MINER_GEOMETRY.height - 8
        );
      }

      private completeGrab() {
        if (this.caught) {
          const ore = this.caught;
          const reward = this.caught.value;
          this.run = settleGoldMinerOre(this.run, ore.id, reward, level.target);
          this.showScoreBurst(ore, reward);
          ore.body.destroy();
          this.message = `回收完成 · +${reward} 积分`;
          this.caught = null;
        } else {
          this.message = "抓手已归位，重新瞄准";
        }
        this.mode = this.seconds > 0 ? "swing" : "finished";
        if (this.run.phase === "cleared") {
          this.finish("target");
          return;
        }
        if (this.run.remainingOreIds.length === 0) {
          this.finish("depleted");
          return;
        }
        this.emitHud();
      }

      private finish(reason: "target" | "time" | "depleted") {
        if (this.mode === "finished") return;
        this.mode = "finished";
        const cleared = this.run.score >= level.target;
        this.run = {
          ...this.run,
          phase: cleared ? "cleared" : "failed",
        };
        this.message = cleared
          ? `第 ${level.levelNumber} 关通关 · 首次完成可得 ${level.rewardPoints} 积分`
          : reason === "depleted"
            ? "挑战失败 · 矿区已清空，本轮未达到目标"
            : "挑战失败 · 时间到，本轮未达到目标";
        this.showResult(cleared);
        this.emitHud();
        onFinish(cleared);
      }

      private showScoreBurst(ore: OreActor, reward: number) {
        const burst = this.add
          .text(ore.body.x, Math.max(92, ore.body.y - 12), `+${reward}`, {
            color: ore.kind === "rock" ? "#d3dae0" : "#ffe08a",
            fontFamily: "ui-monospace, monospace",
            fontSize: "30px",
            fontStyle: "bold",
            stroke: "#10161c",
            strokeThickness: 6,
          })
          .setOrigin(0.5)
          .setDepth(30)
          .setScale(0.7);
        this.tweens.add({
          targets: burst,
          y: burst.y - 72,
          scaleX: 1.12,
          scaleY: 1.12,
          alpha: 0,
          duration: 760,
          ease: "Cubic.easeOut",
          onComplete: () => burst.destroy(),
        });
        this.cameras.main.flash(90, 255, 214, 104, false, undefined, this);
      }

      private showResult(cleared: boolean) {
        if (this.resultShown) return;
        this.resultShown = true;
        const veil = this.add
          .rectangle(450, 280, 900, 560, 0x02070b, 0.68)
          .setDepth(40)
          .setAlpha(0);
        const panel = this.add
          .rectangle(450, 282, 500, 176, 0x111b23, 0.96)
          .setStrokeStyle(2, cleared ? 0xe0b64f : 0xc6655a, 1)
          .setDepth(41)
          .setAlpha(0);
        const eyebrow = this.add
          .text(450, 226, cleared ? "VEIN CLEARED" : "SHIFT ENDED", {
            color: cleared ? "#e0b64f" : "#e79a91",
            fontFamily: "ui-monospace, monospace",
            fontSize: "13px",
            fontStyle: "bold",
          })
          .setOrigin(0.5)
          .setDepth(42)
          .setAlpha(0);
        const title = this.add
          .text(450, 264, cleared ? "目标达成" : "本关未达标", {
            color: "#fff4d2",
            fontFamily: "system-ui, sans-serif",
            fontSize: "34px",
            fontStyle: "bold",
          })
          .setOrigin(0.5)
          .setDepth(42)
          .setAlpha(0);
        const score = this.add
          .text(450, 316, `${this.run.score} / ${level.target}`, {
            color: "#c7c0ad",
            fontFamily: "ui-monospace, monospace",
            fontSize: "18px",
          })
          .setOrigin(0.5)
          .setDepth(42)
          .setAlpha(0);
        this.tweens.add({
          targets: [veil, panel, eyebrow, title, score],
          alpha: 1,
          duration: 260,
          ease: "Quad.easeOut",
        });
        this.tweens.add({
          targets: [panel, eyebrow, title, score],
          y: "-=10",
          duration: 360,
          ease: "Back.easeOut",
        });
      }

      private emitHud() {
        onHud({
          score: this.run.score,
          seconds: this.seconds,
          target: level.target,
          message: this.message,
          phase:
            this.mode === "finished"
              ? this.run.phase === "cleared"
                ? "cleared"
                : "failed"
              : "playing",
          hookState:
            this.mode === "swing"
              ? "aiming"
              : this.mode === "extend"
                ? "descending"
                : this.mode === "retract"
                  ? "hauling"
                  : "finished",
        });
      }
    }

    return {
      type: runtime.CANVAS,
      width: GOLD_MINER_GEOMETRY.width,
      height: GOLD_MINER_GEOMETRY.height,
      backgroundColor: "#071019",
      scene: GoldMinerScene,
      scale: {
        mode: runtime.Scale.FIT,
        autoCenter: runtime.Scale.CENTER_BOTH,
      },
      render: { antialias: true, pixelArt: false, roundPixels: false },
      input: { keyboard: true, mouse: true, touch: true },
    };
  };
}

function oreName(kind: OreSpec["kind"]) {
  if (kind === "diamond") return "蓝钻";
  if (kind === "rock") return "岩石";
  return "金矿";
}
