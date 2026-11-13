/**
 * Plan 页的数据接线。
 *
 * 页面本身（PlanPage）只认 props；生产树由 BackendProvider 注入真实计划、
 * 用量和后端支付结账结果，单测不挂
 * Provider 时才使用隔离的 mock fixture。
 */

import { usePlan } from "./mock";
import { useCodingBroBackend } from "../api/BackendProvider";
import { PlanPage } from "./PlanPage";
import "./plan.css";

export function PlanRoute() {
  const fallback = usePlan();
  const backend = useCodingBroBackend();
  const state = backend ?? fallback;
  return (
    <>
      {backend?.error && (
        <p className="bro-plan__api-error" role="alert">
          {backend.error}
        </p>
      )}
      {backend?.current && backend.billingManagement?.reason && (
        <p className="bro-plan__api-error" role="status">
          {backend.billingManagement.reason}
        </p>
      )}
      <PlanPage
        tiers={state.tiers}
        current={state.current}
        usage={state.usage}
        busy={backend?.busy}
        onSubscribe={
          backend && (!backend.current || backend.billingManagement?.available)
            ? (plan) =>
                void (
                  backend.current
                    ? backend.openBillingPortal()
                    : backend.subscribe(plan)
                ).catch(() => undefined)
            : undefined
        }
      />
    </>
  );
}
