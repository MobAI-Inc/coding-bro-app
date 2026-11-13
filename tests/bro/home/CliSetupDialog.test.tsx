import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CliSetupDialog } from "@/bro/home/CliSetupDialog";

describe("CliSetupDialog", () => {
  it("安装阶段明确展示下载、安装和 Plan 切换进度", () => {
    render(
      <CliSetupDialog
        open={true}
        agentName="Gemini CLI"
        phase="installing"
        installedNow={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("正在下载并安装 CLI")).toBeInTheDocument();
    expect(screen.getByText("下载与安装中")).toBeInTheDocument();
    expect(screen.getByText("Coding Bro Plan")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "CLI 启动准备进度" }),
    ).toHaveAttribute("aria-valuenow", "48");
  });

  it("失败时说明不会沿用旧供应商，并支持原地重试", () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(
      <CliSetupDialog
        open={true}
        agentName="Pi"
        phase="failed"
        failedAt="activating_plan"
        installedNow={false}
        error="Plan 通道尚未接入"
        onRetry={onRetry}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByText("没有启动，也没有沿用旧供应商"),
    ).toBeInTheDocument();
    expect(screen.getByText("Plan 通道尚未接入")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
