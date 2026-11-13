import {
  ArrowRight,
  Boxes,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  Coins,
  Gamepad2,
  Gauge,
  FolderOpen,
  KeyRound,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  WalletCards,
} from "lucide-react";
import * as Select from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { ClaudeIcon, CodexIcon, GeminiIcon } from "@/components/BrandIcons";
import { ProviderIcon } from "@/components/ProviderIcon";
import { usePointLedger } from "../points/mock";
import { balanceOf } from "../points/types";
import { RESET_PRODUCTS, resetOffersForPlan } from "../points/redeem";
import { usePlan } from "../plan/mock";
import { allStatuses, tightestOf } from "../plan/types";
import { formatUsd } from "../money";
import { CodingBroBrand } from "../brand/CodingBroBrand";
import { useCodingBroBackend } from "../api/BackendProvider";
import { formatWalletUsd } from "../api/wallet";
import "./home.css";

export type LauncherAgent =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "pi"
  | "hermes";
export type HomeDestination =
  | "account"
  | "plan"
  | "points"
  | "games"
  | "providers";

export interface CodingBroHomeProps {
  readonly launchingAgent?: LauncherAgent | null;
  readonly launchDirectory?: string | null;
  readonly onLaunchAgent: (agent: LauncherAgent) => void;
  readonly onChooseLaunchDirectory: () => void;
  readonly onNavigate: (destination: HomeDestination) => void;
}

const AGENTS: readonly {
  id: LauncherAgent;
  name: string;
  command: string;
  detail: string;
  icon: ReactNode;
}[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    detail: "长程编码与复杂任务",
    icon: <ClaudeIcon size={25} />,
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    detail: "快速实现与工程协作",
    icon: <CodexIcon size={25} />,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    detail: "大上下文分析与搜索",
    icon: <GeminiIcon size={25} />,
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    detail: "开放式多模型工作流",
    icon: (
      <ProviderIcon
        icon="opencode"
        name="OpenCode"
        size={25}
        showFallback={false}
      />
    ),
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    detail: "轻量可扩展 Agent 工作流",
    icon: <ProviderIcon icon="pi" name="Pi" size={25} showFallback={false} />,
  },
  {
    id: "hermes",
    name: "Hermes",
    command: "hermes",
    detail: "研究与自主任务执行",
    icon: (
      <ProviderIcon
        icon="hermes"
        name="Hermes"
        size={25}
        showFallback={false}
      />
    ),
  },
];

export function CodingBroHome({
  launchingAgent = null,
  launchDirectory = null,
  onLaunchAgent,
  onChooseLaunchDirectory,
  onNavigate,
}: CodingBroHomeProps) {
  const fallbackPlan = usePlan();
  const fallbackPoints = usePointLedger();
  const backend = useCodingBroBackend();
  const { tiers, current, usage } = backend ?? fallbackPlan;
  const ledger = backend?.ledger ?? fallbackPoints.ledger;
  const points = balanceOf(ledger);
  const tier = tiers.find((item) => item.id === current) ?? null;
  const resetCatalog = current
    ? (backend?.resetCatalog ?? resetOffersForPlan(current))
    : [];
  const monthlyResetPricePoints =
    resetCatalog.find((offer) => offer.sku === "reset_month")?.pricePoints ?? 0;
  const statuses = tier ? allStatuses(tier.quota, usage) : [];
  const tightest = statuses.length ? tightestOf(statuses) : null;
  const selectedModel = backend?.models.find(
    (model) => model.id === backend.selectedModelId,
  );
  const busy = launchingAgent !== null;
  const launchDirectoryParts = launchDirectory?.split(/[\\/]/).filter(Boolean);
  const launchDirectoryName = launchDirectoryParts?.length
    ? launchDirectoryParts[launchDirectoryParts.length - 1]
    : null;

  return (
    <main className="bro-home">
      <section className="bro-home__status" aria-label="Plan 与 Reset 状态">
        <div className="bro-home__identity">
          <CodingBroBrand active />
          <p>选一个 Agent，开始工作；它运行时，你来玩一局。</p>
        </div>

        <button
          className="bro-home__plan"
          type="button"
          onClick={() => onNavigate("plan")}
        >
          <span className="bro-home__status-icon" aria-hidden="true">
            <Gauge size={20} />
          </span>
          <span>
            <small>当前 PLAN</small>
            <strong>{tier?.name ?? "未订阅"}</strong>
            <em>
              {tightest
                ? `${formatUsd(tightest.remainingCents)} 可用 · ${tightest.percent}% 已使用`
                : backend?.user
                  ? "选择一个 Plan 开始使用"
                  : "登录后同步 Plan 与额度"}
            </em>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>

        <button
          className="bro-home__reset"
          type="button"
          onClick={() => onNavigate("points")}
        >
          <span className="bro-home__status-icon" aria-hidden="true">
            <RotateCcw size={20} />
          </span>
          <span>
            <small>RESET 商店</small>
            <strong>{points.toLocaleString("zh-CN")} 积分</strong>
            <em>
              {current
                ? `月 Reset ${monthlyResetPricePoints.toLocaleString("zh-CN")} 积分 · 开通赠送同额`
                : "订阅 Plan 后可兑换"}
            </em>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </section>

      <section
        className="bro-home__launcher"
        aria-labelledby="agent-launcher-title"
      >
        <header className="bro-home__section-head">
          <div>
            <span>
              <TerminalSquare size={15} aria-hidden="true" /> AGENT LAUNCHER
            </span>
            <h1 id="agent-launcher-title">一键开始 Coding</h1>
            <p>
              先选择项目目录和模型，再选择 Agent。Coding Bro
              仅对此终端生效，不会 改写你的官方或 OpenRouter 默认配置。
            </p>
          </div>
          <div className="bro-home__section-actions">
            <button type="button" onClick={() => onNavigate("games")}>
              <Gamepad2 size={17} aria-hidden="true" /> 直接去游戏
            </button>
          </div>
        </header>

        <button
          id="launcher-project-status"
          className={`bro-home__project-picker ${launchDirectory ? "is-ready" : ""}`}
          type="button"
          disabled={busy}
          onClick={onChooseLaunchDirectory}
          title={launchDirectory ?? "选择 Agent 要进入的项目目录"}
        >
          <span className="bro-home__project-icon" aria-hidden="true">
            <FolderOpen size={22} />
          </span>
          <span className="bro-home__project-copy">
            <small>STEP 1 · PROJECT DIRECTORY</small>
            <strong>{launchDirectoryName ?? "先选择项目目录"}</strong>
            <code>
              {launchDirectory ?? "Agent 会在这个目录中读取代码并开始工作"}
            </code>
          </span>
          <span className="bro-home__project-action">
            {launchDirectory ? "更换目录" : "选择目录"}
          </span>
        </button>

        {backend && (
          <section className="bro-home__model-picker" aria-label="模型与计费">
            <div className="bro-home__model-main">
              <div className="bro-home__model-head">
                <label id="launcher-model-label" htmlFor="launcher-model">
                  STEP 2 · 选择模型
                </label>
                <span>由后端同步可用模型</span>
              </div>
              <Select.Root
                value={backend.selectedModelId ?? ""}
                disabled={busy || !backend.models.length}
                onValueChange={backend.selectModel}
              >
                <Select.Trigger
                  id="launcher-model"
                  aria-labelledby="launcher-model-label"
                  className="bro-model-trigger"
                >
                  <span className="bro-model-trigger__icon">
                    <Sparkles size={21} />
                  </span>
                  <span className="bro-model-trigger__copy">
                    <Select.Value
                      placeholder={
                        !backend.user ? "登录后查看可用模型" : "暂无可用模型"
                      }
                    />
                    <small>
                      {selectedModel?.billingSource ===
                      "subscription_then_balance"
                        ? "套餐优先 · 余额接续"
                        : "余额按量计费"}
                    </small>
                  </span>
                  <Select.Icon>
                    <ChevronDown size={16} />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content
                    className="bro-model-menu"
                    position="popper"
                    sideOffset={8}
                    collisionPadding={16}
                  >
                    <Select.ScrollUpButton className="bro-model-menu__scroll">
                      <ChevronUp size={16} />
                    </Select.ScrollUpButton>
                    <Select.Viewport>
                      {(["coding-bro", "openai", "anthropic"] as const).map(
                        (provider) => {
                          const models = backend.models.filter(
                            (model) => model.provider === provider,
                          );
                          return models.length ? (
                            <Select.Group key={provider}>
                              <Select.Label className="bro-model-menu__label">
                                {provider === "coding-bro"
                                  ? "CODING BRO"
                                  : provider === "openai"
                                    ? "GPT"
                                    : "CLAUDE"}
                              </Select.Label>
                              {models.map((model) => (
                                <Select.Item
                                  className="bro-model-menu__item"
                                  key={model.id}
                                  value={model.id}
                                >
                                  <Select.ItemText>
                                    {model.name}
                                  </Select.ItemText>
                                  <span className="bro-model-menu__billing">
                                    {model.billingSource ===
                                    "subscription_then_balance"
                                      ? "套餐优先"
                                      : "余额"}
                                  </span>
                                  <Select.ItemIndicator>
                                    <Check size={15} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Group>
                          ) : null;
                        },
                      )}
                    </Select.Viewport>
                    <Select.ScrollDownButton className="bro-model-menu__scroll">
                      <ChevronDown size={16} />
                    </Select.ScrollDownButton>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
              <p className="bro-home__model-note">
                套餐仅用于 Coding Bro 模型；其他模型使用余额。
              </p>
            </div>
            <div className="bro-home__model-pricing">
              <div>
                <span>余额单价</span>
                <small>每百万 token</small>
              </div>
              {selectedModel?.walletPricing ? (
                <>
                  <dl>
                    <div>
                      <dt>输入</dt>
                      <dd>
                        {formatWalletUsd(
                          selectedModel.walletPricing
                            .inputMicroUsdPerMillionTokens,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>输出</dt>
                      <dd>
                        {formatWalletUsd(
                          selectedModel.walletPricing
                            .outputMicroUsdPerMillionTokens,
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p>
                    长上下文{" "}
                    {formatWalletUsd(
                      selectedModel.walletPricing
                        .longInputMicroUsdPerMillionTokens,
                    )}{" "}
                    输入 /{" "}
                    {formatWalletUsd(
                      selectedModel.walletPricing
                        .longOutputMicroUsdPerMillionTokens,
                    )}{" "}
                    输出
                  </p>
                </>
              ) : (
                <p className="bro-home__pricing-empty">
                  {backend.user ? "选择模型后查看价格" : "登录后查看模型与价格"}
                </p>
              )}
            </div>
            <button
              type="button"
              className="bro-home__wallet-link"
              onClick={() => onNavigate("account")}
            >
              <WalletCards size={17} />
              <span>
                <small>可用余额</small>
                <strong>
                  {formatWalletUsd(backend.wallet?.availableMicroUsd ?? "0")}
                </strong>
              </span>
              <span>
                查看账户
                <ArrowRight size={14} />
              </span>
            </button>
          </section>
        )}

        <div className="bro-home__agent-step">
          <span>{backend ? "STEP 3" : "STEP 2"} · CHOOSE AGENT</span>
          <small>
            {launchDirectory
              ? "准备就绪，点击一个 Agent 启动"
              : "选择项目目录后即可启动"}
          </small>
        </div>

        <div className="bro-home__agents">
          {AGENTS.map((agent) => {
            const launching = launchingAgent === agent.id;
            return (
              <button
                key={agent.id}
                className="bro-agent-card"
                data-agent={agent.id}
                type="button"
                disabled={
                  busy ||
                  !launchDirectory ||
                  Boolean(backend?.user && !backend.selectedModelId)
                }
                aria-describedby="launcher-project-status"
                onClick={() => {
                  if (backend && !backend.user) {
                    onNavigate("account");
                    return;
                  }
                  onLaunchAgent(agent.id);
                }}
                aria-label={`启动 ${agent.name}`}
              >
                <span className="bro-agent-card__icon" aria-hidden="true">
                  {launching ? <Loader2 size={25} /> : agent.icon}
                </span>
                <span className="bro-agent-card__copy">
                  <strong>{agent.name}</strong>
                  <small>{agent.detail}</small>
                  <code>{agent.command}</code>
                </span>
                <span className="bro-agent-card__launch" aria-hidden="true">
                  {launching ? <Loader2 size={18} /> : <Play size={18} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="bro-home__commerce" aria-label="计费方式">
        <div className="bro-home__payg">
          <span className="bro-home__commerce-icon" aria-hidden="true">
            <Boxes size={23} />
          </span>
          <div>
            <small>所有模型 · PAYG</small>
            <h2>不用换供应商，按量使用完整模型池</h2>
            <p>
              Claude、GPT、Gemini、DeepSeek、Qwen、Kimi
              等模型统一按实际用量结算。
            </p>
          </div>
          <button type="button" onClick={() => onNavigate("plan")}>
            查看计费
          </button>
        </div>

        <div className="bro-home__reset-menu" aria-label="Reset 价格预览">
          <span>
            <Coins size={16} aria-hidden="true" /> Reset 价格
          </span>
          {RESET_PRODUCTS.map((product) => (
            <button
              type="button"
              key={product.sku}
              onClick={() => onNavigate("points")}
            >
              <span>{product.shortTitle}</span>
              <strong>
                {current
                  ? (resetCatalog
                      .find((offer) => offer.sku === product.sku)
                      ?.pricePoints.toLocaleString("zh-CN") ?? "—")
                  : "—"}
              </strong>
            </button>
          ))}
        </div>
      </section>

      <section className="bro-home__byok" aria-label="自带密钥">
        <span className="bro-home__byok-icon" aria-hidden="true">
          <KeyRound size={18} />
        </span>
        <span>
          <small>高级选项</small>
          <strong>已有 API Key？继续使用 BYOK</strong>
        </span>
        <button type="button" onClick={() => onNavigate("providers")}>
          管理 BYOK <ArrowRight size={15} aria-hidden="true" />
        </button>
      </section>

      <footer className="bro-home__foot">
        <span>
          <WalletCards size={14} aria-hidden="true" /> Plan 优先
        </span>
        <span>
          <Sparkles size={14} aria-hidden="true" /> PAYG 随时可用
        </span>
        <span>
          <KeyRound size={14} aria-hidden="true" /> BYOK 完整保留
        </span>
      </footer>
    </main>
  );
}
