import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CreditCard,
  FolderOpen,
  LoaderCircle,
  LogOut,
  Play,
  RefreshCw,
  Terminal,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  liteModelCatalog,
  selectAvailableModel,
  supportsLiteCodex,
  validateStripePortalUrl,
  type AvailableModel,
  type ModelCatalog,
  type SessionTokens,
} from "@coding-bro/product-core";
import { api } from "./backend";
import { WalletRecharge } from "./WalletRecharge";
import { version } from "../package.json";

interface User {
  id: string;
  email: string;
  displayName: string;
}
interface Tier {
  id: string;
  name: string;
  priceCents: number;
  blurb?: string;
}
interface Subscription {
  cycle: { publicPlanId: string; endsAt: string };
  entitlement: {
    cycleRemaining?: string;
    cycleUsed?: string;
    cycleGranted?: string;
  };
}
interface WalletState {
  balanceMicroUsd: string;
  availableMicroUsd: string;
  reservedMicroUsd: string;
}
interface CodexStatus {
  installed: boolean;
  canInstall: boolean;
  version?: string;
  executablePath?: string;
}
interface AccountData {
  user: User | null;
  tiers: Tier[];
  subscription: Subscription | null;
  wallet: WalletState | null;
  models: AvailableModel[];
  modelCatalogUnavailable: boolean;
  portal: { available: boolean; reason: string | null } | null;
}
const EMPTY_DATA: AccountData = {
  user: null,
  tiers: [],
  subscription: null,
  wallet: null,
  models: [],
  modelCatalogUnavailable: false,
  portal: null,
};
const DIRECTORY_KEY = "coding-bro-lite-project-v1";
const MODEL_KEY = "coding-bro-lite-model-v1";

function saved(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Work without preferences in restricted WebViews. */
  }
}
export function money(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return "$0.00";
  const micro = BigInt(value);
  const fraction = (micro % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `$${(micro / 1_000_000n).toLocaleString("en-US")}.${fraction}`;
}
function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function App() {
  const [page, setPage] = useState<"project" | "account">("project");
  const [data, setData] = useState<AccountData>(EMPTY_DATA);
  const [modelId, setModelId] = useState<string | null>(() => saved(MODEL_KEY));
  const [directory, setDirectory] = useState<string | null>(() =>
    saved(DIRECTORY_KEY),
  );
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [launchMode, setLaunchMode] = useState("desktop");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const mounted = useRef(true);
  const operation = useRef(false);
  const dataGeneration = useRef(0);
  const native = isTauri();

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const generation = ++dataGeneration.current;
    if (mounted.current && !api.storedTokens()) {
      setData((previous) => ({ ...EMPTY_DATA, tiers: previous.tiers }));
      setModelId(null);
    }
    try {
      const catalog = await api.request<{ tiers: Tier[] }>("/api/plans");
      if (generation !== dataGeneration.current) return;
      if (!api.storedTokens()) {
        setData({ ...EMPTY_DATA, tiers: catalog.tiers });
        setModelId(null);
        return;
      }
      const [user, models, wallet, subscription] = await Promise.all([
        api.request<User>("/api/auth/me").catch((e: unknown) => {
          if (mounted.current && generation === dataGeneration.current) {
            dataGeneration.current++;
            setData((previous) => ({ ...EMPTY_DATA, tiers: previous.tiers }));
            setModelId(null);
          }
          throw e;
        }),
        api
          .request<ModelCatalog>("/api/models")
          .then(liteModelCatalog)
          .catch(() => {
            if (
              mounted.current &&
              generation === dataGeneration.current &&
              api.storedTokens()
            ) {
              setData((previous) => ({
                ...previous,
                models: [],
                modelCatalogUnavailable: true,
              }));
              setModelId(null);
            }
            return null;
          }),
        api.request<WalletState>("/api/wallet"),
        api.request<Subscription>("/api/subscription").catch((e: unknown) => {
          if (
            typeof e === "object" &&
            e !== null &&
            "code" in e &&
            e.code === 3001
          )
            return null;
          throw e;
        }),
      ]);
      const portal = subscription
        ? await api
            .request<{
              available: boolean;
              reason: string | null;
            }>("/api/billing/portal")
            .catch(() => ({
              available: false,
              reason: "订阅管理暂不可用，请刷新重试。",
            }))
        : null;
      if (
        !mounted.current ||
        generation !== dataGeneration.current ||
        !api.storedTokens()
      )
        return;
      setData({
        user,
        tiers: catalog.tiers,
        wallet,
        subscription,
        models: models?.models ?? [],
        modelCatalogUnavailable: models === null,
        portal,
      });
      setModelId((previous) =>
        models ? selectAvailableModel(models, previous ?? "gpt-6.1-sol") : null,
      );
    } finally {
      // Wallet callbacks and startup call refresh without the action wrapper.
      // A revoked session must clear account data through every entry point.
      if (mounted.current && !api.storedTokens()) {
        setData((previous) => ({ ...EMPTY_DATA, tiers: previous.tiers }));
        setModelId(null);
      }
    }
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(reason(e));
      if (!api.storedTokens())
        setData((previous) => ({ ...EMPTY_DATA, tiers: previous.tiers }));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void api
      .loadTokens()
      .then(refresh)
      .catch((e) => {
        if (mounted.current) setError(reason(e));
      })
      .finally(() => {
        if (mounted.current) setReady(true);
      });
    if (isTauri()) {
      void invoke<CodexStatus>("get_codex_status")
        .then(setStatus)
        .catch((e) => setError(reason(e)));
    }
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (modelId) persist(MODEL_KEY, modelId);
  }, [modelId]);
  const selected = data.models.find((model) => model.id === modelId);
  const tier = data.tiers.find(
    (item) => item.id === data.subscription?.cycle.publicPlanId,
  );
  const projectName = directory?.split(/[\\/]/).filter(Boolean).slice(-1)[0];
  const authenticate = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api.request<SessionTokens & { user: User }>(
        `/api/auth/${mode}`,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            ...(mode === "register" ? { displayName } : {}),
          }),
        },
      );
      await api.saveTokens(result);
      setPassword("");
      await refresh();
      setNotice("已登录，共用 Coding Bro 账户。");
    });
  };
  const launch = () =>
    void run(async () => {
      if (!supportsLiteCodex(selected))
        throw new Error("请选择支持 Responses 的 GPT 或兼容模型。");
      await api.request("/api/auth/me");
      const gatewayCredential = await api.ensureGatewayCredential();
      const accessToken = api.storedTokens()?.accessToken;
      if (!accessToken) throw new Error("请先登录。");
      await invoke("launch_codex", {
        directory: directory || "",
        launchMode,
        modelId,
        apiBaseUrl: api.baseUrl,
        accessToken,
        gatewayCredential,
      });
      setNotice(
        launchMode === "desktop"
          ? "Codex 桌面端已启动。"
          : "Codex 已在终端中启动。",
      );
    });
  const external = async (url: string) => {
    if (native) await openUrl(url);
    else {
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      // noopener may return null even after a successful open.
      if (!popup)
        setNotice("已请求打开 Stripe；如浏览器拦截，请允许此页面弹出窗口。");
    }
  };
  const portal = () =>
    void run(async () => {
      const result = await api.request<{ portalUrl: string }>(
        "/api/billing/portal",
        { method: "POST" },
      );
      await external(validateStripePortalUrl(result.portalUrl));
      setNotice("在 Stripe 完成管理后，点击刷新同步账户。");
    });

  return (
    <div className="lite-shell">
      <header className="lite-header">
        <a
          className="lite-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("project");
          }}
          aria-label="Coding Bro Lite 首页"
        >
          <span className="lite-mark">
            <Terminal size={21} strokeWidth={2.4} />
          </span>
          <strong>
            Coding Bro <span>Lite</span>
          </strong>
        </a>
        <nav aria-label="主导航">
          <button
            className={page === "project" ? "is-active" : ""}
            onClick={() => setPage("project")}
          >
            <FolderOpen size={15} /> 项目
          </button>
          <button
            className={page === "account" ? "is-active" : ""}
            onClick={() => setPage("account")}
          >
            <UserRound size={15} /> 账户
          </button>
        </nav>
        <button
          className="lite-icon-button"
          aria-label="刷新账户和 Codex 状态"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const results = await Promise.allSettled([
                refresh(),
                native
                  ? invoke<CodexStatus>("get_codex_status").then(setStatus)
                  : Promise.resolve(),
              ]);
              const failed = results.find(
                (result) => result.status === "rejected",
              );
              if (failed?.status === "rejected") throw failed.reason;
              setNotice("已更新。");
            })
          }
        >
          <RefreshCw size={16} className={busy ? "is-spinning" : ""} />
        </button>
      </header>

      <div className="lite-content">
        {data.modelCatalogUnavailable && (
          <div className="lite-message is-error" role="alert">
            模型目录暂不可用，请刷新重试。
          </div>
        )}
        {error && (
          <div className="lite-message is-error" role="alert">
            {error}
            <button aria-label="关闭错误" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="lite-message" role="status">
            <Check size={15} />
            {notice}
          </div>
        )}
        {!ready && (
          <div className="lite-loading" role="status">
            <LoaderCircle size={20} className="is-spinning" /> 正在同步账户…
          </div>
        )}

        {page === "project" ? (
          <>
            <div className="lite-heading">
              <span className="lite-eyebrow">YOUR WORKSPACE</span>
              <h1>打开项目，开始编码。</h1>
              <p>选择模型和进入方式，开始使用 Codex。</p>
            </div>
            <section className="lite-workspace" aria-label="Codex 项目">
              <div className="lite-workspace-top">
                <span className="lite-agent-icon">
                  <Terminal size={26} />
                </span>
                <div>
                  <h2>Codex</h2>
                  <p>GPT · OpenAI Responses 兼容模型</p>
                </div>
                <span
                  className={`lite-status ${status?.installed ? "is-ready" : ""}`}
                >
                  <i />
                  {native
                    ? status?.installed
                      ? "已安装"
                      : status
                        ? "未安装"
                        : "检测中"
                    : "桌面应用"}
                </span>
              </div>
              <div className="lite-field">
                <label>项目目录</label>
                <button
                  className="lite-project"
                  disabled={!native || busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await open({
                        directory: true,
                        multiple: false,
                        title: "选择 Codex 项目目录",
                      });
                      if (typeof result === "string") {
                        setDirectory(result);
                        persist(DIRECTORY_KEY, result);
                      }
                    })
                  }
                >
                  <FolderOpen size={20} />
                  <span>
                    <strong>{projectName ?? "选择项目文件夹"}</strong>
                    <small>
                      {directory ? "已选择项目文件夹" : "可选，默认使用主目录"}
                    </small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              </div>
              <div className="lite-field">
                <label htmlFor="model">模型</label>
                <div className="lite-select">
                  <select
                    id="model"
                    value={modelId ?? ""}
                    disabled={busy || !data.models.length}
                    onChange={(e) => setModelId(e.target.value)}
                  >
                    <option value="" disabled>
                      {data.user
                        ? "暂无可用的 GPT / Responses 兼容模型"
                        : "登录后选择模型"}
                    </option>
                    {data.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
                <p className="lite-field-note">
                  {selected
                    ? `${selected.id} · ${selected.provider === "openai" ? "GPT" : "Responses 兼容"} · 余额计费`
                    : "模型目录与完整版共用，只显示 Codex 可以使用的模型。"}
                </p>
              </div>
              {!data.user && (
                <button
                  className="lite-signin-hint"
                  onClick={() => setPage("account")}
                >
                  <UserRound size={17} />
                  登录你的 Coding Bro 账户
                  <ArrowUpRight size={15} />
                </button>
              )}
              {native && status && (status.canInstall || !status.installed) && (
                <details className="lite-install">
                  <summary>高级与安装修复</summary>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const directory = await open({
                          directory: true,
                          multiple: false,
                          title: "选择 Codex CLI 或桌面端安装目录",
                        });
                        if (typeof directory === "string") {
                          setStatus(
                            await invoke<CodexStatus>(
                              "select_codex_directory",
                              { directory },
                            ),
                          );
                          setNotice("已选择 Codex 安装目录");
                        }
                      })
                    }
                  >
                    选择 Codex 安装目录
                  </button>
                  <p>支持独立 CLI 和桌面端内置 CLI。</p>
                  {directory && <p>项目目录：{directory}</p>}
                  {status.canInstall ? (
                    <>
                      <strong>
                        {status.installed
                          ? `Codex ${status.version ?? "已安装"}`
                          : "安装 Codex CLI"}
                      </strong>
                      <p>
                        下载官方 Windows 版 0.167.1，无需 Node.js
                        或管理员权限。下载约 200 MB，预留 1 GB
                        空间，请保持应用打开。此操作切换到 Lite
                        固定版本，保留已有全局安装。
                      </p>
                      {status.executablePath && (
                        <p>当前程序：{status.executablePath}</p>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setNotice(
                              "正在下载并校验 Codex，完成后自动刷新安装状态…",
                            );
                            const installed =
                              await invoke<CodexStatus>("install_codex");
                            setStatus(installed);
                            setNotice(
                              `Codex 安装完成：${installed.version ?? ""}`,
                            );
                          })
                        }
                      >
                        {busy
                          ? "请稍候…"
                          : status.installed
                            ? "安装 / 修复 Lite 专用 Codex 0.167.1"
                            : "下载并安装 Codex"}
                      </button>
                    </>
                  ) : (
                    <>
                      <strong>先安装 Codex CLI</strong>
                      <code>npm install -g @openai/codex</code>
                      <p>安装完成后点击右上角刷新。</p>
                    </>
                  )}
                </details>
              )}
              {!native && (
                <p className="lite-field-note">
                  在桌面安装包中选择目录并启动 Codex。
                </p>
              )}
              <div className="lite-field">
                <label htmlFor="launch-mode">进入方式</label>
                <div className="lite-select">
                  <select
                    id="launch-mode"
                    value={launchMode}
                    onChange={(event) => setLaunchMode(event.target.value)}
                    disabled={busy}
                  >
                    <option value="desktop">桌面端进入</option>
                    <option value="cli">CLI 模式进入</option>
                  </select>
                  <ChevronDown size={16} />
                </div>
              </div>
              <button
                className="lite-primary lite-launch"
                disabled={busy || !ready || !native || !data.user || !selected}
                onClick={launch}
              >
                {busy ? (
                  <LoaderCircle size={18} className="is-spinning" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}{" "}
                启动 Codex
              </button>
            </section>
            <div className="lite-overview">
              <div>
                <Wallet size={18} />
                <span>
                  可用余额
                  <strong>
                    {data.user
                      ? money(data.wallet?.availableMicroUsd)
                      : "登录后同步"}
                  </strong>
                </span>
              </div>
              <div>
                <CreditCard size={18} />
                <span>
                  原有订阅
                  <strong>
                    {data.user ? (tier?.name ?? "未订阅") : "登录后同步"}
                  </strong>
                </span>
              </div>
              <button onClick={() => setPage("account")}>
                查看账户
                <ArrowUpRight size={15} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="lite-heading">
              <span className="lite-eyebrow">YOUR ACCOUNT</span>
              <h1>{data.user ? "账户与订阅" : "欢迎回来。"}</h1>
              <p>使用现有 Coding Bro 账户，余额和订阅实时共用。</p>
            </div>
            {data.user ? (
              <>
                <section className="lite-account-identity">
                  <span className="lite-avatar">
                    {data.user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <h2>{data.user.displayName}</h2>
                    <p>{data.user.email}</p>
                  </div>
                  <button
                    className="lite-subtle"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        dataGeneration.current++;
                        const refreshToken = api.storedTokens()?.refreshToken;
                        await api
                          .request("/api/auth/logout", {
                            method: "POST",
                            body: JSON.stringify({ refreshToken }),
                          })
                          .catch(() => undefined);
                        await api.saveTokens(null);
                        setData((previous) => ({
                          ...EMPTY_DATA,
                          tiers: previous.tiers,
                        }));
                        setModelId(null);
                      })
                    }
                  >
                    <LogOut size={15} />
                    退出
                  </button>
                </section>
                <section className="lite-balance">
                  <div>
                    <span className="lite-eyebrow">可用余额 · USD</span>
                    <h2>{money(data.wallet?.availableMicroUsd)}</h2>
                    <p>
                      总余额 {money(data.wallet?.balanceMicroUsd)} · 预留{" "}
                      {money(data.wallet?.reservedMicroUsd)}
                    </p>
                  </div>
                  <Wallet size={31} />
                </section>
                <WalletRecharge
                  userId={data.user.id}
                  wallet={data.wallet}
                  busy={busy}
                  refreshAccount={refresh}
                />
                <section className="lite-subscription">
                  <div className="lite-section-title">
                    <h2>原有订阅</h2>
                    {data.subscription && (
                      <button
                        className="lite-subtle"
                        disabled={busy || !data.portal?.available}
                        onClick={portal}
                      >
                        Stripe 管理
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                  <strong>
                    {tier?.name ??
                      data.subscription?.cycle.publicPlanId ??
                      "未订阅"}
                  </strong>
                  {data.subscription && (
                    <p>
                      本期结束：
                      {new Date(
                        data.subscription.cycle.endsAt,
                      ).toLocaleDateString("zh-CN")}
                    </p>
                  )}
                  <p className="lite-billing-note">
                    GPT 和兼容模型按余额计费。原有套餐额度用于完整版中的 Coding
                    Bro 模型，计费规则保持一致。
                  </p>
                  {data.portal?.reason && (
                    <p className="lite-field-note">{data.portal.reason}</p>
                  )}
                </section>
              </>
            ) : (
              <form className="lite-auth" onSubmit={authenticate}>
                <div className="lite-auth-mode">
                  <button
                    type="button"
                    className={mode === "login" ? "is-active" : ""}
                    onClick={() => setMode("login")}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    className={mode === "register" ? "is-active" : ""}
                    onClick={() => setMode("register")}
                  >
                    创建账户
                  </button>
                </div>
                {mode === "register" && (
                  <label>
                    昵称
                    <input
                      autoComplete="nickname"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  邮箱
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  密码
                  <input
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                    minLength={mode === "register" ? 8 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button className="lite-primary" disabled={busy || !ready}>
                  {busy ? (
                    <LoaderCircle size={17} className="is-spinning" />
                  ) : (
                    <UserRound size={17} />
                  )}
                  {mode === "login" ? "登录" : "创建账户"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
      <footer className="lite-footer">
        <span>Coding Bro Lite</span>
        <span>Codex · GPT / Responses · Stripe</span>
        <span>v{version}</span>
      </footer>
    </div>
  );
}
