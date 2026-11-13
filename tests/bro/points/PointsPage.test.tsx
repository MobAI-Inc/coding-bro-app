import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PointsPage } from "@/bro/points/PointsPage";
import { resetOffersForPlan } from "@/bro/points/redeem";
import type { LedgerEntry } from "@/bro/points/types";

const rich: LedgerEntry[] = [
  { id: "seed", kind: "cycle_gift", amount: 50_000, at: 0, memo: "账期赠送" },
];

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe.each([
  { name: "玻璃", dark: false },
  { name: "Coding TUI", dark: true },
])("$name 模式", ({ dark }) => {
  it("offers all three Resets and uses two-step confirmation", () => {
    document.documentElement.classList.toggle("dark", dark);
    const onRedeem = vi.fn();
    render(
      <PointsPage
        ledger={rich}
        account={{ plan: "pro" }}
        onRedeem={onRedeem}
        resetCatalog={resetOffersForPlan("pro")}
      />,
    );
    expect(screen.getAllByText("5 小时 Reset").length).toBeGreaterThan(0);
    expect(screen.getAllByText("周 Reset").length).toBeGreaterThan(0);
    expect(screen.getAllByText("月 Reset").length).toBeGreaterThan(0);
    expect(screen.getByText(/买多少，送多少/)).toBeInTheDocument();
    expect(screen.getAllByText(/余额不设总上限/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("兑换 周 Reset，需要 8400 积分"));
    expect(onRedeem).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: dark ? "[ CONFIRM ]" : "确认兑换" }),
    );
    expect(onRedeem).toHaveBeenCalledWith("reset_week");
  });

  it("disables unaffordable and server-limited products", () => {
    document.documentElement.classList.toggle("dark", dark);
    const catalog = resetOffersForPlan("pro").map((offer) =>
      offer.sku === "reset_week"
        ? {
            ...offer,
            redeemedCount: 4,
            maxRedemptions: 4,
            redeemable: false,
          }
        : offer,
    );
    render(
      <PointsPage
        ledger={[{ ...rich[0], amount: 10_000 }]}
        account={{ plan: "pro" }}
        onRedeem={vi.fn()}
        resetCatalog={catalog}
      />,
    );
    expect(
      screen.getByLabelText("兑换 周 Reset，需要 8400 积分"),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("兑换 月 Reset，需要 19600 积分"),
    ).toBeDisabled();
    expect(screen.getByText(/已兑换 4\/4 次/)).toBeTruthy();
  });
});

it("switches to the higher price catalog when the Plan changes", () => {
  const { rerender } = render(
    <PointsPage
      ledger={rich}
      account={{ plan: "lite" }}
      onRedeem={vi.fn()}
      resetCatalog={resetOffersForPlan("lite")}
    />,
  );
  expect(screen.getByText("1,200")).toBeTruthy();
  expect(screen.getByText("9,800")).toBeTruthy();
  rerender(
    <PointsPage
      ledger={rich}
      account={{ plan: "ultra" }}
      onRedeem={vi.fn()}
      resetCatalog={resetOffersForPlan("ultra")}
    />,
  );
  expect(screen.getByText("4,800")).toBeTruthy();
  expect(screen.getByText("39,200")).toBeTruthy();
});
