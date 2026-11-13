import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import {
  CODING_BRO_PLAN_PROVIDER_ID,
  CodingBroPlanUnavailableError,
  findCodingBroPlanProvider,
  managedProviderModel,
  prepareLauncher,
  type LauncherSetupPhase,
  type LauncherToolStatus,
} from "@/bro/home/launcherSetup";

const installedTool = (version = "1.2.3"): LauncherToolStatus => ({
  name: "codex",
  version,
  error: null,
  installed_but_broken: false,
});

const managedProvider = (models: unknown[] = [{ id: "codingbro-2.0" }]) =>
  ({
    id: CODING_BRO_PLAN_PROVIDER_ID,
    name: "Coding Bro Plan",
    settingsConfig: {
      models,
      codingBroModel:
        typeof models[0] === "object" && models[0]
          ? (models[0] as { id?: string }).id
          : undefined,
    },
    category: "custom",
  }) satisfies Provider;

describe("prepareLauncher", () => {
  it("已安装时跳过安装，并在完成前强制激活 Coding Bro Plan", async () => {
    const installTool = vi.fn();
    const getLaunchCommand = vi.fn().mockResolvedValue("'/opt/bin/codex'");
    const activatePlan = vi.fn().mockResolvedValue(managedProvider());
    const phases: LauncherSetupPhase[] = [];

    await prepareLauncher(
      "codex",
      {
        getToolStatus: vi.fn().mockResolvedValue(installedTool()),
        installTool,
        getLaunchCommand,
        activatePlan,
      },
      (progress) => phases.push(progress.phase),
    );

    expect(installTool).not.toHaveBeenCalled();
    expect(getLaunchCommand).toHaveBeenCalledWith("codex");
    expect(activatePlan).toHaveBeenCalledWith("codex");
    expect(phases).toEqual(["checking", "activating_plan", "ready"]);
  });

  it("未安装时自动安装、重新校验，再切换 Plan", async () => {
    const getToolStatus = vi
      .fn()
      .mockResolvedValueOnce({
        name: "pi",
        version: null,
        error: "not found",
        installed_but_broken: false,
      } satisfies LauncherToolStatus)
      .mockResolvedValueOnce(installedTool("0.48.2"));
    const installTool = vi.fn().mockResolvedValue(undefined);
    const activatePlan = vi.fn().mockResolvedValue(managedProvider());
    const getLaunchCommand = vi.fn().mockResolvedValue("'/opt/bin/pi'");
    const phases: LauncherSetupPhase[] = [];

    const result = await prepareLauncher(
      "pi",
      { getToolStatus, installTool, getLaunchCommand, activatePlan },
      (progress) => phases.push(progress.phase),
    );

    expect(result.installedNow).toBe(true);
    expect(result.launchCommand).toBe("'/opt/bin/pi'");
    expect(installTool).toHaveBeenCalledWith("pi");
    expect(getToolStatus).toHaveBeenCalledTimes(2);
    expect(activatePlan).toHaveBeenCalledWith("pi");
    expect(phases).toEqual([
      "checking",
      "installing",
      "verifying",
      "activating_plan",
      "ready",
    ]);
  });

  it("安装后仍不可用时不切 Plan，也不继续启动", async () => {
    const unavailable = {
      name: "hermes",
      version: null,
      error: "command not found",
      installed_but_broken: false,
    } satisfies LauncherToolStatus;
    const activatePlan = vi.fn();

    await expect(
      prepareLauncher("hermes", {
        getToolStatus: vi.fn().mockResolvedValue(unavailable),
        installTool: vi.fn().mockResolvedValue(undefined),
        getLaunchCommand: vi.fn().mockResolvedValue("hermes"),
        activatePlan,
      }),
    ).rejects.toThrow("安装完成后仍无法运行 Hermes");

    expect(activatePlan).not.toHaveBeenCalled();
  });

  it("无法解析精确启动命令时不切 Plan", async () => {
    const activatePlan = vi.fn();

    await expect(
      prepareLauncher("codex", {
        getToolStatus: vi.fn().mockResolvedValue(installedTool()),
        installTool: vi.fn(),
        getLaunchCommand: vi.fn().mockResolvedValue("  "),
        activatePlan,
      }),
    ).rejects.toThrow("无法定位 Codex 的可执行文件");

    expect(activatePlan).not.toHaveBeenCalled();
  });
});

describe("managedProviderModel", () => {
  it("returns the explicit Coding Bro model for a process-scoped launch", () => {
    expect(
      managedProviderModel(managedProvider([{ id: "codingbro-pro-2.0" }])),
    ).toBe("codingbro-pro-2.0");
  });

  it("stops instead of falling back to a CLI global model", () => {
    expect(() => managedProviderModel(managedProvider([]))).toThrow(
      "Coding Bro Plan 缺少启动模型",
    );
  });
});

describe("Coding Bro Plan provider contract", () => {
  const provider = (id: string, codingBroPlan?: boolean): Provider =>
    ({
      id,
      name: id,
      settingsConfig: {},
      meta: codingBroPlan ? { codingBroPlan: true } : undefined,
    }) satisfies Provider;

  it("优先使用显式 codingBroPlan 标记，也兼容固定 provider id", () => {
    const marked = provider("managed-plan-v2", true);
    expect(
      findCodingBroPlanProvider({
        [CODING_BRO_PLAN_PROVIDER_ID]: provider(CODING_BRO_PLAN_PROVIDER_ID),
        [marked.id]: marked,
      }),
    ).toBe(marked);

    const fixed = provider(CODING_BRO_PLAN_PROVIDER_ID);
    expect(
      findCodingBroPlanProvider({ [CODING_BRO_PLAN_PROVIDER_ID]: fixed }),
    ).toBe(fixed);
  });

  it("没有受管 Plan provider 时返回明确错误，禁止退回 BYOK", () => {
    expect(() =>
      findCodingBroPlanProvider(
        { personal: provider("personal") },
        { required: true },
      ),
    ).toThrow(CodingBroPlanUnavailableError);
  });
});
