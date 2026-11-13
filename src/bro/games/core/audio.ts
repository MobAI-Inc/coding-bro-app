export type ArcadeCue = "tap" | "enter" | "back" | "win" | "lose";

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

/**
 * 无素材依赖的交互声纹。第一次手势才创建 AudioContext，避免自动播放；音量
 * 刻意压低，只负责让按钮、入场和结算“落地”，不会把桌面工具变成吵闹网页。
 */
export function playArcadeCue(cue: ArcadeCue): void {
  const ctx = context();
  if (!ctx) return;

  const patterns: Record<ArcadeCue, readonly [number, number, number][]> = {
    tap: [[430, 0, 0.035]],
    enter: [
      [330, 0, 0.07],
      [495, 0.055, 0.09],
    ],
    back: [
      [420, 0, 0.05],
      [315, 0.04, 0.07],
    ],
    win: [
      [392, 0, 0.08],
      [523.25, 0.07, 0.1],
      [659.25, 0.15, 0.16],
    ],
    lose: [
      [311, 0, 0.08],
      [233, 0.07, 0.13],
    ],
  };

  const start = ctx.currentTime;
  for (const [frequency, delay, duration] of patterns[cue]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = cue === "tap" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, start + delay);
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(0.035, start + delay + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + duration + 0.01);
  }
}
