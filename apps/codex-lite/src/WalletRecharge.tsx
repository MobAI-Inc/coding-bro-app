import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import {
  createWalletCheckout,
  WALLET_RECHARGE_AMOUNTS_CENTS,
  type WalletRechargeAmountCents,
  type WalletRechargeState,
  type WalletState,
} from "@coding-bro/product-core";
import { api } from "./backend";
import "./wallet-recharge.css";

interface WalletRechargeProps {
  userId: string;
  wallet: Partial<WalletState> | null;
  busy?: boolean;
  refreshAccount(): Promise<void>;
}

export function WalletRecharge({
  userId,
  wallet,
  busy = false,
  refreshAccount,
}: WalletRechargeProps) {
  const [amountCents, setAmountCents] =
    useState<WalletRechargeAmountCents>(2500);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recharge, setRecharge] = useState<WalletRechargeState | null>(null);
  const activeUserId = useRef<string | undefined>(userId);
  const mounted = useRef(true);
  const operation = useRef(false);
  activeUserId.current = userId;
  const checkout = useMemo(
    () =>
      createWalletCheckout({
        request: api.request,
        idempotencyKey: () => `wallet-recharge:${crypto.randomUUID()}`,
        openCheckout: openUrl,
        activeUserId: () => activeUserId.current,
        hasSession: () => Boolean(api.storedTokens()),
      }),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    activeUserId.current = userId;
    checkout.reset();
    setRecharge(null);
    setError(null);
    return () => {
      mounted.current = false;
      activeUserId.current = undefined;
      checkout.reset();
    };
  }, [userId, checkout]);

  useEffect(() => {
    if (
      recharge &&
      recharge.status !== "credited" &&
      wallet?.entries?.some(
        (entry) =>
          entry.kind === "credit" &&
          entry.stripeSessionId === recharge.sessionId,
      )
    ) {
      checkout.reset();
      setRecharge({ ...recharge, status: "credited" });
    }
  }, [wallet, recharge, checkout]);

  useEffect(() => {
    if (recharge?.status !== "pending") return;
    const refresh = () => {
      void refreshAccount().catch((reason: unknown) => {
        if (mounted.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    };
    window.addEventListener("focus", refresh);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void listen<{ status: "success" | "cancel" }>(
        "codingbro-billing",
        (event) => {
          if (event.payload.status === "cancel") {
            checkout.reset();
            setRecharge((previous) =>
              previous ? { ...previous, status: "canceled" } : null,
            );
          } else refresh();
        },
      )
        .then((value) => {
          if (disposed) value();
          else unlisten = value;
        })
        .catch((reason: unknown) => {
          if (!disposed)
            setError(reason instanceof Error ? reason.message : String(reason));
        });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", refresh);
    };
  }, [recharge?.status, refreshAccount, checkout]);

  const run = async (action: () => Promise<void>) => {
    if (operation.current || busy) return;
    operation.current = true;
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : String(reason));
      if (!api.storedTokens()) {
        await refreshAccount().catch(() => undefined);
      }
    } finally {
      operation.current = false;
      if (mounted.current) setWorking(false);
    }
  };

  return (
    <section className="lite-wallet-recharge" aria-label="余额充值">
      <h2>充值美元余额</h2>
      <p>通过 Stripe 安全支付，充值到当前 Coding Bro 账户。</p>
      <fieldset disabled={busy || working}>
        <legend>选择充值金额（USD）</legend>
        {WALLET_RECHARGE_AMOUNTS_CENTS.map((amount) => (
          <label key={amount}>
            <input
              type="radio"
              name="lite-wallet-recharge-amount"
              checked={amountCents === amount}
              onChange={() => setAmountCents(amount)}
            />
            <span>${amount / 100}</span>
          </label>
        ))}
      </fieldset>
      <div className="lite-wallet-recharge__actions">
        <button
          type="button"
          disabled={busy || working}
          onClick={() =>
            void run(async () => {
              const result = await checkout.start(userId, amountCents);
              if (mounted.current)
                setRecharge({
                  sessionId: result.sessionId,
                  amountCents,
                  status: "pending",
                });
            })
          }
        >
          {working ? <LoaderCircle size={15} /> : <ArrowUpRight size={15} />}
          {recharge?.status === "pending" &&
          recharge.amountCents === amountCents
            ? "继续支付"
            : "充值"}{" "}
          ${amountCents / 100}
        </button>
        {recharge?.status === "pending" && (
          <button
            type="button"
            disabled={busy || working}
            onClick={() => void run(refreshAccount)}
          >
            <RefreshCw size={14} /> 查询到账
          </button>
        )}
      </div>
      <p role="status">
        {recharge?.status === "credited"
          ? `充值 $${recharge.amountCents / 100} 已到账，余额已更新。`
          : recharge?.status === "canceled"
            ? "此次支付已取消，可重新选择金额充值。"
            : recharge?.status === "pending"
              ? "支付页面已打开。完成支付后返回并查询到账；到账前余额保持不变。"
              : "支付页面在系统浏览器打开，支付确认后自动入账。"}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
