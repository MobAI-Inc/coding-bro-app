import { useMemo, useState } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { balanceOf, signedAmount } from "./types";
import type { LedgerEntry, LedgerKind } from "./types";
import { RESET_PRODUCTS } from "./redeem";
import type { PlanId, ResetOffer, ResetSku } from "./redeem";
import "./points.css";

const KIND_LABEL: Record<LedgerKind, string> = {
  cycle_gift: "账期赠送",
  earn_usage: "用量产出",
  spend_entry: "游戏入场",
  refund_entry: "入场退回",
  award_result: "游戏奖励",
  redeem_reset: "Reset 兑换",
};

export interface PointsAccount {
  readonly plan: PlanId;
}

export interface PointsPageProps {
  readonly ledger: readonly LedgerEntry[];
  readonly account: PointsAccount;
  readonly onRedeem: (sku: ResetSku) => void;
  readonly resetCatalog: readonly ResetOffer[];
}

export function PointsPage({
  ledger,
  account,
  onRedeem,
  resetCatalog,
}: PointsPageProps) {
  const isDark = useDarkMode();
  const balance = useMemo(() => balanceOf(ledger), [ledger]);
  const entries = useMemo(
    () => [...ledger].sort((a, b) => b.at - a.at),
    [ledger],
  );
  const [selected, setSelected] = useState<ResetSku | null>(null);
  const selectedProduct = RESET_PRODUCTS.find((item) => item.sku === selected);
  const selectedOffer = resetCatalog.find((item) => item.sku === selected);
  const selectedPrice = selectedOffer?.pricePoints ?? 0;

  const confirm = () => {
    if (!selected) return;
    onRedeem(selected);
    setSelected(null);
  };

  return (
    <main className={isDark ? "bro-points bro-points--tui tui" : "bro-points"}>
      <header className="bro-points__hero">
        <div>
          <p className="bro-points__eyebrow">
            {isDark ? "> wallet.status" : "POINTS WALLET"}
          </p>
          <h1>Reset 商店</h1>
          <p className="bro-points__intro">
            开通或续费即赠同档月 Reset 等值积分，刚好可兑换一次月 Reset。Plan
            越高，赠送积分和 Reset 权益越高；积分余额不设总上限。
          </p>
        </div>
        <div
          className="bro-points__balance-card"
          aria-label={`可用积分 ${balance}`}
        >
          <span>{isDark ? "AVAILABLE_POINTS" : "可用积分"}</span>
          <strong className="bro-tabular">
            {balance.toLocaleString("zh-CN")}
          </strong>
          <small>{isDark ? "NO BALANCE CAP" : "余额不设总上限"}</small>
        </div>
      </header>

      <section className="bro-points__shop" aria-labelledby="reset-shop-title">
        <div className="bro-points__section-head">
          <div>
            <p>{isDark ? "> catalog.list --plan" : "RESET CATALOG"}</p>
            <h2 id="reset-shop-title">选择 Reset 窗口</h2>
          </div>
          <span className="bro-points__plan">
            {account.plan.toUpperCase()} PLAN
          </span>
        </div>

        <div className="bro-points__products">
          {RESET_PRODUCTS.map((product, index) => {
            const offer = resetCatalog.find(
              (candidate) => candidate.sku === product.sku,
            );
            const price = offer?.pricePoints ?? 0;
            const resetLimitReached =
              offer?.maxRedemptions != null &&
              offer.redeemedCount >= offer.maxRedemptions;
            const affordable =
              Boolean(offer?.redeemable) &&
              !resetLimitReached &&
              balance >= price;
            const disabledLabel = resetLimitReached
              ? "本周期已达上限"
              : offer?.unavailableReason
                ? offer.unavailableReason
                : balance < price
                  ? "积分不足"
                  : "暂不可兑换";
            return (
              <article className="bro-reset-card" key={product.sku}>
                <div className="bro-reset-card__top">
                  <span className="bro-reset-card__index">0{index + 1}</span>
                  <span className="bro-reset-card__scope">
                    {product.shortTitle}
                  </span>
                </div>
                <h3>{product.title}</h3>
                <p>{product.description}</p>
                <div className="bro-reset-card__price">
                  <strong className="bro-tabular">
                    {price.toLocaleString("zh-CN")}
                  </strong>
                  <span>积分</span>
                </div>
                {offer?.maxRedemptions != null && (
                  <p className="bro-reset-card__limit">
                    本周期已兑换 {offer.redeemedCount}/{offer.maxRedemptions} 次
                  </p>
                )}
                <button
                  type="button"
                  disabled={!affordable}
                  onClick={() => setSelected(product.sku)}
                  aria-label={`兑换 ${product.title}，需要 ${price} 积分`}
                >
                  {isDark
                    ? affordable
                      ? "[ SELECT ]"
                      : resetLimitReached
                        ? "[ CYCLE LIMIT ]"
                        : balance < price
                          ? "[ INSUFFICIENT ]"
                          : "[ UNAVAILABLE ]"
                    : affordable
                      ? "选择兑换"
                      : disabledLabel}
                </button>
              </article>
            );
          })}
        </div>
        <p className="bro-points__source-note">
          买多少，送多少：每次开通或续费，都赠送同档一次月 Reset
          等值积分。积分余额可以持续累积；Reset 仍按各自窗口限制兑换。
        </p>
      </section>

      {selected && selectedProduct && (
        <section
          className="bro-points__confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
        >
          <div>
            <p>{isDark ? "> reset.confirm" : "确认兑换"}</p>
            <h2 id="reset-confirm-title">{selectedProduct.title}</h2>
            <span>
              将消耗{" "}
              <strong className="bro-tabular">
                {selectedPrice.toLocaleString("zh-CN")}
              </strong>{" "}
              积分。{selectedProduct.description}。
            </span>
          </div>
          <div className="bro-points__confirm-actions">
            <button
              type="button"
              className="bro-points__cancel"
              onClick={() => setSelected(null)}
            >
              {isDark ? "[ CANCEL ]" : "取消"}
            </button>
            <button
              type="button"
              className="bro-points__commit"
              onClick={confirm}
            >
              {isDark ? "[ CONFIRM ]" : "确认兑换"}
            </button>
          </div>
        </section>
      )}

      <section
        className="bro-points__ledger"
        aria-labelledby="points-ledger-title"
      >
        <div className="bro-points__section-head">
          <div>
            <p>{isDark ? "> ledger.tail" : "ACTIVITY"}</p>
            <h2 id="points-ledger-title">积分流水</h2>
          </div>
        </div>
        <ul>
          {entries.map((entry) => {
            const value = signedAmount(entry);
            return (
              <li key={entry.id}>
                <span className="bro-points__kind">
                  {KIND_LABEL[entry.kind]}
                </span>
                <span className="bro-points__memo">{entry.memo}</span>
                <time className="bro-tabular">{formatAt(entry.at)}</time>
                <strong
                  className="bro-tabular"
                  data-sign={value >= 0 ? "plus" : "minus"}
                >
                  {value >= 0 ? `+${value}` : value}
                </strong>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function formatAt(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export { KIND_LABEL, formatAt };
