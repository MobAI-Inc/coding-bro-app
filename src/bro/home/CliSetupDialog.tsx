import {
  AlertTriangle,
  Check,
  DownloadCloud,
  Loader2,
  RotateCw,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LauncherSetupPhase } from "./launcherSetup";

export type CliSetupDialogPhase = LauncherSetupPhase | "launching" | "failed";

export interface CliSetupDialogProps {
  readonly open: boolean;
  readonly agentName: string;
  readonly phase: CliSetupDialogPhase;
  readonly failedAt?: Exclude<CliSetupDialogPhase, "failed">;
  readonly installedNow: boolean;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

type SetupStep = "cli" | "plan" | "terminal";
type StepState = "pending" | "active" | "done" | "error";

const PHASE_COPY: Record<Exclude<CliSetupDialogPhase, "failed">, string> = {
  checking: "正在检查本机 CLI",
  installing: "正在下载并安装 CLI",
  verifying: "正在验证安装结果",
  activating_plan: "正在准备 Coding Bro 会话",
  ready: "Plan 已就绪",
  launching: "正在打开终端并进入游戏",
};

const PHASE_PROGRESS: Record<Exclude<CliSetupDialogPhase, "failed">, number> = {
  checking: 14,
  installing: 48,
  verifying: 72,
  activating_plan: 88,
  ready: 94,
  launching: 100,
};

function phaseStep(phase: Exclude<CliSetupDialogPhase, "failed">): SetupStep {
  if (["checking", "installing", "verifying"].includes(phase)) return "cli";
  if (["activating_plan", "ready"].includes(phase)) return "plan";
  return "terminal";
}

function stepState(
  step: SetupStep,
  phase: CliSetupDialogPhase,
  failedAt?: Exclude<CliSetupDialogPhase, "failed">,
): StepState {
  const effective = phase === "failed" ? (failedAt ?? "checking") : phase;
  const order: SetupStep[] = ["cli", "plan", "terminal"];
  const current = phaseStep(effective);
  const comparison = order.indexOf(step) - order.indexOf(current);
  if (phase === "failed" && comparison === 0) return "error";
  if (comparison < 0) return "done";
  if (comparison === 0) return "active";
  return "pending";
}

function StepMark({ state }: { readonly state: StepState }) {
  if (state === "done") return <Check size={15} aria-hidden="true" />;
  if (state === "active")
    return (
      <Loader2 size={15} aria-hidden="true" className="bro-cli-setup__spin" />
    );
  if (state === "error") return <AlertTriangle size={15} aria-hidden="true" />;
  return <span aria-hidden="true">·</span>;
}

export function CliSetupDialog({
  open,
  agentName,
  phase,
  failedAt,
  installedNow,
  error,
  onRetry,
  onClose,
}: CliSetupDialogProps) {
  const busy = phase !== "failed";
  const effectivePhase = phase === "failed" ? (failedAt ?? "checking") : phase;
  const cliState = stepState("cli", phase, failedAt);
  const planState = stepState("plan", phase, failedAt);
  const terminalState = stepState("terminal", phase, failedAt);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogContent
        zIndex="top"
        className="bro-cli-setup overflow-hidden border-0 p-0"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="bro-cli-setup__head">
          <span className="bro-cli-setup__eyebrow">
            <ShieldCheck size={14} aria-hidden="true" /> CODING BRO PLAN
          </span>
          <DialogTitle>准备启动 {agentName}</DialogTitle>
          <DialogDescription>
            缺失时自动下载安装，并仅为新终端注入你的 Coding Bro Plan，不改写 CLI
            默认配置。
          </DialogDescription>
        </DialogHeader>

        <div className="bro-cli-setup__body">
          <div className="bro-cli-setup__status" aria-live="polite">
            <span>
              {phase === "failed"
                ? "启动准备未完成"
                : PHASE_COPY[effectivePhase]}
            </span>
            <small>
              {phase === "installing"
                ? "安装器运行中，请保持网络连接"
                : agentName}
            </small>
          </div>

          <div
            className={`bro-cli-setup__progress${phase === "installing" ? " is-installing" : ""}`}
            role="progressbar"
            aria-label="CLI 启动准备进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              phase === "failed"
                ? PHASE_PROGRESS[effectivePhase]
                : PHASE_PROGRESS[phase]
            }
          >
            <span
              style={{
                width: `${PHASE_PROGRESS[effectivePhase]}%`,
              }}
            />
          </div>

          <ol className="bro-cli-setup__steps">
            <li data-state={cliState}>
              <span className="bro-cli-setup__step-icon">
                <DownloadCloud size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>CLI 环境</strong>
                <small>
                  {phase === "installing"
                    ? "下载与安装中"
                    : installedNow
                      ? "已安装并验证"
                      : cliState === "done"
                        ? "本机版本可用"
                        : "检查可执行文件"}
                </small>
              </span>
              <span className="bro-cli-setup__step-mark">
                <StepMark state={cliState} />
              </span>
            </li>
            <li data-state={planState}>
              <span className="bro-cli-setup__step-icon">
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>Coding Bro Plan</strong>
                <small>强制切换受管通道，不沿用 BYOK</small>
              </span>
              <span className="bro-cli-setup__step-mark">
                <StepMark state={planState} />
              </span>
            </li>
            <li data-state={terminalState}>
              <span className="bro-cli-setup__step-icon">
                <TerminalSquare size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>项目终端</strong>
                <small>启动 Agent 后自动进入游戏大厅</small>
              </span>
              <span className="bro-cli-setup__step-mark">
                <StepMark state={terminalState} />
              </span>
            </li>
          </ol>

          {phase === "failed" && (
            <div className="bro-cli-setup__error" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                <strong>没有启动，也没有沿用旧供应商</strong>
                <small>
                  {error || "请重试，或稍后等待 Plan 通道接入完成。"}
                </small>
              </span>
            </div>
          )}
        </div>

        {phase === "failed" && (
          <DialogFooter className="bro-cli-setup__footer">
            <button
              type="button"
              className="bro-cli-setup__secondary"
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" /> 关闭
            </button>
            <button
              type="button"
              className="bro-cli-setup__primary"
              onClick={onRetry}
            >
              <RotateCw size={16} aria-hidden="true" /> 重试
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
