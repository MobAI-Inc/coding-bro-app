import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Fingerprint,
  Layers3,
  Loader2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  Zap,
} from "lucide-react";
import { useCodingBroBackend } from "../api/BackendProvider";
import { copyText } from "@/lib/clipboard";
import { formatWalletUsd } from "../api/wallet";
import "./account.css";

export function AccountRoute() {
  const backend = useCodingBroBackend();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const userId = backend?.user?.id;
  const copyUserId = useRef(userId);
  copyUserId.current = userId;

  useEffect(() => {
    setCopyStatus("");
    if (!userId) return;
    setPassword("");
    setMode("login");
  }, [userId]);

  if (!backend) return null;
  if (!backend.ready) {
    return (
      <main className="bro-account">
        <p role="status">正在恢复账户会话…</p>
      </main>
    );
  }
  if (backend.user) {
    const copyUserIdToClipboard = () => {
      const copiedId = backend.user!.id;
      void copyText(copiedId).then(
        () => {
          if (copyUserId.current === copiedId) setCopyStatus("用户 ID 已复制");
        },
        () => {
          if (copyUserId.current === copiedId)
            setCopyStatus("复制失败，请手动选择用户 ID");
        },
      );
    };
    return (
      <main className="bro-account bro-account--dashboard">
        <header className="bro-account__heading">
          <div>
            <p className="bro-account__eyebrow">
              <span /> YOUR CREATIVE SPACE
            </p>
            <h1>
              为下一次创造，<span>准备就绪。</span>
            </h1>
            <p>你的余额、套餐与每一笔使用记录，尽在掌握。</p>
          </div>
          <span className="bro-account__secure">
            <ShieldCheck size={15} /> 已安全登录
          </span>
        </header>
        <div className="bro-account__identity">
          <div className="bro-account__avatar" aria-hidden="true">
            {backend.user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="bro-account__identity-copy">
            <h2>{backend.user.displayName}</h2>
            <p>{backend.user.email}</p>
          </div>
          <div className="bro-account__user-id">
            <span>
              <Fingerprint size={14} /> 用户 ID
            </span>
            <code>{backend.user.id}</code>
            <button
              type="button"
              aria-label="复制用户 ID"
              onClick={copyUserIdToClipboard}
            >
              <Copy size={15} />
            </button>
            <span role="status">{copyStatus}</span>
          </div>
        </div>
        <div className="bro-account__grid">
          <section className="bro-account__wallet" aria-label="账户余额">
            <div className="bro-account__wallet-top">
              <span>
                <Wallet size={17} /> 账户余额
              </span>
              <span className="bro-account__currency">USD</span>
            </div>
            <div className="bro-account__balance">
              <strong>{formatWalletUsd(backend.wallet.balanceMicroUsd)}</strong>
              <span>账户总额 · 美元</span>
            </div>
            <p className="bro-account__wallet-amounts">
              可用 {formatWalletUsd(backend.wallet.availableMicroUsd)} · 预留{" "}
              {formatWalletUsd(backend.wallet.reservedMicroUsd)}
            </p>
            <div className="bro-account__wallet-bottom">
              <span>
                <Zap size={14} /> 全部已开放模型通用
              </span>
              <button
                type="button"
                disabled={backend.busy}
                onClick={() =>
                  void backend
                    .refresh()
                    .catch(() => setCopyStatus("账户刷新失败，请稍后重试"))
                }
              >
                <RefreshCw
                  size={14}
                  className={backend.busy ? "bro-account__spin" : undefined}
                />{" "}
                刷新账户
              </button>
            </div>
          </section>
          <section className="bro-account__membership">
            <div className="bro-account__card-label">
              <Layers3 size={17} />
              <span>我的套餐</span>
              <span className="bro-account__eyebrow">PLAN</span>
            </div>
            <h2>{backend.current?.toUpperCase() ?? "未订阅"}</h2>
            <p>
              {backend.current
                ? "Coding Bro 模型优先使用套餐额度，让每一份预算更有价值。"
                : "无需订阅，也能通过余额按量使用全部已开放模型。"}
            </p>
            <div className="bro-account__membership-foot">
              <ShieldCheck size={15} />
              <span>
                {backend.current ? "套餐额度与余额独立管理" : "按实际用量结算"}
              </span>
            </div>
            {backend.current && (
              <>
                <button
                  type="button"
                  className="bro-account__secondary"
                  disabled={
                    backend.busy || !backend.billingManagement?.available
                  }
                  onClick={() =>
                    void backend.openBillingPortal().catch(() => undefined)
                  }
                >
                  {backend.billingManagement?.available
                    ? "管理订阅"
                    : "订阅管理暂不可用"}
                  <ArrowUpRight size={15} />
                </button>
                {backend.billingManagement?.reason && (
                  <p className="bro-account__notice" role="status">
                    {backend.billingManagement.reason}
                  </p>
                )}
              </>
            )}
          </section>
          <section className="bro-account__transactions" aria-label="余额明细">
            <div className="bro-account__section-title">
              <div>
                <p className="bro-account__eyebrow">ACTIVITY</p>
                <h2>每一笔，都清楚。</h2>
              </div>
              <span>余额明细 · 最近 {backend.wallet.entries.length} 笔</span>
            </div>
            {backend.wallet.entries.length ? (
              <ul>
                {backend.wallet.entries.map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={`bro-account__entry-icon ${entry.kind === "credit" ? "is-credit" : ""}`}
                    >
                      {entry.kind === "credit" ? (
                        <ArrowDownLeft size={18} />
                      ) : (
                        <ArrowUpRight size={18} />
                      )}
                    </span>
                    <span className="bro-account__entry-copy">
                      {entry.memo}
                      <small>{new Date(entry.at).toLocaleString()}</small>
                    </span>
                    <strong
                      className={
                        entry.kind === "credit" ? "is-credit" : undefined
                      }
                    >
                      {entry.kind === "credit" ? "+" : "−"}
                      {formatWalletUsd(entry.amountMicroUsd)}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="bro-account__empty">
                <span>
                  <Wallet size={25} />
                </span>
                <h3>还没有余额记录</h3>
                <p>充值后的入账与消费记录，会在这里一目了然。</p>
              </div>
            )}
          </section>
          <aside className="bro-account__recharge">
            <p className="bro-account__eyebrow">KEEP CREATING</p>
            <h2>为灵感，续上能量。</h2>
            <p>目前支持管理员人工充值。余额不随套餐到期失效。</p>
            <ol>
              <li>
                <span>01</span>复制你的用户 ID
              </li>
              <li>
                <span>02</span>联系管理员完成充值
              </li>
              <li>
                <span>03</span>刷新账户，查看入账记录
              </li>
            </ol>
            <button
              type="button"
              className="bro-account__secondary"
              onClick={copyUserIdToClipboard}
            >
              复制 ID 用于充值
              <Copy size={14} />
            </button>
          </aside>
        </div>
        <div className="bro-account__billing-note">
          <ShieldCheck size={18} />
          <p>
            Coding Bro
            模型优先使用套餐额度，不足时使用余额；普通模型只使用余额。游戏积分不能作为余额消费。
          </p>
        </div>
        {backend.error && (
          <p className="bro-account__error" role="alert">
            {backend.error}
          </p>
        )}
        <footer className="bro-account__footer">
          <span>
            CODING BRO <span>/</span> MAKE SOMETHING GREAT.
          </span>
          <button
            type="button"
            disabled={backend.busy}
            onClick={() => void backend.logout().catch(() => undefined)}
          >
            <LogOut size={14} />
            退出登录
          </button>
        </footer>
      </main>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const action =
      mode === "login"
        ? backend.login({ email, password })
        : backend.register({ email, displayName, password });
    void action.catch(() => undefined);
  };

  return (
    <main className="bro-account bro-account--auth">
      <div className="bro-account__auth-shell">
        <section className="bro-account__story" aria-label="Coding Bro">
          <div className="bro-account__story-brand">
            <Terminal size={22} />
            <span>CODING BRO</span>
            <span className="bro-account__story-badge">YOUR NEXT CHAPTER</span>
          </div>
          <div className="bro-account__story-copy">
            <p className="bro-account__eyebrow">IDEAS IN. GREAT THINGS OUT.</p>
            <h2>
              把想法，
              <br />
              <span>写成现实。</span>
            </h2>
            <p>
              连接你的 Agent，选好模型。
              <br />
              剩下的，交给创造力。
            </p>
          </div>
          <div className="bro-account__orbit" aria-hidden="true">
            <div className="bro-account__orbit-ring" />
            <div className="bro-account__orbit-ring bro-account__orbit-ring--tilt" />
            <div className="bro-account__orbit-core">
              <Terminal size={48} strokeWidth={1.4} />
            </div>
            <span className="bro-account__orbit-node bro-account__orbit-node--one">
              <Zap size={14} /> BUILD
            </span>
            <span className="bro-account__orbit-node bro-account__orbit-node--two">
              <Sparkles size={14} /> CREATE
            </span>
          </div>
          <div className="bro-account__story-foot">
            <span>
              <Check size={13} /> 套餐优先
            </span>
            <span>
              <Check size={13} /> 余额通用
            </span>
            <span>
              <Check size={13} /> 用量透明
            </span>
          </div>
        </section>
        <form className="bro-account__panel" onSubmit={submit}>
          <div className="bro-account__form-mark">
            <Fingerprint size={26} strokeWidth={1.5} />
          </div>
          <p className="bro-account__eyebrow">
            {mode === "login" ? "WELCOME BACK" : "LET’S GET STARTED"}
          </p>
          <h1>{mode === "login" ? "登录" : "创建账户"}</h1>
          <p className="bro-account__form-intro">
            {mode === "login"
              ? "回到你的创作空间，接着上一次的灵感。"
              : "一个账户，连接你的全部 Coding Bro 体验。"}
          </p>
          <label>
            邮箱
            <input
              required
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {mode === "register" && (
            <label>
              昵称
              <input
                required
                minLength={2}
                maxLength={40}
                autoComplete="nickname"
                placeholder="怎么称呼你？"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          )}
          <label>
            密码
            <input
              required
              type="password"
              minLength={mode === "register" ? 10 : 1}
              maxLength={128}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder={mode === "login" ? "输入你的密码" : "至少 10 个字符"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {backend.error && (
            <p className="bro-account__error" role="alert">
              {backend.error}
            </p>
          )}
          <button
            type="submit"
            className="bro-account__primary"
            disabled={backend.busy}
          >
            {backend.busy ? (
              <>
                <Loader2 size={17} className="bro-account__spin" />
                处理中…
              </>
            ) : (
              <>
                {mode === "login" ? "登录" : "创建并登录"}
                <ArrowRight size={17} />
              </>
            )}
          </button>
          <button
            type="button"
            className="bro-account__switch"
            disabled={backend.busy}
            onClick={() => {
              backend.clearError();
              setPassword("");
              setMode(mode === "login" ? "register" : "login");
            }}
          >
            {mode === "login" ? "没有账户？立即创建" : "已有账户？返回登录"}
          </button>
          <p className="bro-account__form-note">
            <LockKeyhole size={13} />
            余额、Plan 与使用记录，在设备间同步。
          </p>
        </form>
      </div>
    </main>
  );
}
