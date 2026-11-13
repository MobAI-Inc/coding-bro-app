export type ProductId = "coding-bro" | "codex-lite";

export type ModelProvider =
  | "coding-bro"
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "gemini";

export type ModelApiFormat =
  | "openai_responses"
  | "openai_chat_completions"
  | "anthropic_messages"
  | "gemini_generate_content";

export interface AvailableModel {
  id: string;
  name: string;
  provider: ModelProvider;
  /** Required to opt a third-party model into the Codex Lite catalog. */
  apiFormat?: ModelApiFormat;
  responsesCompatible?: boolean;
  walletPricing?: {
    inputMicroUsdPerMillionTokens: string;
    outputMicroUsdPerMillionTokens: string;
    longInputMicroUsdPerMillionTokens: string;
    longOutputMicroUsdPerMillionTokens: string;
  };
  subscriptionEligible?: boolean;
  billingSource?: "subscription_then_balance" | "balance";
}

export interface ModelCatalog {
  product?: ProductId;
  models: AvailableModel[];
  defaultModelId: string | null;
}

export interface UserView {
  id: string;
  email: string;
  displayName: string;
}

export type AccountUser = UserView;

export interface GatewayCredential {
  gatewayToken: string;
  inferenceBaseUrl?: string;
  publicModelId?: string;
  profileVersion?: string;
  planVersion?: string;
  expiresAt?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Retained for compatibility with the existing authentication response. */
  gatewayToken?: string;
  gatewayCredential?: GatewayCredential;
}

export interface AuthPayload extends SessionTokens {
  user: UserView;
}

export type PlanId = "lite" | "pro" | "ultra";

export interface PlanBillingPayload {
  currency: string;
  interval: string;
  monthlyPriceCents: number;
}

export interface PlanComputePayload {
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

/** Server-owned economics; Lite does not implement points or Reset products. */
export interface PlanTierPayload {
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
  publicModelId?: string;
  maxResponseOutputTokens?: number;
  catalogVersion?: string;
  profileVersion?: string;
  planVersion?: string;
  billing?: PlanBillingPayload;
  compute?: PlanComputePayload;
  blurb?: string;
  longContext?: "no" | "limited" | "yes";
}

export type PlanTier = PlanTierPayload;

export interface PlanCatalog {
  product?: ProductId;
  catalogVersion?: string;
  tiers: PlanTierPayload[];
}

export interface SubscriptionWindowPayload {
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

export interface SubscriptionWindowsPayload {
  unit?: "micro_usd";
  fiveHour?: SubscriptionWindowPayload;
  week?: SubscriptionWindowPayload;
  weekly?: SubscriptionWindowPayload;
  cycle?: SubscriptionWindowPayload;
}

export interface SubscriptionPlanSnapshotPayload {
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
}

export interface SubscriptionPayload {
  cycle: {
    publicPlanId: PlanId;
    startsAt: string;
    endsAt: string;
    planSnapshot?: SubscriptionPlanSnapshotPayload;
  };
  windows?: SubscriptionWindowsPayload;
  planSnapshot?: SubscriptionPlanSnapshotPayload;
  entitlement: {
    fiveHourAllowance?: string;
    fiveHourUsed?: string;
    weeklyAllowance?: string;
    weeklyUsed?: string;
    cycleGranted?: string;
    cycleUsed?: string;
    cycleRemaining?: string;
    cycleHardCap?: string;
    /** Existing servers include these fields; Lite does not use them. */
    pointBalance?: string;
    windows?: SubscriptionWindowsPayload;
    planSnapshot?: SubscriptionPlanSnapshotPayload;
  };
}

export interface WalletState {
  currency: "USD";
  balanceMicroUsd: string;
  reservedMicroUsd: string;
  availableMicroUsd: string;
  entries: {
    id: string;
    kind: "credit" | "debit";
    amountMicroUsd: string;
    at: string;
    memo: string;
    modelId?: string | null;
    stripeSessionId?: string | null;
  }[];
}

export const EMPTY_WALLET: WalletState = {
  currency: "USD",
  balanceMicroUsd: "0",
  reservedMicroUsd: "0",
  availableMicroUsd: "0",
  entries: [],
};

export interface CheckoutPayload {
  billingMode: "stripe_checkout";
  checkoutUrl: string;
  sessionId: string;
  replayed: boolean;
}

export const WALLET_RECHARGE_AMOUNTS_CENTS = [1000, 2500, 5000, 10000] as const;
export type WalletRechargeAmountCents =
  (typeof WALLET_RECHARGE_AMOUNTS_CENTS)[number];

export interface WalletCheckoutPayload extends CheckoutPayload {
  currency: "USD";
  amountMicroUsd: string;
}

export interface WalletRechargeState {
  sessionId: string;
  amountCents: WalletRechargeAmountCents;
  status: "pending" | "canceled" | "credited";
}

export interface BillingManagement {
  available: boolean;
  reason: string | null;
}
