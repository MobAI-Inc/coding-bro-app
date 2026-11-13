import { useEffect, useState, type CSSProperties } from "react";
import {
  decisionSecondsRemaining,
  type DecisionWindow,
} from "./decision-timing";
import "./table-feedback.css";

export function DecisionClock({
  window,
  label,
  compact = false,
}: {
  readonly window: DecisionWindow;
  readonly label: string;
  readonly compact?: boolean;
}) {
  const [seconds, setSeconds] = useState(() =>
    decisionSecondsRemaining(window),
  );

  useEffect(() => {
    setSeconds(decisionSecondsRemaining(window));
    const timer = windowThis().setInterval(() => {
      setSeconds(decisionSecondsRemaining(window));
    }, 250);
    return () => windowThis().clearInterval(timer);
  }, [window]);

  const totalSeconds = Math.max(1, Math.ceil(window.durationMs / 1_000));
  const progress = seconds / totalSeconds;
  return (
    <span
      className="bro-decision-clock"
      data-compact={compact ? "" : undefined}
      data-urgent={seconds <= 3 ? "" : undefined}
      role="timer"
      aria-label={`${label}剩余 ${seconds} 秒`}
      style={{ "--decision-progress": progress } as CSSProperties}
    >
      <i aria-hidden="true" />
      <span>
        <small>{label}</small>
        <strong className="bro-tabular">{seconds}</strong>
      </span>
    </span>
  );
}

function windowThis(): Window {
  return window;
}
