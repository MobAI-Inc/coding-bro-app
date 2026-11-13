import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  BackendProvider,
  useCodingBroBackend,
} from "@/bro/api/BackendProvider";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public readonly code: number,
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    apiRequest: vi.fn(),
    openUrl: vi.fn(),
    ensureGatewayCredential: vi.fn(),
    configureManagedProvider: vi.fn(),
    migrateLegacyManagedProviders: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));
vi.mock("@/bro/api/client", () => ({
  CodingBroApiError: mocks.ApiError,
  apiRequest: mocks.apiRequest,
  idempotencyKey: vi.fn(() => "subscribe:test-request"),
  ensureGatewayCredential: mocks.ensureGatewayCredential,
  loadTokens: vi.fn().mockResolvedValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    gatewayToken: "gateway-token",
  }),
  saveTokens: vi.fn().mockResolvedValue(undefined),
  storedTokens: vi.fn(() => ({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    gatewayToken: "gateway-token",
  })),
}));
vi.mock("@/bro/api/managedProviders", () => ({
  configureManagedProvider: mocks.configureManagedProvider,
  removeManagedProviders: vi.fn().mockResolvedValue(undefined),
  migrateLegacyManagedProviders: mocks.migrateLegacyManagedProviders,
}));

const catalog = {
  catalogVersion: "catalog-2026-09-02",
  tiers: [
    {
      id: "pro",
      name: "Pro",
      priceCents: 2_000,
      weeklyBaseCents: 700,
      monthlyBaseCents: 2_000,
      cycleBonusCents: 800,
      cycleBonusPercent: 40,
      maxWeeklyResets: 4,
      cycleHardCapCents: 4_800,
      concurrency: 4,
      publicModelId: "codingbro-pro-2.1",
      maxResponseOutputTokens: 4_096,
      profileVersion: "router-v2",
      planVersion: "launch-2026-09-01:pro",
    },
  ],
};
const subscription = {
  cycle: {
    publicPlanId: "pro",
    startsAt: "2026-08-30T00:00:00.000Z",
    endsAt: "2026-09-30T00:00:00.000Z",
  },
  entitlement: {
    weeklyAllowance: "7000000",
    weeklyUsed: "0",
    cycleGranted: "28000000",
    cycleHardCap: "48000000",
    cycleUsed: "0",
    cycleRemaining: "28000000",
    weeklyResetCount: 0,
    maxWeeklyResetCount: 4,
    pointBalance: "32000",
    weeklyResetPricePoints: "8000",
  },
};

function Harness() {
  const backend = useCodingBroBackend();
  if (!backend?.ready) return <span>loading</span>;
  const tier = backend.tiers.find(
    (candidate) => candidate.id === backend.current,
  );
  return (
    <>
      <span>model:{backend.selectedModelId ?? "none"}</span>
      <button
        onClick={() =>
          void backend.configureAgent("codex").catch(() => undefined)
        }
      >
        launch-model
      </button>
      <span>error:{backend.error ?? "none"}</span>
      <span>balance:{backend.wallet.availableMicroUsd}</span>
      <span>current:{backend.current ?? "none"}</span>
      <span>
        session:{backend.usage.session}/{tier?.quota.session ?? 0}
      </span>
      <span>
        month:{backend.usage.month}/{tier?.quota.month ?? 0}
      </span>
      <span>hard-cap:{tier?.cycleHardCapCents ?? 0}</span>
      <span>
        runtime:{tier?.publicModelId ?? "none"}/
        {tier?.maxResponseOutputTokens ?? 0}/{tier?.catalogVersion ?? "none"}/
        {tier?.profileVersion ?? "none"}/{tier?.planVersion ?? "none"}
      </span>
      <span>
        catalog:
        {backend.resetCatalog
          .map((offer) => `${offer.sku}:${offer.redeemable}`)
          .join("|")}
      </span>
      <button
        type="button"
        onClick={() => void backend.subscribe("pro").catch(() => undefined)}
      >
        subscribe
      </button>
      <button
        type="button"
        onClick={() => void backend.redeemReset("reset_5h")}
      >
        reset-5h
      </button>
    </>
  );
}

function arrange(checkout: Record<string, unknown>, active = false) {
  const activated = active;
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path === "/api/plans") return catalog;
    if (path === "/api/models")
      return {
        models: [
          { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai" },
        ],
        defaultModelId: "gpt-5.6-sol",
      };
    if (path === "/api/games") return { games: [] };
    if (path === "/api/auth/me") {
      return { id: "user-1", email: "user@example.com", displayName: "User" };
    }
    if (path === "/api/wallet")
      return {
        currency: "USD",
        balanceMicroUsd: "10000000",
        reservedMicroUsd: "0",
        availableMicroUsd: "10000000",
        entries: [],
      };
    if (path === "/api/billing/portal")
      return { available: false, reason: "历史套餐请联系管理员" };
    if (path === "/api/points") return { entries: [] };
    if (path === "/api/subscription") {
      if (activated) return checkout.subscription ?? subscription;
      throw new mocks.ApiError(3001, "No active subscription", 404);
    }
    if (path === "/api/billing/checkout") {
      return checkout;
    }
    if (path === "/api/subscription/resets") return {};
    throw new Error(`Unexpected API path: ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.ensureGatewayCredential.mockResolvedValue({
    gatewayToken: "gateway-token",
  });
  mocks.configureManagedProvider.mockResolvedValue({
    id: "coding-bro-plan",
    name: "Coding Bro Plan",
    settingsConfig: {},
    category: "custom",
  });
  mocks.migrateLegacyManagedProviders.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("BackendProvider plan checkout", () => {
  it("rejects the removed free activation response", async () => {
    arrange({
      billingMode: "direct_activation",
      subscription,
      replayed: false,
    });
    render(
      <BackendProvider>
        <Harness />
      </BackendProvider>,
    );
    await screen.findByText("current:none");
    fireEvent.click(screen.getByRole("button", { name: "subscribe" }));
    await screen.findByText("error:订阅必须完成支付后才能生效，请更新后端服务");
    expect(screen.getByText("current:none")).toBeInTheDocument();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("uses the generic endpoint and three-window payload for the new contract", async () => {
    const modernSubscription = {
      ...subscription,
      windows: {
        unit: "micro_usd",
        fiveHour: {
          baseGranted: "3500000",
          resetGranted: "100000",
          grantedAllowance: "3600000",
          currentAllowance: "3600000",
          used: "1100000",
          remaining: "2500000",
        },
        week: {
          baseGranted: "7000000",
          bonusGranted: "2000000",
          resetGranted: "0",
          grantedAllowance: "9000000",
          currentAllowance: "9000000",
          used: "2000000",
          remaining: "7000000",
          index: 1,
        },
        cycle: {
          baseGranted: "20000000",
          bonusGranted: "8000000",
          resetGranted: "2000000",
          grantedAllowance: "30000000",
          currentAllowance: "30000000",
          used: "12000000",
          remaining: "18000000",
          hardCap: "48000000",
          hardCapRemaining: "18000000",
        },
      },
      planSnapshot: {
        publicPlanId: "pro",
        name: "Pro Snapshot",
        publicModelId: "codingbro-pro-2.2",
        catalogVersion: "catalog-snapshot-v2",
        profileVersion: "router-v3",
        planVersion: "catalog-snapshot-v2:pro",
        compute: {
          unit: "usd_cents_equivalent",
          fiveHourBaseComputeCents: 350,
          weeklyBaseComputeCents: 700,
          monthlyBaseComputeCents: 2_000,
          cycleBonusComputeCents: 800,
          cycleHardCapComputeCents: 4_800,
          concurrency: 4,
          maxResponseOutputTokens: 6_144,
        },
      },
      entitlement: {
        ...subscription.entitlement,
        fiveHourAllowance: "3500000",
        fiveHourUsed: "1000000",
        resetCatalog: [
          { sku: "reset_5h", pricePoints: "2400", redeemable: true },
          { sku: "reset_week", pricePoints: "8400", redeemable: true },
          { sku: "reset_month", pricePoints: "19600", redeemable: true },
        ],
      },
    };
    arrange(
      {
        billingMode: "stripe_checkout",
        subscription: modernSubscription,
        replayed: false,
      },
      true,
    );
    render(
      <BackendProvider>
        <Harness />
      </BackendProvider>,
    );

    await screen.findByText("session:110/360");
    expect(screen.getByText("month:1200/3000")).toBeInTheDocument();
    expect(
      screen.getByText(
        "runtime:codingbro-pro-2.2/6144/catalog-snapshot-v2/router-v3/catalog-snapshot-v2:pro",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "reset-5h" }));

    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        "/api/subscription/resets",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sku: "reset_5h" }),
        }),
      ),
    );
  });

  it("keeps opening Stripe Checkout when the backend selects that mode", async () => {
    arrange({
      billingMode: "stripe_checkout",
      checkoutUrl: "https://checkout.stripe.example/session",
      sessionId: "cs_1",
      replayed: false,
    });
    render(
      <BackendProvider>
        <Harness />
      </BackendProvider>,
    );

    await screen.findByText("current:none");
    fireEvent.click(screen.getByRole("button", { name: "subscribe" }));

    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://checkout.stripe.example/session",
      ),
    );
    expect(screen.getByText("current:none")).toBeInTheDocument();
  });
});

describe("backend model catalog", () => {
  it("uses the server model instead of the credential default", async () => {
    arrange(
      {
        billingMode: "stripe_checkout",
        subscription,
        replayed: false,
      },
      true,
    );
    render(
      <BackendProvider>
        <Harness />
      </BackendProvider>,
    );
    await screen.findByText("model:gpt-5.6-sol");
    fireEvent.click(screen.getByText("launch-model"));
    await waitFor(() =>
      expect(mocks.configureManagedProvider).toHaveBeenCalledWith(
        "codex",
        { gatewayToken: "gateway-token" },
        "pro",
        "gpt-5.6-sol",
      ),
    );
  });
  it("refuses a model removed between selection and launch", async () => {
    arrange(
      {
        billingMode: "stripe_checkout",
        subscription,
        replayed: false,
      },
      true,
    );
    render(
      <BackendProvider>
        <Harness />
      </BackendProvider>,
    );
    await screen.findByText("model:gpt-5.6-sol");
    mocks.apiRequest.mockResolvedValueOnce({
      models: [],
      defaultModelId: null,
    });
    fireEvent.click(screen.getByText("launch-model"));
    await screen.findByText("model:none");
    expect(mocks.configureManagedProvider).not.toHaveBeenCalled();
  });
});

it("allows a cash-funded user to launch without a subscription", async () => {
  arrange({ billingMode: "stripe_checkout" });
  render(
    <BackendProvider>
      <Harness />
    </BackendProvider>,
  );
  await screen.findByText("model:gpt-5.6-sol");
  expect(screen.getByText("current:none")).toBeInTheDocument();
  expect(screen.getByText("balance:10000000")).toBeInTheDocument();
  fireEvent.click(screen.getByText("launch-model"));
  await waitFor(() =>
    expect(mocks.configureManagedProvider).toHaveBeenCalledWith(
      "codex",
      { gatewayToken: "gateway-token" },
      "lite",
      "gpt-5.6-sol",
    ),
  );
});
