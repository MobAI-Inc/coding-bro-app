import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountRoute } from "@/bro/account/AccountRoute";
const mocks = vi.hoisted(() => ({
  copyText: vi.fn(),
  refresh: vi.fn(),
  clearError: vi.fn(),
  current: null as string | null,
  ready: true,
  error: null as string | null,
  user: {
    id: "user-cash-123",
    email: "user@example.com",
    displayName: "User",
  } as { id: string; email: string; displayName: string } | null,
}));
vi.mock("@/lib/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("@/bro/api/BackendProvider", () => ({
  useCodingBroBackend: () => ({
    user: mocks.user,
    ready: mocks.ready,
    clearError: mocks.clearError,
    current: mocks.current,
    billingManagement: {
      available: false,
      reason: "该套餐未关联支付账户，请提供用户 ID 联系管理员处理",
    },
    error: mocks.error,
    busy: false,
    wallet: {
      currency: "USD",
      balanceMicroUsd: "10500000",
      reservedMicroUsd: "500000",
      availableMicroUsd: "10000000",
      entries: [
        {
          id: "entry-1",
          kind: "credit",
          amountMicroUsd: "10500000",
          at: "2026-09-09T00:00:00Z",
          memo: "人工充值",
        },
      ],
    },
    refresh: mocks.refresh,
    logout: vi.fn(),
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = null;
  mocks.ready = true;
  mocks.error = null;
  mocks.user = {
    id: "user-cash-123",
    email: "user@example.com",
    displayName: "User",
  };
  mocks.copyText.mockResolvedValue(undefined);
});
describe("account cash and user ID", () => {
  it("shows exact user ID, independent balance and transaction history", async () => {
    render(<AccountRoute />);
    expect(screen.getByText("user-cash-123")).toBeInTheDocument();
    expect(screen.getByText("$10.50")).toBeInTheDocument();
    expect(screen.getByText("可用 $10.00 · 预留 $0.50")).toBeInTheDocument();
    expect(screen.getByText("未订阅")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制用户 ID" }));
    await waitFor(() =>
      expect(mocks.copyText).toHaveBeenCalledWith("user-cash-123"),
    );
    await screen.findByText("用户 ID 已复制");
  });
  it("reports a clipboard failure without claiming success", async () => {
    mocks.copyText.mockRejectedValue(new Error("denied"));
    render(<AccountRoute />);
    fireEvent.click(screen.getByRole("button", { name: "复制用户 ID" }));
    await screen.findByText("复制失败，请手动选择用户 ID");
  });
});

it("clears copied status when the account changes", async () => {
  const view = render(<AccountRoute />);
  fireEvent.click(screen.getByRole("button", { name: "复制用户 ID" }));
  await screen.findByText("用户 ID 已复制");
  mocks.user = { ...mocks.user!, id: "different-user" };
  view.rerender(<AccountRoute />);
  expect(screen.queryByText("用户 ID 已复制")).not.toBeInTheDocument();
});
it("does not show a login form until session restoration finishes", () => {
  mocks.ready = false;
  mocks.user = null;
  render(<AccountRoute />);
  expect(screen.getByRole("status")).toHaveTextContent("正在恢复账户会话");
  expect(
    screen.queryByRole("button", { name: "登录" }),
  ).not.toBeInTheDocument();
});
it("clears the previous authentication error when changing form modes", () => {
  mocks.user = null;
  mocks.error = "Invalid email or password";
  render(<AccountRoute />);
  fireEvent.click(screen.getByRole("button", { name: "没有账户？立即创建" }));
  expect(mocks.clearError).toHaveBeenCalledOnce();
});
it("ignores a clipboard response from the previous account", async () => {
  let resolve!: () => void;
  mocks.copyText.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const view = render(<AccountRoute />);
  fireEvent.click(screen.getByRole("button", { name: "复制用户 ID" }));
  mocks.user = { ...mocks.user!, id: "different-user" };
  view.rerender(<AccountRoute />);
  resolve();
  await waitFor(() =>
    expect(screen.queryByText("用户 ID 已复制")).not.toBeInTheDocument(),
  );
});

it("explains a historical plan and disables unavailable online management", () => {
  mocks.current = "lite";
  render(<AccountRoute />);
  expect(screen.getByText(/该套餐未关联支付账户/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "订阅管理暂不可用" }),
  ).toBeDisabled();
});
