import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ACTION_CONSEQUENCE,
  PlanPage,
  WINDOW_LABEL,
  consequenceOf,
} from "@/bro/plan/PlanPage";
import { MOCK_TIERS } from "@/bro/plan/mock";
import type { Usage } from "@/bro/plan/types";

const usage = (value: Partial<Usage> = {}): Usage => ({
  session: 0,
  week: 0,
  month: 0,
  ...value,
});

const MODES = [
  {
    name: "玻璃",
    dark: false,
    marker: /当前/,
    hero: /别再挑模型/,
    cta: /选择你的方案/,
  },
  {
    name: "TUI",
    dark: true,
    marker: /\*/,
    hero: /STOP PICKING MODELS/,
    cta: /VIEW PLANS/,
  },
] as const;

function renderPlan(
  dark: boolean,
  options: {
    current?: "lite" | "pro" | "ultra" | null;
    usage?: Usage;
  } = {},
) {
  document.documentElement.classList.toggle("dark", dark);
  return render(
    <PlanPage
      tiers={MOCK_TIERS}
      current={options.current === undefined ? "pro" : options.current}
      usage={options.usage ?? usage()}
    />,
  );
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe.each(MODES)("$name", ({ dark, marker, hero, cta }) => {
  it("leads with a campaign hero and a direct pricing CTA", () => {
    renderPlan(dark, { current: null });
    expect(screen.getByRole("heading", { name: hero })).toBeTruthy();
    expect(screen.getByRole("link", { name: cta })).toBeTruthy();
  });

  it("shows current plan, all prices and the visible current marker", () => {
    const { container } = renderPlan(dark);
    expect(screen.getAllByText(/Pro/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$20\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$10\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$40\.00/).length).toBeGreaterThan(0);
    const current = container.querySelector('[aria-current="true"]')!;
    expect(current.textContent).toMatch(marker);
  });

  it("shows the five-hour, weekly and billing-cycle windows", () => {
    renderPlan(dark, {
      usage: usage({ session: 100, week: 350, month: 1_000 }),
    });
    for (const label of Object.values(WINDOW_LABEL)) {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/5 小时/).length).toBeGreaterThan(0);
  });

  it("separates the Compute bonus from the monthly Reset equivalent gift", () => {
    renderPlan(dark);
    expect(screen.getAllByText(/40% Compute Bonus/).length).toBe(3);
    expect(screen.getAllByText(/19,600 积分/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/等值 1 次月 Reset/).length).toBe(3);
    expect(screen.getAllByText(/\$48\.00/).length).toBeGreaterThan(0);
  });

  it("identifies the tightest window and reports remaining Compute", () => {
    // Pro: week $7, cycle hard cap $48.
    renderPlan(dark, {
      usage: usage({ session: 225, week: 350, month: 2_400 }),
    });
    const focus = screen.getByText(/最先受限/).closest("section")!;
    expect(focus.textContent).toContain("5 小时");
    expect(focus.textContent).toContain("还剩 $0.25");
  });

  it("explains consequences before either limit is reached", () => {
    renderPlan(dark);
    expect(
      screen.getAllByText(consequenceOf("session")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(consequenceOf("week")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText(consequenceOf("month")).length).toBeGreaterThan(
      0,
    );
    expect(ACTION_CONSEQUENCE.downgrade).toContain("自动使用余额");
    expect(ACTION_CONSEQUENCE.downgrade).toContain("对应窗口 Reset");
    expect(ACTION_CONSEQUENCE.paused).toContain("月 Reset");
  });

  it("reports exhausted subscription at the weekly limit", () => {
    renderPlan(dark, { usage: usage({ week: 700 }) });
    expect(screen.getByText("套餐窗口额度已用完")).toBeTruthy();
    expect(screen.queryByText("账期套餐额度已用完")).toBeNull();
  });

  it("reports exhausted subscription at the five-hour limit", () => {
    renderPlan(dark, { usage: usage({ session: 250 }) });
    expect(screen.getByText("套餐窗口额度已用完")).toBeTruthy();
  });

  it("reports exhausted subscription at the 2.4M billing-cycle hard cap", () => {
    renderPlan(dark, { usage: usage({ month: 4_800 }) });
    expect(screen.getByText("账期套餐额度已用完")).toBeTruthy();
    expect(screen.queryByText("套餐窗口额度已用完")).toBeNull();
  });

  it("shows the harder consequence when both limits are reached", () => {
    renderPlan(dark, { usage: usage({ week: 700, month: 4_800 }) });
    expect(screen.getByText("账期套餐额度已用完")).toBeTruthy();
  });

  it("does not draw entitlement bars for an unsubscribed PAYG user", () => {
    renderPlan(dark, { current: null, usage: usage({ week: 700 }) });
    expect(screen.queryByText(/最先受限/)).toBeNull();
    expect(screen.getAllByText(/PAYG/).length).toBeGreaterThan(0);
  });

  it("suggests the next plan only after a limit is reached", () => {
    const result = renderPlan(dark);
    expect(screen.queryByText(/升到 Ultra/)).toBeNull();
    result.unmount();
    cleanup();
    renderPlan(dark, { usage: usage({ month: 4_800 }) });
    expect(screen.getByText(/升到 Ultra/)).toBeTruthy();
  });

  it("remains read-only until checkout is connected", () => {
    const { container } = renderPlan(dark);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("theme consistency", () => {
  it("selects the same tightest window in glass and TUI modes", () => {
    const current = usage({ session: 225, week: 350, month: 2_400 });
    const glass = renderPlan(false, { usage: current });
    const glassText = screen
      .getByText(/最先受限/)
      .closest("section")!.textContent;
    glass.unmount();
    cleanup();
    renderPlan(true, { usage: current });
    const tuiText = screen
      .getByText(/最先受限/)
      .closest("section")!.textContent;
    expect(glassText).toContain("5 小时");
    expect(tuiText).toContain("5 小时");
  });
});
