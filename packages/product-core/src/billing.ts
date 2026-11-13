import {
  WALLET_RECHARGE_AMOUNTS_CENTS,
  type WalletCheckoutPayload,
  type WalletRechargeAmountCents,
} from "./types";

function stripeUrl(value: unknown, host: string): string {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("Stripe 支付地址无效");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Stripe 支付地址无效");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("只能打开 Stripe 官方 HTTPS 支付地址");
  }
  return url.href;
}

export function validateStripeCheckout(
  result: unknown,
  purpose: "订阅" | "充值" = "订阅",
): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("billingMode" in result) ||
    result.billingMode !== "stripe_checkout" ||
    !("checkoutUrl" in result)
  ) {
    throw new Error(`${purpose}必须通过 Stripe Checkout 完成支付`);
  }
  return stripeUrl(result.checkoutUrl, "checkout.stripe.com");
}

export function validateWalletCheckout(
  result: unknown,
  amountCents: WalletRechargeAmountCents,
): WalletCheckoutPayload {
  const checkoutUrl = validateStripeCheckout(result, "充值");
  const payload = result as Partial<WalletCheckoutPayload>;
  if (
    !WALLET_RECHARGE_AMOUNTS_CENTS.includes(amountCents) ||
    payload.currency !== "USD" ||
    payload.amountMicroUsd !== String(amountCents * 10_000) ||
    typeof payload.sessionId !== "string" ||
    !/^cs_[a-zA-Z0-9_]+$/.test(payload.sessionId) ||
    typeof payload.replayed !== "boolean"
  ) {
    throw new Error("充值订单金额或支付信息无效，请重试");
  }
  return { ...(payload as WalletCheckoutPayload), checkoutUrl };
}

interface WalletCheckoutOptions {
  request<T>(path: string, init: RequestInit): Promise<T>;
  idempotencyKey(): string;
  openCheckout(url: string): Promise<void>;
  activeUserId(): string | null | undefined;
  hasSession(): boolean;
}

/** One authenticated recharge attempt, reusable after ambiguous transport errors. */
export function createWalletCheckout(options: WalletCheckoutOptions) {
  let attempt: {
    userId: string;
    amountCents: WalletRechargeAmountCents;
    key: string;
    checkout?: WalletCheckoutPayload;
  } | null = null;

  function ensureSession(userId: string) {
    if (!userId || !options.hasSession())
      throw new Error("请先登录 Coding Bro 账户");
    if (options.activeUserId() !== userId)
      throw new Error("登录会话已变更，请重新发起充值");
  }

  return {
    reset() {
      attempt = null;
    },
    async start(userId: string, amountCents: WalletRechargeAmountCents) {
      ensureSession(userId);
      if (!WALLET_RECHARGE_AMOUNTS_CENTS.includes(amountCents))
        throw new Error("请选择有效的充值金额");
      if (
        !attempt ||
        attempt.userId !== userId ||
        attempt.amountCents !== amountCents
      ) {
        attempt = { userId, amountCents, key: options.idempotencyKey() };
      }
      const current = attempt;
      if (!current.checkout) {
        let result: unknown;
        try {
          result = await options.request<unknown>("/api/wallet/checkout", {
            method: "POST",
            headers: { "Idempotency-Key": current.key },
            body: JSON.stringify({ amountCents }),
          });
        } catch (reason) {
          // Both client adapters expose HTTP status on API errors. Keep the
          // key after transport/5xx failures: the order may already exist.
          if (
            reason &&
            typeof reason === "object" &&
            "status" in reason &&
            typeof reason.status === "number" &&
            reason.status < 500 &&
            attempt === current
          ) {
            attempt = null;
          }
          throw reason;
        }
        try {
          current.checkout = validateWalletCheckout(result, amountCents);
        } catch (reason) {
          if (attempt === current) attempt = null;
          throw reason;
        }
      }
      ensureSession(userId);
      if (attempt !== current)
        throw new Error("充值会话已变更，请重新发起充值");
      try {
        await options.openCheckout(current.checkout.checkoutUrl);
      } catch {
        throw new Error("无法打开系统浏览器，请重试打开支付页面");
      }
      ensureSession(userId);
      return current.checkout;
    },
  };
}

export function validateStripePortalUrl(url: unknown): string {
  return stripeUrl(url, "billing.stripe.com");
}
