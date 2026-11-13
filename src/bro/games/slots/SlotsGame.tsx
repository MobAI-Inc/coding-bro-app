import { useEffect, useRef, useState } from "react";
import {
  Coins,
  Gem,
  RotateCw,
  Sparkles,
  TrendingUp,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { playArcadeCue } from "../core/audio";
import "./slots.css";

export const SLOT_SYMBOLS = [
  "SEVEN",
  "BAR",
  "DIAMOND",
  "CHERRY",
  "STAR",
  "BELL",
  "CROWN",
  "COIN",
] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
export const SLOT_CONFIG = {
  symbols: SLOT_SYMBOLS,
  spinCost: 10,
  initialSessionBalance: 100,
  jackpotPayout: 120,
  pairPayout: 20,
  reelStopMs: [900, 1_350, 1_950] as const,
  spinDurationMs: 2_150,
  jackpotCountMs: 1_150,
  jackpotPresentationMs: 4_800,
} as const;
const LABEL: Record<SlotSymbol, string> = {
  SEVEN: "7",
  BAR: "BAR",
  DIAMOND: "◆",
  CHERRY: "CHERRY",
  STAR: "★",
  BELL: "BELL",
  CROWN: "CROWN",
  COIN: "COIN",
};
export const SPIN_COST = SLOT_CONFIG.spinCost;
export const INITIAL_SESSION_BALANCE = SLOT_CONFIG.initialSessionBalance;
export const REEL_STOP_MS = SLOT_CONFIG.reelStopMs;
export const SPIN_DURATION_MS = SLOT_CONFIG.spinDurationMs;
export const JACKPOT_COUNT_MS = SLOT_CONFIG.jackpotCountMs;
export const JACKPOT_PRESENTATION_MS = SLOT_CONFIG.jackpotPresentationMs;

export interface SpinSettlement {
  readonly payout: number;
  readonly net: number;
  readonly label: string;
}
export function settleSpin(reels: readonly SlotSymbol[]): SpinSettlement {
  const same = reels[0] === reels[1] && reels[1] === reels[2];
  const pair = new Set(reels).size === 2;
  const payout = same
    ? SLOT_CONFIG.jackpotPayout
    : pair
      ? SLOT_CONFIG.pairPayout
      : 0;
  return {
    payout,
    net: payout - SPIN_COST,
    label: same ? "JACKPOT" : pair ? "两枚同款" : "未中奖",
  };
}

export function SlotsGame({
  onSettle,
}: { onSettle?: (points: number) => void } = {}) {
  const [reels, setReels] = useState<[number, number, number]>([0, 2, 0]);
  const [spinning, setSpinning] = useState(false);
  const [stopped, setStopped] = useState<[boolean, boolean, boolean]>([
    true,
    true,
    true,
  ]);
  const [presentation, setPresentation] = useState<"idle" | "win" | "loss">(
    "idle",
  );
  const [winKind, setWinKind] = useState<"none" | "pair" | "jackpot">("none");
  const [winningSymbol, setWinningSymbol] = useState<SlotSymbol | null>(null);
  const [jackpot, setJackpot] = useState<SpinSettlement | null>(null);
  const [jackpotCount, setJackpotCount] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [balance, setBalance] = useState<number>(INITIAL_SESSION_BALANCE);
  const [netProfit, setNetProfit] = useState(0);
  const [spins, setSpins] = useState(0);
  const [result, setResult] = useState(
    `每次 ${SPIN_COST} 积分 · 点击 SPIN 开始`,
  );
  const timersRef = useRef<number[]>([]);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const jackpotSkipRef = useRef<HTMLButtonElement>(null);
  const jackpotWasVisibleRef = useRef(false);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    if (!jackpot) {
      if (jackpotWasVisibleRef.current) {
        jackpotWasVisibleRef.current = false;
        spinButtonRef.current?.focus();
      }
      return;
    }
    jackpotWasVisibleRef.current = true;
    setJackpotCount(0);
    jackpotSkipRef.current?.focus();
    const startedAt = Date.now();
    const counter = window.setInterval(() => {
      const progress = Math.min((Date.now() - startedAt) / JACKPOT_COUNT_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setJackpotCount(Math.round(jackpot.payout * eased));
      if (progress >= 1) window.clearInterval(counter);
    }, 40);
    const close = window.setTimeout(() => {
      setJackpot(null);
      setJackpotCount(0);
    }, JACKPOT_PRESENTATION_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault();
        jackpotSkipRef.current?.focus();
      }
      if (event.key === "Escape") {
        setJackpot(null);
        setJackpotCount(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(counter);
      window.clearTimeout(close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [jackpot]);

  const dismissJackpot = () => {
    setJackpot(null);
    setJackpotCount(0);
  };

  const spin = () => {
    if (spinning || jackpot || balance < SPIN_COST) return;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    const next = [0, 0, 0].map(() =>
      Math.floor(Math.random() * SLOT_SYMBOLS.length),
    ) as [number, number, number];
    setSpinning(true);
    setPresentation("idle");
    setWinKind("none");
    setWinningSymbol(null);
    setStopped([false, false, false]);
    setBalance((value) => value - SPIN_COST);
    setResult(`已扣 ${SPIN_COST} 积分 · 滚轴转动中…`);
    if (soundOn) playArcadeCue("enter");

    REEL_STOP_MS.forEach((delay, index) => {
      timersRef.current.push(
        window.setTimeout(() => {
          setReels((current) => {
            const landed = [...current] as [number, number, number];
            landed[index] = next[index];
            return landed;
          });
          setStopped((current) => {
            const landed = [...current] as [boolean, boolean, boolean];
            landed[index] = true;
            return landed;
          });
          if (index === 0) {
            setResult(`第一轴停靠 · ${LABEL[SLOT_SYMBOLS[next[0]]]}`);
          } else if (index === 1 && next[0] === next[1]) {
            setResult("两轴同符号 · 最后一轴进入大奖预兆");
          } else if (index === 1) {
            setResult("第二轴停靠 · 等待最后结果");
          } else {
            setResult("最后一轴停靠 · 正在结算…");
          }
          if (soundOn) playArcadeCue("tap");
        }, delay),
      );
    });

    timersRef.current.push(
      window.setTimeout(() => {
        const settlement = settleSpin(next.map((index) => SLOT_SYMBOLS[index]));
        setSpinning(false);
        setSpins((value) => value + 1);
        setBalance((value) => value + settlement.payout);
        setNetProfit((value) => value + settlement.net);
        setPresentation(settlement.payout > 0 ? "win" : "loss");
        setWinKind(
          settlement.label === "JACKPOT"
            ? "jackpot"
            : settlement.payout > 0
              ? "pair"
              : "none",
        );
        setWinningSymbol(
          settlement.payout > 0
            ? (next
                .map((value) => SLOT_SYMBOLS[value])
                .find(
                  (symbol, _, landed) =>
                    landed.filter((candidate) => candidate === symbol).length >=
                    2,
                ) ?? null)
            : null,
        );
        if (settlement.label === "JACKPOT") setJackpot(settlement);
        if (settlement.net > 0) onSettle?.(settlement.net);
        if (soundOn) playArcadeCue(settlement.payout > 0 ? "win" : "lose");
        setResult(
          settlement.payout > 0
            ? `${settlement.label} · 派彩 ${settlement.payout} 积分 · 净赢 ${settlement.net}`
            : `未中奖 · 本次净亏 ${SPIN_COST} 积分`,
        );
      }, SPIN_DURATION_MS),
    );
  };

  const anticipating =
    spinning &&
    stopped[0] &&
    stopped[1] &&
    !stopped[2] &&
    reels[0] === reels[1];

  return (
    <main className="bro-slots bro-game-shell">
      <header className="bro-game-hero">
        <div>
          <span className="bro-game-kicker">SOLO / CONTINUOUS SESSION</span>
          <h2>白金七号</h2>
          <p>
            <Sparkles size={15} /> 连续 Spin · {SLOT_SYMBOLS.length} 种符号 ·
            每次 {SPIN_COST} 积分
          </p>
        </div>
      </header>
      <div className="bro-slots__session" aria-label="老虎机会话数据">
        <div>
          <Coins size={15} />
          <span>会话余额</span>
          <strong>{balance}</strong>
        </div>
        <div>
          <TrendingUp size={15} />
          <span>净盈亏</span>
          <strong data-positive={netProfit > 0 ? "" : undefined}>
            {netProfit > 0 ? `+${netProfit}` : netProfit}
          </strong>
        </div>
        <div>
          <RotateCw size={15} />
          <span>已转</span>
          <strong>{spins}</strong>
        </div>
        <div>
          <span>单次成本</span>
          <strong>{SPIN_COST}</strong>
        </div>
      </div>
      <section
        className={`bro-slots__machine ${spinning ? "is-spinning" : ""} ${anticipating ? "is-anticipating" : ""} is-${presentation}`}
        data-phase={spinning ? "spinning" : presentation}
        data-win-kind={winKind}
      >
        <div className="bro-slots__halo" aria-hidden="true" />
        <div className="bro-slots__bulbs" aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <div className="bro-slots__crown">
          <Gem />
          <span>CODING JACKPOT</span>
          <Gem />
        </div>
        <div
          className="bro-slots__anticipation"
          data-active={anticipating ? "true" : "false"}
          aria-live="polite"
        >
          <Zap size={14} aria-hidden="true" />
          {anticipating
            ? "JACKPOT WATCH · 最后一轴减速"
            : spinning
              ? "SEQUENCE IN MOTION · 逐轴停靠"
              : "PAYLINE READY · 等待启动"}
        </div>
        <div className="bro-slots__window">
          {reels.map((value, index) => (
            <div
              key={index}
              className={`bro-slots__reel ${spinning && !stopped[index] ? "is-spinning" : "is-stopped"} ${winningSymbol === SLOT_SYMBOLS[value] ? "is-winning" : ""}`}
              role="img"
              aria-label={
                spinning && !stopped[index]
                  ? `第 ${index + 1} 轴转动中`
                  : `第 ${index + 1} 轴停在 ${LABEL[SLOT_SYMBOLS[value]]}`
              }
            >
              <div className="bro-slots__reel-track" aria-hidden="true">
                {Array.from({ length: 3 }, (_, loop) =>
                  SLOT_SYMBOLS.map((symbol) => (
                    <b key={`${loop}-${symbol}`} data-symbol={symbol}>
                      {LABEL[symbol]}
                    </b>
                  )),
                )}
              </div>
              <div className="bro-slots__reel-landing" aria-hidden="true">
                <small>
                  {
                    LABEL[
                      SLOT_SYMBOLS[
                        (value + SLOT_SYMBOLS.length - 1) % SLOT_SYMBOLS.length
                      ]
                    ]
                  }
                </small>
                <span data-symbol={SLOT_SYMBOLS[value]}>
                  {LABEL[SLOT_SYMBOLS[value]]}
                </span>
                <small>
                  {LABEL[SLOT_SYMBOLS[(value + 1) % SLOT_SYMBOLS.length]]}
                </small>
              </div>
            </div>
          ))}
        </div>
        <div className="bro-slots__payline" />
        {presentation === "win" && (
          <div className="bro-slots__win-burst" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <i
                key={index}
                style={{ "--particle": index } as React.CSSProperties}
              />
            ))}
          </div>
        )}
        <div className="bro-slots__side-lights" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <p className="bro-slots__result" id="bro-slots-result" role="status">
          {result}
        </p>
        <div className="bro-slots__controls">
          <button
            className="bro-slots__sound"
            type="button"
            aria-label={soundOn ? "关闭游戏声音" : "打开游戏声音"}
            aria-pressed={soundOn}
            onClick={() => setSoundOn((enabled) => !enabled)}
          >
            {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            <span>{soundOn ? "SOUND ON" : "MUTED"}</span>
          </button>
          <button
            ref={spinButtonRef}
            className="bro-slots__spin"
            type="button"
            onClick={spin}
            disabled={spinning || Boolean(jackpot) || balance < SPIN_COST}
            aria-describedby="bro-slots-result"
          >
            <RotateCw size={18} />
            {spinning
              ? stopped[1]
                ? "最后一轴减速"
                : "转动中"
              : balance < SPIN_COST
                ? "余额不足"
                : `SPIN · ${SPIN_COST}`}
          </button>
          <span className="bro-slots__energy" aria-hidden="true">
            <Zap size={16} />
          </span>
        </div>
        <div className="bro-slots__tray" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>POINT DROP</span>
        </div>
        <div className="bro-slots__payout" aria-label="奖表">
          <span>
            任意三同 <b>{SLOT_CONFIG.jackpotPayout}</b>
          </span>
          <span>
            任意两同 <b>{SLOT_CONFIG.pairPayout}</b>
          </span>
          <span>
            其他组合 <b>0</b>
          </span>
        </div>
        <div className="bro-slots__math" aria-label="老虎机规则摘要">
          <span>{SLOT_SYMBOLS.length} SYMBOLS</span>
          <span>{SPIN_COST} POINTS / SPIN</span>
          <span>JACKPOT 1 / {SLOT_SYMBOLS.length ** 2}</span>
        </div>
      </section>
      {jackpot && (
        <JackpotPresentation
          settlement={jackpot}
          count={jackpotCount}
          skipRef={jackpotSkipRef}
          onSkip={dismissJackpot}
        />
      )}
    </main>
  );
}

function JackpotPresentation({
  settlement,
  count,
  skipRef,
  onSkip,
}: {
  readonly settlement: SpinSettlement;
  readonly count: number;
  readonly skipRef: React.RefObject<HTMLButtonElement>;
  readonly onSkip: () => void;
}) {
  return (
    <section
      className="bro-slots__jackpot"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bro-slots-jackpot-title"
      aria-describedby="bro-slots-jackpot-description"
    >
      <div className="bro-slots__jackpot-curtain" data-side="left" />
      <div className="bro-slots__jackpot-curtain" data-side="right" />
      <div className="bro-slots__jackpot-rays" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} style={{ "--ray": index } as React.CSSProperties} />
        ))}
      </div>
      <div className="bro-slots__jackpot-coins" aria-hidden="true">
        {Array.from({ length: 24 }, (_, index) => (
          <i
            key={index}
            style={
              {
                "--coin-left": `${(index * 47) % 101}%`,
                "--coin-duration": `${1.8 + (index % 5) * 0.18}s`,
                "--coin-delay": `${(index % 8) * -0.24}s`,
                "--coin-drift": `${(index % 5) * 8 - 16}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="bro-slots__jackpot-stage">
        <span className="bro-slots__jackpot-kicker">
          TRIPLE MATCH / PAYOUT PROTOCOL
        </span>
        <Sparkles className="bro-slots__jackpot-gem" aria-hidden="true" />
        <h2 id="bro-slots-jackpot-title">大奖触发</h2>
        <p id="bro-slots-jackpot-description">
          三枚符号命中同一中奖线，本轮派奖已锁定。
        </p>
        <div
          className="bro-slots__jackpot-amount bro-tabular"
          role="group"
          aria-label={`大奖派彩 ${settlement.payout} 积分，净赢 ${settlement.net} 积分`}
        >
          <Coins size={28} aria-hidden="true" />
          <strong>{count}</strong>
          <span>积分派彩</span>
        </div>
        <div className="bro-slots__jackpot-net">
          本轮净赢 <strong>+{settlement.net}</strong>
        </div>
        <button ref={skipRef} type="button" onClick={onSkip}>
          跳过演出
          <span>ESC</span>
        </button>
        <small>演出将在数秒后自动收束</small>
        <i className="bro-slots__jackpot-timeline" aria-hidden="true" />
      </div>
    </section>
  );
}
