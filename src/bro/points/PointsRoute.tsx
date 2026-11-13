import { useCallback, useState } from "react";
import { MOCK_ACCOUNT, usePointLedger } from "./mock";
import { RESET_PRODUCTS, redeemReset, resetOffersForPlan } from "./redeem";
import type { ResetGrant, ResetSku } from "./redeem";
import { PointsPage } from "./PointsPage";
import "./points.css";
import { useCodingBroBackend } from "../api/BackendProvider";

export function PointsRoute() {
  const fallback = usePointLedger();
  const backend = useCodingBroBackend();
  const ledger = backend?.ledger ?? fallback.ledger;
  const setLedger = fallback.setLedger;
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<readonly ResetGrant[]>([]);
  const [seq, setSeq] = useState(0);

  const onRedeem = useCallback(
    (sku: ResetSku) => {
      if (backend) {
        void backend.redeemReset(sku).catch(() => undefined);
        return;
      }
      const offer = resetOffersForPlan(MOCK_ACCOUNT.plan).find(
        (candidate) => candidate.sku === sku,
      );
      const result = redeemReset(
        ledger,
        MOCK_ACCOUNT.plan,
        { id: `reset-${seq}`, sku, at: Date.now() },
        offer,
      );
      if (!result) {
        setError("兑换未完成，积分余额可能已变化，请重试");
        return;
      }
      setLedger(result.ledger);
      setGrants((current) => [...current, result.grant]);
      setSeq((value) => value + 1);
      setError(null);
    },
    [backend, ledger, seq, setLedger],
  );

  if (backend && !backend.current) {
    return (
      <p className="bro-points__error" role="status">
        {backend.user
          ? "订阅 Plan 后即可获得积分并兑换三种 Reset。"
          : "请先登录 Coding Bro 账户。"}
      </p>
    );
  }

  const account = { plan: backend?.current ?? MOCK_ACCOUNT.plan };

  return (
    <>
      {(error || backend?.error) && (
        <p className="bro-points__error" role="alert">
          {backend?.error ?? error}
        </p>
      )}
      <PointsPage
        ledger={ledger}
        account={account}
        onRedeem={onRedeem}
        resetCatalog={backend?.resetCatalog ?? resetOffersForPlan(account.plan)}
      />
      <output className="bro-points__sr-only" aria-live="polite">
        {grants.length
          ? `已获得 ${
              RESET_PRODUCTS.find(
                (product) => product.sku === grants.at(-1)?.sku,
              )?.title ?? "Reset"
            }`
          : ""}
      </output>
    </>
  );
}
