import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";

import type { GameEconomy, GameId } from "../lobby/catalog";
import type { CreatedGameSession } from "../games/core/realtime";
import {
  RESET_PRODUCTS,
  resetOffersForPlan,
  resetPrice,
} from "../points/redeem";
import type { ResetOffer, ResetSku } from "../points/redeem";
import type { LedgerEntry } from "../points/types";
import type { PlanId, PlanTier, Usage } from "../plan/types";
import {
  CodingBroApiError,
  apiRequest,
  ensureGatewayCredential,
  idempotencyKey,
  loadTokens,
  saveTokens,
  storedTokens,
} from "./client";
import {
  configureManagedProvider,
  migrateLegacyManagedProviders,
  removeManagedProviders,
} from "./managedProviders";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";

import {
  selectAvailableModel,
  type AvailableModel,
  type ModelCatalog,
} from "./models";

import { EMPTY_WALLET, type WalletState } from "./wallet";

interface UserView {
  id: string;
  email: string;
  displayName: string;
}

interface SubscriptionPayload {
  cycle: {
    publicPlanId: PlanId;
    startsAt: string;
    endsAt: string;
    planSnapshot?: SubscriptionPlanSnapshotPayload;
  };
  /** New structured contract; also accepted under entitlement during rollout. */
  windows?: SubscriptionWindowsPayload;
  planSnapshot?: SubscriptionPlanSnapshotPayload;
  entitlement: {
    /** New three-window contract. Values are micro-USD strings. */
    fiveHourAllowance?: string;
    fiveHourUsed?: string;
    weeklyAllowance?: string;
    weeklyUsed?: string;
    cycleGranted?: string;
    cycleUsed?: string;
    cycleRemaining?: string;
    cycleHardCap?: string;
    pointBalance: string;
    windows?: SubscriptionWindowsPayload;
    planSnapshot?: SubscriptionPlanSnapshotPayload;
    /** New server-authoritative catalog returned with the entitlement. */
    resetCatalog?: ResetOfferPayload[];
    /** Legacy weekly-only fields, accepted during backend rollout. */
    weeklyResetCount?: number;
    maxWeeklyResetCount?: number;
    weeklyResetPricePoints?: string;
  };
}

interface SubscriptionWindowPayload {
  kind?: string;
  durationHours?: number;
  durationDays?: number;
  index?: number;
  startsAt?: string;
  endsAt?: string;
  baseGranted?: string;
  bonusGranted?: string;
  resetGranted?: string;
  allowance?: string;
  granted?: string;
  grantedAllowance?: string;
  currentAllowance?: string;
  used?: string;
  remaining?: string;
  hardCap?: string;
  hardCapRemaining?: string;
}

interface SubscriptionWindowsPayload {
  unit?: "micro_usd";
  fiveHour?: SubscriptionWindowPayload;
  week?: SubscriptionWindowPayload;
  weekly?: SubscriptionWindowPayload;
  cycle?: SubscriptionWindowPayload;
}

interface SubscriptionPlanSnapshotPayload {
  resolution?: {
    catalogMetadata: string;
    cycleEconomics: string;
  };
  publicPlanId?: PlanId;
  tierId?: string;
  name?: string;
  publicModelId?: string;
  maxResponseOutputTokens?: number;
  catalogVersion?: string;
  profileVersion?: string;
  planVersion?: string;
  billing?: PlanBillingPayload;
  compute?: PlanComputePayload;
  giftedPointsPerCycle?: string;
  resetCatalog?: PlanResetOfferPayload[];
}

interface PlanBillingPayload {
  currency: string;
  interval: string;
  monthlyPriceCents: number;
}

interface PlanComputePayload {
  unit: string;
  fiveHourBaseComputeCents: number;
  weeklyBaseComputeCents: number;
  monthlyBaseComputeCents: number;
  cycleBonusPercent?: number;
  cycleBonusComputeCents: number;
  cycleHardCapComputeCents: number;
  concurrency: number;
  maxResponseOutputTokens: number;
}

interface PlanResetOfferPayload {
  sku: ResetSku;
  pricePoints: number | string;
  grantComputeCents: number;
  maxRedemptions: number | null;
}

interface ResetOfferPayload {
  sku: ResetSku;
  pricePoints: string | number;
  redeemedCount?: number;
  maxRedemptions?: number | null;
  redeemable?: boolean;
  unavailableReason?: string;
}

/** `/api/plans` payload; new fields stay optional for old deployments. */
interface PlanTierPayload {
  id: PlanId;
  tierId?: string;
  name: string;
  priceCents: number;
  cycleBonusPercent: number;
  fiveHourBaseCents?: number;
  sessionBaseCents?: number;
  weeklyBaseCents: number;
  monthlyBaseCents: number;
  cycleBonusCents: number;
  giftedPointsPerCycle?: number;
  cycleHardCapCents: number;
  concurrency: number;
  /** Server-owned runtime/catalog metadata. */
  publicModelId?: string;
  maxResponseOutputTokens?: number;
  catalogVersion?: string;
  profileVersion?: string;
  planVersion?: string;
  billing?: PlanBillingPayload;
  compute?: PlanComputePayload;
  resetCatalog?: PlanResetOfferPayload[];
  blurb?: string;
  longContext?: PlanTier["longContext"];
}

interface CheckoutPayload {
  billingMode: "stripe_checkout";
  checkoutUrl: string;
  sessionId: string;
  replayed: boolean;
}

interface BillingManagement {
  available: boolean;
  reason: string | null;
}

interface BackendState {
  billingManagement: BillingManagement | null;
  clearError(): void;
  wallet: WalletState;
  models: readonly AvailableModel[];
  selectedModelId: string | null;
  selectModel(modelId: string): void;
  ready: boolean;
  busy: boolean;
  error: string | null;
  user: UserView | null;
  tiers: readonly PlanTier[];
  current: PlanId | null;
  usage: Usage;
  ledger: readonly LedgerEntry[];
  resetCatalog: readonly ResetOffer[];
  gameEconomy: readonly GameEconomy[];
  login(input: { email: string; password: string }): Promise<void>;
  register(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  subscribe(plan: PlanId): Promise<void>;
  openBillingPortal(): Promise<void>;
  redeemReset(sku: ResetSku): Promise<void>;
  createGameSession(
    gameId: GameId,
    roomId?: string,
  ): Promise<CreatedGameSession>;
  settleGameSession(sessionId: string): Promise<number>;
  configureAgent(app: AppId, modelId?: string): Promise<Provider>;
}

const BackendContext = createContext<BackendState | null>(null);

function microUsdToCents(value: string): number {
  return Number(BigInt(value) / 10_000n);
}

function planCopy(id: PlanId) {
  if (id === "lite") {
    return { blurb: "日常开发能力", longContext: "no" as const };
  }
  if (id === "pro") {
    return { blurb: "复杂工程能力", longContext: "limited" as const };
  }
  return { blurb: "旗舰推理能力", longContext: "yes" as const };
}

function mapTier(tier: PlanTierPayload): PlanTier {
  // A legacy server has no five-hour field. The first client mirror derives
  // it as half of the weekly base until the backend returns an exact value.
  const fiveHourBaseCents =
    tier.fiveHourBaseCents ?? tier.sessionBaseCents ?? tier.weeklyBaseCents / 2;
  return {
    ...tier,
    blurb: tier.blurb ?? planCopy(tier.id).blurb,
    longContext: tier.longContext ?? planCopy(tier.id).longContext,
    fiveHourBaseCents,
    giftedPointsPerCycle:
      tier.giftedPointsPerCycle ?? resetPrice(tier.id, "reset_month"),
    maxResponseOutputTokens:
      tier.maxResponseOutputTokens ?? tier.compute?.maxResponseOutputTokens,
    quota: {
      session: fiveHourBaseCents,
      week: tier.weeklyBaseCents + tier.cycleBonusCents / 4,
      // Catalog cards describe the initial grant. The hard cap remains a
      // separate, theoretical ceiling reachable only after Reset redemption.
      month: tier.monthlyBaseCents + tier.cycleBonusCents,
    },
  };
}

function subscriptionPlanSnapshot(
  subscription: SubscriptionPayload,
): SubscriptionPlanSnapshotPayload | undefined {
  return (
    subscription.planSnapshot ??
    subscription.entitlement.planSnapshot ??
    subscription.cycle.planSnapshot
  );
}

function subscriptionWindows(
  subscription: SubscriptionPayload,
): SubscriptionWindowsPayload | undefined {
  return subscription.windows ?? subscription.entitlement.windows;
}

function subscriptionPlanId(subscription: SubscriptionPayload): PlanId {
  const snapshot = subscriptionPlanSnapshot(subscription);
  return snapshot?.publicPlanId ?? subscription.cycle.publicPlanId;
}

function microUsdToCentsOr(
  value: string | undefined,
  fallback: number,
): number {
  return value === undefined ? fallback : microUsdToCents(value);
}

function mapResetCatalog(
  subscription: SubscriptionPayload | null,
): ResetOffer[] {
  const plan = subscription?.cycle.publicPlanId;
  if (!plan) return [];
  const baseline = resetOffersForPlan(plan);
  const payload = subscription.entitlement.resetCatalog;
  if (payload?.length) {
    return RESET_PRODUCTS.map((product) => {
      const server = payload.find((offer) => offer.sku === product.sku);
      const fallback = baseline.find((offer) => offer.sku === product.sku)!;
      if (!server) return { ...fallback, redeemable: false };
      const maxRedemptions = server.maxRedemptions ?? null;
      const redeemedCount = server.redeemedCount ?? 0;
      return {
        sku: product.sku,
        pricePoints: Number(server.pricePoints),
        redeemedCount,
        maxRedemptions,
        redeemable:
          (server.redeemable ?? true) &&
          (maxRedemptions == null || redeemedCount < maxRedemptions),
        unavailableReason: server.unavailableReason,
      };
    });
  }

  // Old subscription responses only describe the weekly Reset. Preserve that
  // server-owned price/counter while exposing the new 5h/month client catalog.
  return baseline.map((offer) => {
    if (offer.sku !== "reset_week") {
      return {
        ...offer,
        redeemable: false,
        unavailableReason: "服务端升级后开放",
      };
    }
    const maxRedemptions = subscription.entitlement.maxWeeklyResetCount ?? null;
    const redeemedCount = subscription.entitlement.weeklyResetCount ?? 0;
    return {
      ...offer,
      pricePoints: Number(
        subscription.entitlement.weeklyResetPricePoints ?? offer.pricePoints,
      ),
      redeemedCount,
      maxRedemptions,
      redeemable: maxRedemptions == null || redeemedCount < maxRedemptions,
    };
  });
}

function mapLedger(input: {
  id: string;
  kind: LedgerEntry["kind"];
  amount: string;
  at: string;
  memo: string;
}): LedgerEntry {
  return {
    id: input.id,
    kind: input.kind,
    amount: Number(input.amount),
    at: new Date(input.at).getTime(),
    memo: input.memo,
  };
}

export function BackendProvider({ children }: { children: React.ReactNode }) {
  const [billingManagement, setBillingManagement] =
    useState<BillingManagement | null>(null);
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [models, setModels] = useState<readonly AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserView | null>(null);
  const [tiers, setTiers] = useState<readonly PlanTier[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionPayload | null>(
    null,
  );
  const [ledger, setLedger] = useState<readonly LedgerEntry[]>([]);
  const [gameEconomy, setGameEconomy] = useState<readonly GameEconomy[]>([]);

  const refresh = useCallback(async () => {
    const [catalog, games] = await Promise.all([
      apiRequest<{
        catalogVersion?: string;
        tiers: PlanTierPayload[];
      }>("/api/plans"),
      apiRequest<{ games: GameEconomy[] }>("/api/games"),
    ]);
    setTiers(
      catalog.tiers.map((tier) =>
        mapTier({
          ...tier,
          catalogVersion: tier.catalogVersion ?? catalog.catalogVersion,
        }),
      ),
    );
    setGameEconomy(games.games);
    if (!storedTokens()) {
      setBillingManagement(null);
      setWallet(EMPTY_WALLET);
      setModels([]);
      setSelectedModelId(null);
      setUser(null);
      setSubscription(null);
      setLedger([]);
      return;
    }
    const me = await apiRequest<UserView>("/api/auth/me");
    setUser(me);
    const [nextSubscription, points, nextWallet] = await Promise.all([
      apiRequest<SubscriptionPayload>("/api/subscription").catch((reason) => {
        if (reason instanceof CodingBroApiError && reason.code === 3001) {
          return null;
        }
        throw reason;
      }),
      apiRequest<{
        entries: Array<{
          id: string;
          kind: LedgerEntry["kind"];
          amount: string;
          at: string;
          memo: string;
        }>;
      }>("/api/points"),
      apiRequest<WalletState>("/api/wallet"),
    ]);
    const management = nextSubscription
      ? await apiRequest<BillingManagement>("/api/billing/portal").catch(
          () => ({
            available: false,
            reason: "暂时无法获取订阅管理状态，请刷新账户后重试。",
          }),
        )
      : null;
    setBillingManagement(management);
    setSubscription(nextSubscription);
    setWallet(nextWallet);
    try {
      const modelCatalog = await apiRequest<ModelCatalog>("/api/models");
      setModels(modelCatalog.models);
      setSelectedModelId((previous) =>
        selectAvailableModel(modelCatalog, previous),
      );
    } catch (reason) {
      setModels([]);
      setSelectedModelId(null);
      throw reason;
    }
    setLedger(points.entries.map(mapLedger));
  }, []);

  useEffect(() => {
    void loadTokens()
      .then(async () => {
        await migrateLegacyManagedProviders();
        await refresh();
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        if (reason instanceof CodingBroApiError && reason.status === 401) {
          void saveTokens(null);
          setUser(null);
        }
      })
      .finally(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ status: "success" | "cancel" }>(
      "codingbro-billing",
      (event) => {
        if (event.payload.status === "success") {
          void refresh().catch((reason) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          );
        }
      },
    ).then((value) => {
      if (disposed) value();
      else unlisten = value;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      throw reason;
    } finally {
      setBusy(false);
    }
  }, []);

  const authenticate = useCallback(
    async (
      path: "/api/auth/login" | "/api/auth/register",
      input: Record<string, string>,
    ) => {
      await run(async () => {
        const result = await apiRequest<{
          user: UserView;
          accessToken: string;
          refreshToken: string;
          gatewayToken?: string;
        }>(path, { method: "POST", body: JSON.stringify(input) });
        await saveTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          gatewayToken: result.gatewayToken,
        });
        setUser(result.user);
        await refresh();
      });
    },
    [refresh, run],
  );

  const value = useMemo<BackendState>(() => {
    const current = subscription ? subscriptionPlanId(subscription) : null;
    const currentTier = tiers.find((tier) => tier.id === current);
    const planSnapshot = subscription
      ? subscriptionPlanSnapshot(subscription)
      : undefined;
    const windows = subscription
      ? subscriptionWindows(subscription)
      : undefined;
    const fiveHourWindow = windows?.fiveHour;
    const weeklyWindow = windows?.week ?? windows?.weekly;
    const cycleWindow = windows?.cycle;
    const initialCycleGrant = currentTier
      ? currentTier.monthlyBaseCents + currentTier.cycleBonusCents
      : 0;
    const cycleGranted = subscription
      ? microUsdToCentsOr(
          cycleWindow?.currentAllowance ??
            cycleWindow?.grantedAllowance ??
            cycleWindow?.granted ??
            cycleWindow?.allowance ??
            subscription.entitlement.cycleGranted,
          initialCycleGrant,
        )
      : 0;
    const cycleRemaining =
      cycleWindow?.remaining ?? subscription?.entitlement.cycleRemaining;
    const cycleUsed = subscription
      ? microUsdToCentsOr(
          cycleWindow?.used ?? subscription.entitlement.cycleUsed,
          cycleRemaining === undefined
            ? 0
            : Math.max(0, cycleGranted - microUsdToCents(cycleRemaining)),
        )
      : 0;
    const resetCatalog = mapResetCatalog(subscription);
    const monthlyResetPrice = resetCatalog.find(
      (offer) => offer.sku === "reset_month",
    )?.pricePoints;
    const usage = subscription
      ? {
          session: microUsdToCentsOr(
            fiveHourWindow?.used ?? subscription.entitlement.fiveHourUsed,
            0,
          ),
          week: microUsdToCentsOr(
            weeklyWindow?.used ?? subscription.entitlement.weeklyUsed,
            0,
          ),
          month: cycleUsed,
        }
      : { session: 0, week: 0, month: 0 };
    const visibleTiers = tiers.map((tier) =>
      tier.id === current && subscription
        ? {
            ...tier,
            name: planSnapshot?.name ?? tier.name,
            publicModelId: planSnapshot?.publicModelId ?? tier.publicModelId,
            maxResponseOutputTokens:
              planSnapshot?.compute?.maxResponseOutputTokens ??
              planSnapshot?.maxResponseOutputTokens ??
              tier.maxResponseOutputTokens,
            catalogVersion: planSnapshot?.catalogVersion ?? tier.catalogVersion,
            profileVersion: planSnapshot?.profileVersion ?? tier.profileVersion,
            planVersion: planSnapshot?.planVersion ?? tier.planVersion,
            fiveHourBaseCents:
              planSnapshot?.compute?.fiveHourBaseComputeCents ??
              tier.fiveHourBaseCents,
            weeklyBaseCents:
              planSnapshot?.compute?.weeklyBaseComputeCents ??
              tier.weeklyBaseCents,
            monthlyBaseCents:
              planSnapshot?.compute?.monthlyBaseComputeCents ??
              tier.monthlyBaseCents,
            cycleBonusCents:
              planSnapshot?.compute?.cycleBonusComputeCents ??
              tier.cycleBonusCents,
            cycleHardCapCents:
              planSnapshot?.compute?.cycleHardCapComputeCents ??
              tier.cycleHardCapCents,
            concurrency: planSnapshot?.compute?.concurrency ?? tier.concurrency,
            giftedPointsPerCycle:
              monthlyResetPrice ?? tier.giftedPointsPerCycle,
            quota: {
              session: microUsdToCentsOr(
                fiveHourWindow?.currentAllowance ??
                  fiveHourWindow?.grantedAllowance ??
                  fiveHourWindow?.allowance ??
                  fiveHourWindow?.granted ??
                  subscription.entitlement.fiveHourAllowance,
                currentTier?.quota.session ?? tier.quota.session,
              ),
              week: microUsdToCentsOr(
                weeklyWindow?.currentAllowance ??
                  weeklyWindow?.grantedAllowance ??
                  weeklyWindow?.allowance ??
                  weeklyWindow?.granted ??
                  subscription.entitlement.weeklyAllowance,
                currentTier?.quota.week ?? tier.quota.week,
              ),
              month: cycleGranted,
            },
          }
        : tier,
    );
    return {
      billingManagement,
      clearError: () => setError(null),
      ready,
      busy,
      error,
      user,
      wallet,
      models,
      selectedModelId,
      selectModel: (modelId) => {
        if (models.some((model) => model.id === modelId))
          setSelectedModelId(modelId);
      },
      tiers: visibleTiers,
      current,
      usage,
      ledger,
      resetCatalog,
      gameEconomy,
      login: (input) => authenticate("/api/auth/login", input),
      register: (input) => authenticate("/api/auth/register", input),
      logout: () =>
        run(async () => {
          const refreshToken = storedTokens()?.refreshToken;
          await apiRequest("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({ refreshToken }),
          }).catch(() => undefined);
          await removeManagedProviders().catch(() => undefined);
          await saveTokens(null);
          setBillingManagement(null);
          setWallet(EMPTY_WALLET);
          setModels([]);
          setSelectedModelId(null);
          setUser(null);
          setSubscription(null);
          setLedger([]);
        }),
      refresh,
      subscribe: (plan) =>
        run(async () => {
          if (!user) throw new Error("请先登录 Coding Bro 账户");
          const result = await apiRequest<CheckoutPayload>(
            "/api/billing/checkout",
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey("subscribe") },
              body: JSON.stringify({ planId: plan }),
            },
          );
          if (result.billingMode !== "stripe_checkout" || !result.checkoutUrl) {
            throw new Error("订阅必须完成支付后才能生效，请更新后端服务");
          }
          await openExternal(result.checkoutUrl);
        }),
      openBillingPortal: () =>
        run(async () => {
          if (!billingManagement?.available) {
            throw new Error(billingManagement?.reason ?? "请先刷新账户后重试");
          }
          const result = await apiRequest<{ portalUrl: string }>(
            "/api/billing/portal",
            { method: "POST" },
          );
          await openExternal(result.portalUrl);
        }),
      redeemReset: (sku) =>
        run(async () => {
          const hasGenericResetContract = Boolean(
            subscription?.entitlement.resetCatalog,
          );
          if (sku === "reset_week" && !hasGenericResetContract) {
            await apiRequest("/api/subscription/resets/weekly", {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey("weekly-reset") },
            });
          } else {
            // New contract: one endpoint for all Reset SKUs. The service owns
            // eligibility, point deduction, quota reset and idempotency.
            await apiRequest("/api/subscription/resets", {
              method: "POST",
              headers: {
                "Idempotency-Key": idempotencyKey(`reset-${sku}`),
              },
              body: JSON.stringify({ sku }),
            });
          }
          await refresh();
        }),
      createGameSession: async (gameId, roomId) => {
        let session: CreatedGameSession | null = null;
        await run(async () => {
          const result = await apiRequest<CreatedGameSession>(
            "/api/games/sessions",
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey("game-entry") },
              body: JSON.stringify({ gameId, roomId }),
            },
          );
          session = result;
          await refresh();
        });
        if (!session) throw new Error("游戏服务没有返回入场会话");
        return session;
      },
      settleGameSession: async (sessionId) => {
        let awardedPoints = 0;
        await run(async () => {
          const result = await apiRequest<{ awardedPoints: string }>(
            `/api/games/sessions/${encodeURIComponent(sessionId)}/settle`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey("game-settle") },
            },
          );
          awardedPoints = Number(result.awardedPoints);
          await refresh();
        });
        return awardedPoints;
      },
      configureAgent: async (app, modelId) => {
        const plan = subscription?.cycle.publicPlanId;
        if (!user) {
          throw new Error("请先登录 Coding Bro 账户");
        }
        const catalog = await apiRequest<ModelCatalog>("/api/models");
        setModels(catalog.models);
        const requested = modelId ?? selectedModelId;
        const available = selectAvailableModel(catalog, requested);
        setSelectedModelId(available);
        if (!available || (requested && available !== requested)) {
          throw new Error("所选模型已不可用，请重新选择模型后启动");
        }
        const gatewayCredential = await ensureGatewayCredential();
        return await configureManagedProvider(
          app,
          gatewayCredential,
          plan ?? "lite",
          available,
        );
      },
    };
  }, [
    billingManagement,
    authenticate,
    busy,
    error,
    gameEconomy,
    wallet,
    models,
    selectedModelId,
    ledger,
    ready,
    refresh,
    run,
    subscription,
    tiers,
    user,
  ]);

  return (
    <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
  );
}

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function useCodingBroBackend(): BackendState | null {
  return useContext(BackendContext);
}
