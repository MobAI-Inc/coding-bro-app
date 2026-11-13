/**
 * Coding Bro Plan 宣传与额度页。
 *
 * Glass / TUI 共用同一份业务判断，只改变表达方式。价格、额度、触顶后果
 * 和结账动作始终来自 props，页面不持有任何计费事实源。
 */

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Cpu,
  Gamepad2,
  Gift,
  Route,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { useDarkMode } from "@/hooks/useDarkMode";
import { formatUsd } from "../money";
import { barChars } from "../tui";
import { allStatuses, currentAction, nextTier, tightestOf } from "./types";
import type {
  OverageAction,
  PlanId,
  PlanTier,
  QuotaStatus,
  QuotaWindow,
  Usage,
} from "./types";
import "./plan.css";

const WINDOW_LABEL: Record<QuotaWindow, string> = {
  session: "5 小时",
  week: "本周",
  month: "本账期",
};

const ACTION_CONSEQUENCE: Record<Exclude<OverageAction, "normal">, string> = {
  downgrade:
    "套餐额度不足时自动使用余额；余额不足则暂停，也可兑换对应窗口 Reset",
  paused:
    "账期额度不足时自动使用余额；余额不足则暂停，也可兑换月 Reset 或等待下个账期",
};

const WINDOW_CONSEQUENCE: Record<QuotaWindow, string> = {
  session:
    "5 小时套餐额度不足时自动使用余额；余额不足则暂停，也可兑换 5 小时 Reset",
  week: "周套餐额度不足时自动使用余额；余额不足则暂停，也可兑换周 Reset",
  month:
    "账期额度不足时自动使用余额；余额不足则暂停，也可兑换月 Reset 或等待下个账期",
};

const ACTION_LABEL: Record<OverageAction, string> = {
  normal: "服务正常",
  downgrade: "套餐窗口额度已用完",
  paused: "账期套餐额度已用完",
};

const LONG_CONTEXT_LABEL: Record<PlanTier["longContext"], string> = {
  no: "不支持",
  limited: "限量",
  yes: "支持",
};

const TIER_MARKETING: Record<
  PlanId,
  { readonly eyebrow: string; readonly promise: string }
> = {
  lite: {
    eyebrow: "START CLEAN",
    promise: "给日常开发一套干脆、够用的默认答案。",
  },
  pro: {
    eyebrow: "BEST BALANCE",
    promise: "复杂任务、长会话和高频迭代的甜蜜点。",
  },
  ultra: {
    eyebrow: "FULL SEND",
    promise: "把最高并发和长上下文全部拉满。",
  },
};

export interface PlanPageProps {
  readonly tiers: readonly PlanTier[];
  readonly current: PlanId | null;
  readonly usage: Usage;
  readonly busy?: boolean;
  readonly onSubscribe?: (plan: PlanId) => void;
}

interface View {
  readonly tiers: readonly PlanTier[];
  readonly tier: PlanTier | null;
  readonly statuses: readonly QuotaStatus[];
  readonly action: OverageAction;
  readonly upgrade: PlanTier | null;
}

export function PlanPage({
  tiers,
  current,
  usage,
  busy = false,
  onSubscribe,
}: PlanPageProps) {
  const isDark = useDarkMode();
  const tier = tiers.find((item) => item.id === current) ?? null;
  const view: View = tier
    ? {
        tiers,
        tier,
        statuses: allStatuses(tier.quota, usage),
        action: currentAction(tier.quota, usage),
        upgrade: upgradeFor(tiers, tier.id),
      }
    : { tiers, tier: null, statuses: [], action: "normal", upgrade: null };

  return isDark ? (
    <TuiPlan view={view} busy={busy} onSubscribe={onSubscribe} />
  ) : (
    <GlassPlan view={view} busy={busy} onSubscribe={onSubscribe} />
  );
}

function upgradeFor(tiers: readonly PlanTier[], id: PlanId): PlanTier | null {
  const next = nextTier(id);
  return next ? (tiers.find((tier) => tier.id === next) ?? null) : null;
}

function focusOf(statuses: readonly QuotaStatus[]): QuotaStatus | null {
  return statuses.length > 0 ? tightestOf(statuses) : null;
}

function consequenceOf(window: QuotaWindow): string {
  return WINDOW_CONSEQUENCE[window];
}

function GlassPlan({
  view,
  busy,
  onSubscribe,
}: {
  view: View;
  busy: boolean;
  onSubscribe?: (plan: PlanId) => void;
}) {
  const focus = focusOf(view.statuses);

  return (
    <div className="bro-plan">
      <section className="bro-plan__hero" aria-labelledby="bro-plan-hero-title">
        <div className="bro-plan__hero-copy">
          <p className="bro-plan__eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            CODING BRO PLANS
          </p>
          <h2 id="bro-plan-hero-title" className="bro-plan__hero-title">
            别再挑模型。
            <span>开始写代码。</span>
          </h2>
          <p className="bro-plan__hero-lead">
            Coding Bro
            自动判断任务强度，把简单问题交给速度，把复杂任务交给能力。
            你只需要选择预算和火力。开通或续费即送同档月 Reset
            等值积分，档位越高，赠送越多。
          </p>
          <div className="bro-plan__hero-actions">
            <a className="bro-plan__hero-cta" href="#bro-plan-pricing">
              选择你的方案
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <span>从 $10 / 月起</span>
          </div>
        </div>

        <aside className="bro-plan__hero-console" aria-label="当前 Plan 状态">
          <div className="bro-plan__console-bar">
            <span>PLAN_INSPECT</span>
            <span className="bro-plan__console-live">LIVE</span>
          </div>
          <p className="bro-plan__console-command">$ codingbro plan --status</p>
          <div className="bro-plan__console-plan">
            <span>{view.tier ? "CURRENT PLAN" : "READY TO START"}</span>
            <strong>{view.tier?.name ?? "PAYG"}</strong>
          </div>
          <p className="bro-plan__console-state" data-action={view.action}>
            {view.tier
              ? `当前状态 · ${ACTION_LABEL[view.action]}`
              : "选择 Plan，解锁订阅额度"}
          </p>
          <div className="bro-plan__console-grid">
            <span>
              <strong>1×</strong>
              MONTHLY RESET GIFT
            </span>
            <span>
              <strong>3</strong>
              RESET WINDOWS
            </span>
          </div>
        </aside>
      </section>

      <section className="bro-plan__proof" aria-label="Plan 核心权益">
        <article>
          <Gift aria-hidden="true" />
          <strong className="bro-tabular">1 : 1</strong>
          <span>开通 / 续费送月 Reset 等值积分</span>
        </article>
        <article>
          <Gamepad2 aria-hidden="true" />
          <strong className="bro-tabular">3</strong>
          <span>种 Reset 窗口</span>
        </article>
        <article>
          <Zap aria-hidden="true" />
          <strong className="bro-tabular">$10</strong>
          <span>月费起步</span>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <strong className="bro-tabular">USD</strong>
          <span>套餐不足时使用余额</span>
        </article>
      </section>

      {view.tier && <GlassUsage view={view} focus={focus} />}

      <section
        id="bro-plan-pricing"
        className="bro-plan__pricing"
        aria-labelledby="bro-plan-pricing-title"
      >
        <header className="bro-plan__section-head">
          <div>
            <p className="bro-plan__eyebrow">CHOOSE YOUR FIREPOWER</p>
            <h2 id="bro-plan-pricing-title">选火力，不选模型。</h2>
          </div>
          <p>
            三档统一由 Coding Bro 路由。价格、额度和触顶规则全部写在台面上。
          </p>
        </header>
        <div className="bro-plan__tiers">
          {view.tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              current={tier.id === view.tier?.id}
              busy={busy}
              onSubscribe={onSubscribe}
            />
          ))}
        </div>
        {view.upgrade && view.action !== "normal" && (
          <p className="bro-plan__upgrade">
            升到 {view.upgrade.name}（{formatUsd(view.upgrade.priceCents)} /
            月） 可提高额度。任一窗口触顶时也可以兑换对应 Reset。
          </p>
        )}
      </section>

      <section
        className="bro-plan__rules"
        aria-labelledby="bro-plan-rules-title"
      >
        <div className="bro-plan__rules-copy">
          <p className="bro-plan__eyebrow">NO BILLING SURPRISES</p>
          <h2 id="bro-plan-rules-title">规则不藏在小字里。</h2>
          <p>
            Coding Bro
            模型优先使用套餐额度，不足时自动按量扣余额。普通模型仅使用余额，不能使用套餐额度。余额可用于全部已开放模型。
          </p>
        </div>
        <div className="bro-plan__rule-list">
          <article>
            <Route aria-hidden="true" />
            <span>5 小时额度触顶</span>
            <strong>自动使用余额；余额不足则暂停</strong>
          </article>
          <article>
            <Route aria-hidden="true" />
            <span>周额度触顶</span>
            <strong>自动使用余额；余额不足则暂停</strong>
          </article>
          <article>
            <Cpu aria-hidden="true" />
            <span>账期硬上限</span>
            <strong>自动使用余额；余额不足则暂停</strong>
          </article>
          <article>
            <Gamepad2 aria-hidden="true" />
            <span>还想继续</span>
            <strong>兑换对应窗口 Reset</strong>
          </article>
        </div>
      </section>
    </div>
  );
}

function GlassUsage({
  view,
  focus,
}: {
  view: View;
  focus: QuotaStatus | null;
}) {
  if (!view.tier) return null;
  return (
    <section className="bro-plan__usage" aria-labelledby="bro-plan-usage-title">
      <header className="bro-plan__usage-head">
        <div>
          <p className="bro-plan__eyebrow">
            <span>当前订阅</span>
            <span aria-hidden="true">· YOUR RUNWAY</span>
          </p>
          <h2 id="bro-plan-usage-title">{view.tier.name} 正在为你工作</h2>
        </div>
        <p className="bro-plan__state" data-action={view.action}>
          {ACTION_LABEL[view.action]}
        </p>
      </header>

      <div className="bro-plan__usage-grid">
        {focus && (
          <section className="bro-plan__focus">
            <p className="bro-plan__label">最先受限</p>
            <p className="bro-plan__focus-line">
              <span className="bro-plan__focus-window">
                {WINDOW_LABEL[focus.window]}
              </span>
              <span className="bro-plan__focus-amount bro-tabular">
                {focus.exhausted
                  ? "已触顶"
                  : `还剩 ${formatUsd(focus.remainingCents)}`}
              </span>
            </p>
            <p className="bro-plan__focus-hint">
              5 小时、周与账期额度同时生效，任一触顶即触发超额策略。
              {consequenceOf(focus.window)}
            </p>
          </section>
        )}
        <div className="bro-plan__meters">
          {view.statuses.map((status) => (
            <Meter
              key={status.window}
              status={status}
              focused={status === focus}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Meter({ status, focused }: { status: QuotaStatus; focused: boolean }) {
  return (
    <div
      className="bro-plan__meter"
      data-focused={focused ? "true" : undefined}
      data-exhausted={status.exhausted ? "true" : undefined}
    >
      <div className="bro-plan__meter-head">
        <span className="bro-plan__meter-name">
          {WINDOW_LABEL[status.window]}
        </span>
        <span className="bro-plan__meter-num bro-tabular">
          {formatUsd(status.usedCents)} / {formatUsd(status.capCents)}
          <span className="bro-plan__meter-pct">（{status.percent}%）</span>
        </span>
      </div>
      <div className="bro-plan__meter-track" aria-hidden="true">
        <div
          className="bro-plan__meter-fill"
          style={{ width: `${status.percent}%` }}
        />
      </div>
      <p className="bro-plan__meter-note">{consequenceOf(status.window)}</p>
    </div>
  );
}

function TierCard({
  tier,
  current,
  busy,
  onSubscribe,
}: {
  tier: PlanTier;
  current: boolean;
  busy: boolean;
  onSubscribe?: (plan: PlanId) => void;
}) {
  const marketing = TIER_MARKETING[tier.id];
  const featured = tier.id === "pro";

  return (
    <article
      className="bro-plan__card"
      data-current={current ? "true" : undefined}
      data-featured={featured ? "true" : undefined}
      aria-current={current ? "true" : undefined}
    >
      <p className="bro-plan__card-eyebrow">{marketing.eyebrow}</p>
      <div className="bro-plan__card-head">
        <h3 className="bro-plan__card-name">{tier.name}</h3>
        {(current || featured) && (
          <span className="bro-plan__badge">{current ? "当前" : "推荐"}</span>
        )}
      </div>
      <p className="bro-plan__card-price bro-tabular">
        {formatUsd(tier.priceCents)}
        <span className="bro-plan__card-per"> / 月</span>
      </p>
      <p className="bro-plan__card-blurb">{tier.blurb}</p>
      <p className="bro-plan__card-promise">{marketing.promise}</p>
      <dl className="bro-plan__specs">
        <TierSpec
          label="5 小时基础"
          value={formatUsd(tier.fiveHourBaseCents)}
        />
        <TierSpec label="周基础" value={formatUsd(tier.weeklyBaseCents)} />
        <TierSpec label="月基础" value={formatUsd(tier.monthlyBaseCents)} />
        <TierSpec
          label="额度加赠"
          value={`${tier.cycleBonusPercent}% Compute Bonus`}
        />
        <TierSpec
          label="开通 / 续费赠分"
          value={`${tier.giftedPointsPerCycle.toLocaleString("zh-CN")} 积分 · 等值 1 次月 Reset`}
        />
        <TierSpec
          label="周期最高权益"
          value={formatUsd(tier.cycleHardCapCents)}
        />
        <TierSpec label="并发" value={`${tier.concurrency}`} />
        <TierSpec
          label="长上下文"
          value={LONG_CONTEXT_LABEL[tier.longContext]}
        />
      </dl>
      {onSubscribe && (
        <button
          type="button"
          className="bro-plan__subscribe"
          disabled={busy || current}
          onClick={() => onSubscribe(tier.id)}
        >
          <span>
            {current ? "当前方案" : busy ? "正在打开…" : `选择 ${tier.name}`}
          </span>
          {current ? (
            <Check size={17} aria-hidden="true" />
          ) : (
            <ArrowUpRight size={17} aria-hidden="true" />
          )}
        </button>
      )}
    </article>
  );
}

function TierSpec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bro-plan__spec">
      <dt className="bro-plan__spec-label">
        <Check size={14} aria-hidden="true" />
        {label}
      </dt>
      <dd className="bro-plan__spec-value bro-tabular">{value}</dd>
    </div>
  );
}

function TuiPlan({
  view,
  busy,
  onSubscribe,
}: {
  view: View;
  busy: boolean;
  onSubscribe?: (plan: PlanId) => void;
}) {
  const focus = focusOf(view.statuses);

  return (
    <div className="tui bro-plan-tui">
      <section
        className="bro-plan-tui__hero"
        aria-labelledby="bro-plan-tui-hero-title"
      >
        <div className="bro-plan-tui__hero-copy">
          <p className="bro-plan-tui__kicker">[ CODING_BRO // PLAN MARKET ]</p>
          <h2 id="bro-plan-tui-hero-title">
            STOP PICKING MODELS.
            <span>START SHIPPING.</span>
          </h2>
          <p className="bro-plan-tui__lead">
            &gt; 让路由判断任务强度。你只选择预算、额度和火力。
            开通或续费即送同档月 Reset 等值积分。
          </p>
          <a className="bro-plan-tui__cta" href="#bro-plan-tui-pricing">
            [ VIEW PLANS <ArrowRight size={16} aria-hidden="true" /> ]
          </a>
        </div>
        <aside className="bro-plan-tui__telemetry" aria-label="当前 Plan 状态">
          <div className="bro-plan-tui__telemetry-head">
            <span>PLAN_INSPECT</span>
            <span className="bro-plan-tui__blink">● LIVE</span>
          </div>
          <div className="bro-plan-tui__telemetry-plan">
            <span>{view.tier ? "CURRENT_PLAN" : "CURRENT_MODE"}</span>
            <strong>{view.tier?.name.toUpperCase() ?? "PAYG"}</strong>
          </div>
          <div className="bro-plan-tui__telemetry-row">
            <span>MONTHLY_RESET_GIFT</span>
            <strong>1:1</strong>
          </div>
          <div className="bro-plan-tui__telemetry-row">
            <span>PLAY_TO_RESET</span>
            <strong>3 TYPES</strong>
          </div>
          <p className="bro-plan-tui__state" data-action={view.action}>
            <span aria-hidden="true">STATUS :: </span>
            <span>
              {view.tier ? ACTION_LABEL[view.action] : "READY_TO_START"}
            </span>
          </p>
        </aside>
      </section>

      <section className="bro-plan-tui__proof" aria-label="Plan 核心权益">
        <span>
          <strong>$10</strong> STARTING_PRICE
        </span>
        <span>
          <strong>1:1</strong> MONTHLY_RESET_GIFT
        </span>
        <span>
          <strong>3</strong> RESET_WINDOWS
        </span>
        <span>
          <strong>USD</strong> BALANCE_FALLBACK
        </span>
      </section>

      {view.tier && <TuiUsage view={view} focus={focus} />}

      <section
        id="bro-plan-tui-pricing"
        className="bro-plan-tui__pricing"
        aria-labelledby="bro-plan-tui-pricing-title"
      >
        <header className="bro-plan-tui__section-head">
          <span>02 // CHOOSE_YOUR_FIREPOWER</span>
          <strong id="bro-plan-tui-pricing-title">
            3 PLANS. 1 SMART ROUTER.
          </strong>
        </header>
        <div className="bro-plan-tui__tiers" aria-label="档位">
          {view.tiers.map((tier) => (
            <TuiTierCard
              key={tier.id}
              tier={tier}
              current={tier.id === view.tier?.id}
              busy={busy}
              onSubscribe={onSubscribe}
            />
          ))}
        </div>
      </section>

      <section className="bro-plan-tui__manifesto">
        <p>
          &gt; BILLING_RULES --explain
          <span>
            {" "}
            Coding Bro
            模型优先使用套餐额度，不足时自动按量扣余额。普通模型仅使用余额，不能使用套餐额度。余额可用于全部已开放模型。
          </span>
        </p>
        <div>
          <span>FIVE_HOUR_LIMIT</span>
          <strong>USE BALANCE / PAUSE IF INSUFFICIENT</strong>
        </div>
        <div>
          <span>WEEK_LIMIT</span>
          <strong>USE BALANCE / PAUSE IF INSUFFICIENT</strong>
        </div>
        <div>
          <span>CYCLE_HARD_CAP</span>
          <strong>USE BALANCE / PAUSE IF INSUFFICIENT</strong>
        </div>
        <div>
          <span>NEED_MORE</span>
          <strong>PLAY / EARN POINTS / RESET</strong>
        </div>
      </section>

      {view.upgrade && view.action !== "normal" && (
        <p className="bro-plan-tui__upgrade">
          &gt; NEXT_MOVE :: 升到 {view.upgrade.name}（
          {formatUsd(view.upgrade.priceCents)}
          /mo）可提高额度。任一窗口触顶时也可以兑换对应 Reset。
        </p>
      )}
    </div>
  );
}

function TuiUsage({ view, focus }: { view: View; focus: QuotaStatus | null }) {
  if (!view.tier) return null;
  return (
    <section className="bro-plan-tui__usage" aria-label="额度状态">
      <header className="bro-plan-tui__section-head">
        <span>
          <span>当前订阅</span>
          <span aria-hidden="true"> // 01 // YOUR_RUNWAY</span>
        </span>
        <strong>{view.tier.name.toUpperCase()} IS RUNNING</strong>
      </header>

      {focus && (
        <section className="bro-plan-tui__focus">
          <div className="bro-plan-tui__line">
            <span>最先受限</span>
            <span className="bro-tabular">
              {WINDOW_LABEL[focus.window]}{" "}
              {focus.exhausted
                ? "已触顶"
                : `还剩 ${formatUsd(focus.remainingCents)}`}
            </span>
          </div>
          <p className="bro-plan-tui__note">{consequenceOf(focus.window)}</p>
        </section>
      )}

      <div className="bro-plan-tui__quota">
        {view.statuses.map((status) => (
          <div
            key={status.window}
            className="bro-plan-tui__row"
            data-focused={status === focus ? "true" : undefined}
          >
            <span className="bro-plan-tui__win">
              {status === focus ? ">" : " "} {WINDOW_LABEL[status.window]}
            </span>
            <span className="bro-plan-tui__bar" aria-hidden="true">
              {barChars(status.usedCents, status.capCents)}
            </span>
            <span className="bro-plan-tui__num bro-tabular">
              {formatUsd(status.usedCents)}/{formatUsd(status.capCents)} (
              {status.percent}%)
            </span>
            <span className="bro-plan-tui__note">
              {consequenceOf(status.window)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TuiTierCard({
  tier,
  current,
  busy,
  onSubscribe,
}: {
  tier: PlanTier;
  current: boolean;
  busy: boolean;
  onSubscribe?: (plan: PlanId) => void;
}) {
  const marketing = TIER_MARKETING[tier.id];
  const featured = tier.id === "pro";

  return (
    <article
      className="bro-plan-tui__tier"
      data-current={current ? "true" : undefined}
      data-featured={featured ? "true" : undefined}
      aria-current={current ? "true" : undefined}
    >
      <div className="bro-plan-tui__tier-topline">
        <span>{marketing.eyebrow}</span>
        <span>{current ? "* CURRENT" : featured ? "+ RECOMMENDED" : ""}</span>
      </div>
      <div className="bro-plan-tui__tier-head">
        <h3>{tier.name.toUpperCase()}</h3>
        <p className="bro-tabular">
          {formatUsd(tier.priceCents)}
          <span>/MO</span>
        </p>
      </div>
      <p className="bro-plan-tui__tier-blurb">{tier.blurb}</p>
      <p className="bro-plan-tui__tier-promise">{marketing.promise}</p>
      <dl className="bro-plan-tui__tier-specs">
        <TierSpec
          label="5 小时基础"
          value={formatUsd(tier.fiveHourBaseCents)}
        />
        <TierSpec label="周基础" value={formatUsd(tier.weeklyBaseCents)} />
        <TierSpec label="月基础" value={formatUsd(tier.monthlyBaseCents)} />
        <TierSpec
          label="额度加赠"
          value={`${tier.cycleBonusPercent}% Compute Bonus`}
        />
        <TierSpec
          label="开通 / 续费赠分"
          value={`${tier.giftedPointsPerCycle.toLocaleString("zh-CN")} 积分 · 等值 1 次月 Reset`}
        />
        <TierSpec
          label="周期最高权益"
          value={formatUsd(tier.cycleHardCapCents)}
        />
        <TierSpec label="并发" value={`${tier.concurrency}`} />
        <TierSpec
          label="长上下文"
          value={LONG_CONTEXT_LABEL[tier.longContext]}
        />
      </dl>
      {onSubscribe && (
        <button
          type="button"
          disabled={busy || current}
          onClick={() => onSubscribe(tier.id)}
        >
          {current
            ? "[ CURRENT PLAN ]"
            : busy
              ? "[ OPENING... ]"
              : `[ START ${tier.name.toUpperCase()} → ]`}
        </button>
      )}
    </article>
  );
}

export {
  WINDOW_LABEL,
  ACTION_CONSEQUENCE,
  ACTION_LABEL,
  LONG_CONTEXT_LABEL,
  consequenceOf,
};
