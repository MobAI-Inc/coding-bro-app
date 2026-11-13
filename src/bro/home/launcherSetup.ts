import type { Provider } from "@/types";
import type { LauncherAgent } from "./CodingBroHome";

export const CODING_BRO_PLAN_PROVIDER_ID = "coding-bro-plan";

export type LauncherSetupPhase =
  | "checking"
  | "installing"
  | "verifying"
  | "activating_plan"
  | "ready";

export interface LauncherSetupProgress {
  phase: LauncherSetupPhase;
  installedNow: boolean;
}

export interface LauncherToolStatus {
  name: string;
  version: string | null;
  error: string | null;
  installed_but_broken: boolean;
}

export interface LauncherSetupDependencies {
  getToolStatus: (agent: LauncherAgent) => Promise<LauncherToolStatus | null>;
  installTool: (agent: LauncherAgent) => Promise<void>;
  getLaunchCommand: (agent: LauncherAgent) => Promise<string>;
  activatePlan: (agent: LauncherAgent) => Promise<Provider>;
}

export class CodingBroPlanUnavailableError extends Error {
  constructor() {
    super(
      "Coding Bro Plan 会话配置不可用；为避免沿用默认 BYOK，本次启动已停止。",
    );
    this.name = "CodingBroPlanUnavailableError";
  }
}

const DISPLAY_NAMES: Record<LauncherAgent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  pi: "Pi",
  hermes: "Hermes",
};

function isRunnable(status: LauncherToolStatus | null): boolean {
  return Boolean(status?.version) && !status?.installed_but_broken;
}

export function findCodingBroPlanProvider(
  providers: Record<string, Provider>,
  options?: { required?: boolean },
): Provider | undefined {
  const all = Object.values(providers);
  const provider =
    all.find((item) => item.meta?.codingBroPlan === true) ??
    providers[CODING_BRO_PLAN_PROVIDER_ID] ??
    all.find((item) => item.id === CODING_BRO_PLAN_PROVIDER_ID);

  if (!provider && options?.required) {
    throw new CodingBroPlanUnavailableError();
  }
  return provider;
}

export function managedProviderModel(provider: Provider): string {
  const settings = provider.settingsConfig as Record<string, unknown>;
  const env = settings.env as Record<string, unknown> | undefined;
  const models = Array.isArray(settings.models) ? settings.models : undefined;
  const modelFromList = models?.[0];
  const model =
    settings.codingBroModel ??
    (modelFromList && typeof modelFromList === "object"
      ? (modelFromList as Record<string, unknown>).id
      : undefined) ??
    env?.ANTHROPIC_MODEL ??
    env?.GEMINI_MODEL;
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("Coding Bro Plan 缺少启动模型，本次启动已停止");
  }
  return model;
}

export async function prepareLauncher(
  agent: LauncherAgent,
  dependencies: LauncherSetupDependencies,
  onProgress: (progress: LauncherSetupProgress) => void = () => undefined,
): Promise<{
  installedNow: boolean;
  launchCommand: string;
  provider: Provider;
}> {
  let installedNow = false;
  onProgress({ phase: "checking", installedNow });

  let status = await dependencies.getToolStatus(agent);
  if (!isRunnable(status)) {
    onProgress({ phase: "installing", installedNow });
    await dependencies.installTool(agent);
    installedNow = true;

    onProgress({ phase: "verifying", installedNow });
    status = await dependencies.getToolStatus(agent);
    if (!isRunnable(status)) {
      const detail = status?.error?.trim();
      throw new Error(
        `安装完成后仍无法运行 ${DISPLAY_NAMES[agent]}${detail ? `：${detail}` : ""}`,
      );
    }
  }

  const launchCommand = await dependencies.getLaunchCommand(agent);
  if (!launchCommand.trim()) {
    throw new Error(`无法定位 ${DISPLAY_NAMES[agent]} 的可执行文件`);
  }

  onProgress({ phase: "activating_plan", installedNow });
  const provider = await dependencies.activatePlan(agent);
  onProgress({ phase: "ready", installedNow });
  return { installedNow, launchCommand, provider };
}
