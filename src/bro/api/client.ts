import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

export const API_BASE_URL = (
  import.meta.env.VITE_CODING_BRO_API_URL ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:3001"
    : "https://api.example.invalid")
).replace(/\/$/, "");

const TOKEN_STORAGE_KEY = "coding-bro-account-session-v1";
const LEGACY_TOKEN_STORAGE_KEY = TOKEN_STORAGE_KEY;
const nativeSessionStore = new LazyStore("coding_bro_session.json", {
  autoSave: false,
});

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Legacy token-only login payload, kept during Gateway contract rollout. */
  gatewayToken?: string;
  gatewayCredential?: GatewayCredential;
}

export interface GatewayCredential {
  gatewayToken: string;
  inferenceBaseUrl?: string;
  publicModelId?: string;
  profileVersion?: string;
  planVersion?: string;
  expiresAt?: string;
}

interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

export class CodingBroApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CodingBroApiError";
  }
}

let tokens: SessionTokens | null = null;
let loadPromise: Promise<SessionTokens | null> | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function storedTokens(): SessionTokens | null {
  return tokens;
}

export async function loadTokens(): Promise<SessionTokens | null> {
  if (loadPromise) return loadPromise;
  loadPromise = loadPersistedTokens();
  return loadPromise;
}

export async function saveTokens(value: SessionTokens | null): Promise<void> {
  tokens = value;
  loadPromise = Promise.resolve(value);
  if (isTauri()) {
    if (value) await nativeSessionStore.set(TOKEN_STORAGE_KEY, value);
    else await nativeSessionStore.delete(TOKEN_STORAGE_KEY);
    await nativeSessionStore.save();
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    return;
  }
  if (value) sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export async function ensureGatewayCredential(): Promise<GatewayCredential> {
  const existing = storedTokens();
  if (!existing) throw new Error("请先登录 Coding Bro 账户");
  if (
    existing.gatewayCredential &&
    !gatewayCredentialExpired(existing.gatewayCredential)
  ) {
    return existing.gatewayCredential;
  }

  const result = await apiRequest<GatewayCredential>(
    "/api/auth/gateway-credential",
    { method: "POST" },
  );
  if (!validGatewayCredential(result)) {
    throw new Error("Gateway Credential 返回格式无效");
  }
  const latest = storedTokens();
  if (!latest) throw new Error("登录会话已失效，请重新登录");
  await saveTokens({
    ...latest,
    gatewayToken: result.gatewayToken,
    gatewayCredential: result,
  });
  return result;
}

export async function ensureGatewayToken(): Promise<string> {
  return (await ensureGatewayCredential()).gatewayToken;
}

async function loadPersistedTokens(): Promise<SessionTokens | null> {
  if (!isTauri()) {
    tokens = parseTokens(sessionStorage.getItem(TOKEN_STORAGE_KEY));
    return tokens;
  }

  const persisted = await nativeSessionStore.get<unknown>(TOKEN_STORAGE_KEY);
  tokens = validTokens(persisted) ? persisted : null;

  // Versions before the native store kept the session in WebView storage.
  // Migrate it exactly once, then remove the browser-readable copy even when
  // that legacy value is malformed.
  const legacy = parseTokens(localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY));
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  if (!tokens && legacy) {
    tokens = legacy;
    await nativeSessionStore.set(TOKEN_STORAGE_KEY, tokens);
    await nativeSessionStore.save();
  }
  return tokens;
}

function parseTokens(value: string | null): SessionTokens | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return validTokens(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validTokens(value: unknown): value is SessionTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === "string" &&
    record.accessToken.length > 0 &&
    typeof record.refreshToken === "string" &&
    record.refreshToken.length > 0 &&
    (record.gatewayToken === undefined ||
      (typeof record.gatewayToken === "string" &&
        record.gatewayToken.length > 0)) &&
    (record.gatewayCredential === undefined ||
      validGatewayCredential(record.gatewayCredential))
  );
}

function validGatewayCredential(value: unknown): value is GatewayCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.gatewayToken === "string" &&
    record.gatewayToken.length > 0 &&
    optionalString(record.inferenceBaseUrl) &&
    optionalString(record.publicModelId) &&
    optionalString(record.profileVersion) &&
    optionalString(record.planVersion) &&
    optionalString(record.expiresAt)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function gatewayCredentialExpired(credential: GatewayCredential): boolean {
  if (!credential.expiresAt) return false;
  const expiresAt = Date.parse(credential.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  const session = storedTokens();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const envelope = (await response.json().catch(() => ({
    code: 5001,
    msg: `HTTP ${response.status}`,
    data: null,
  }))) as ApiEnvelope<T>;
  if (response.status === 401 && allowRefresh && session?.refreshToken) {
    if (await refreshAccessToken()) return apiRequest(path, init, false);
  }
  if (!response.ok || envelope.code !== 0) {
    throw new CodingBroApiError(envelope.code, envelope.msg, response.status);
  }
  return envelope.data;
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const session = storedTokens();
    if (!session?.refreshToken) return false;
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{
        accessToken: string;
        refreshToken: string;
      }>;
      if (!response.ok || envelope.code !== 0) throw new Error(envelope.msg);
      await saveTokens({
        accessToken: envelope.data.accessToken,
        refreshToken: envelope.data.refreshToken,
        gatewayToken: session.gatewayToken,
        gatewayCredential: session.gatewayCredential,
      });
      return true;
    } catch {
      await saveTokens(null);
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
