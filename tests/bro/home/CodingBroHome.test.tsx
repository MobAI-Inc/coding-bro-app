import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodingBroHome } from "@/bro/home/CodingBroHome";
import { resetPointLedger } from "@/bro/points/mock";

const backendMock = vi.hoisted(() => vi.fn(() => null));
vi.mock("@/bro/api/BackendProvider", () => ({
  useCodingBroBackend: backendMock,
}));

describe("CodingBroHome", () => {
  beforeEach(() => {
    resetPointLedger();
    backendMock.mockReturnValue(null);
  });

  it("按 Plan Reset、Agent、PAYG、BYOK 的产品优先级渲染", () => {
    const { container } = render(
      <CodingBroHome
        onLaunchAgent={vi.fn()}
        onChooseLaunchDirectory={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("当前 PLAN")).toBeInTheDocument();
    expect(screen.getByText("RESET 商店")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "一键开始 Coding" }),
    ).toBeInTheDocument();
    expect(screen.getByText("所有模型 · PAYG")).toBeInTheDocument();
    expect(screen.getByText("已有 API Key？继续使用 BYOK")).toBeInTheDocument();

    const text = container.textContent ?? "";
    expect(text.indexOf("当前 PLAN")).toBeLessThan(
      text.indexOf("一键开始 Coding"),
    );
    expect(text.indexOf("所有模型 · PAYG")).toBeLessThan(
      text.indexOf("已有 API Key？继续使用 BYOK"),
    );
  });

  it("一键启动常见 Agent 并可进入游戏", () => {
    const onLaunchAgent = vi.fn();
    const onChooseLaunchDirectory = vi.fn();
    const onNavigate = vi.fn();
    render(
      <CodingBroHome
        launchDirectory="/tmp/coding-bro-project"
        onLaunchAgent={onLaunchAgent}
        onChooseLaunchDirectory={onChooseLaunchDirectory}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "启动 Codex" }));
    expect(onLaunchAgent).toHaveBeenCalledWith("codex");

    fireEvent.click(screen.getByRole("button", { name: "启动 Pi" }));
    expect(onLaunchAgent).toHaveBeenCalledWith("pi");

    fireEvent.click(screen.getByRole("button", { name: "启动 Hermes" }));
    expect(onLaunchAgent).toHaveBeenCalledWith("hermes");

    fireEvent.click(screen.getByRole("button", { name: "直接去游戏" }));
    expect(onNavigate).toHaveBeenCalledWith("games");

    expect(screen.getByText("coding-bro-project")).toBeInTheDocument();
    expect(onChooseLaunchDirectory).not.toHaveBeenCalled();
  });

  it("启动期间锁住其它 Agent，避免重复打开终端", () => {
    render(
      <CodingBroHome
        launchingAgent="claude"
        launchDirectory="/tmp/coding-bro-project"
        onLaunchAgent={vi.fn()}
        onChooseLaunchDirectory={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    for (const name of [
      "启动 Claude Code",
      "启动 Codex",
      "启动 Gemini CLI",
      "启动 OpenCode",
      "启动 Pi",
      "启动 Hermes",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("未选择项目目录时先锁住 Agent，并引导用户完成第一步", () => {
    const onChooseLaunchDirectory = vi.fn();
    const onLaunchAgent = vi.fn();
    render(
      <CodingBroHome
        onLaunchAgent={onLaunchAgent}
        onChooseLaunchDirectory={onChooseLaunchDirectory}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "启动 Codex" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /先选择项目目录/ }));
    expect(onChooseLaunchDirectory).toHaveBeenCalledOnce();
    expect(onLaunchAgent).not.toHaveBeenCalled();
  });
});

it("shows only backend models and forwards the user's selection", async () => {
  const selectModel = vi.fn();
  const state = {
    tiers: [],
    current: "pro",
    usage: { session: 0, week: 0, month: 0 },
    ledger: [],
    resetCatalog: [],
    user: { id: "user-1" },
    selectedModelId: "gpt-5.6-sol",
    selectModel,
    models: [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic" },
    ],
  };
  backendMock.mockReturnValue(state as never);
  render(
    <CodingBroHome
      launchDirectory="/tmp/project"
      onLaunchAgent={vi.fn()}
      onChooseLaunchDirectory={vi.fn()}
      onNavigate={vi.fn()}
    />,
  );
  const picker = screen.getByRole("combobox", { name: "STEP 2 · 选择模型" });
  expect(picker).toHaveTextContent("GPT-5.6 Sol");
  // jsdom does not implement the scrolling Radix uses to focus menu items.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fireEvent.keyDown(picker, { key: "Enter" });
  const option = await screen.findByRole("option", { name: /Claude Sonnet 5/ });
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.click(option);
  expect(selectModel).toHaveBeenCalledWith("claude-sonnet-5");
});
