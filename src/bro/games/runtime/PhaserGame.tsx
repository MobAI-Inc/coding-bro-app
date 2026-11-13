import { useEffect, useRef } from "react";
import type Phaser from "phaser";

export type PhaserConfigFactory = (
  runtime: typeof Phaser,
  parent: HTMLElement,
) => Phaser.Types.Core.GameConfig;

export interface PhaserGameProps {
  readonly className?: string;
  readonly ariaLabel: string;
  readonly createConfig: PhaserConfigFactory;
}

/**
 * React owns the host element; Phaser owns everything inside it.
 *
 * Loading Phaser lazily keeps the desktop shell and unit-test environment from
 * evaluating the renderer until a game is actually opened. Destroying the game
 * on unmount is essential in Tauri: otherwise revisiting a game leaves WebGL
 * contexts, keyboard listeners and animation loops behind.
 */
export function PhaserGame({
  className,
  ariaLabel,
  createConfig,
}: PhaserGameProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // jsdom has a canvas element but no rendering context. Scene behavior is
    // covered through its pure logic and desktop playtests, not a fake canvas.
    if (navigator.userAgent.includes("jsdom")) return;

    let disposed = false;
    let game: Phaser.Game | null = null;

    void import("phaser").then(({ default: runtime }) => {
      if (disposed) return;
      game = new runtime.Game({
        ...createConfig(runtime, host),
        parent: host,
      });
    });

    return () => {
      disposed = true;
      game?.destroy(true);
      host.replaceChildren();
    };
  }, [createConfig]);

  return (
    <div
      ref={hostRef}
      className={className}
      role="application"
      aria-label={ariaLabel}
    />
  );
}
