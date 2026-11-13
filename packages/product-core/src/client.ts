import type { GatewayCredential, SessionTokens } from "./types";

export interface TokenStore {
  load(): Promise<unknown>;
  save(value: SessionTokens | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  /** Injectable for testing or runtimes with their own fetch implementation. */
  fetch?: typeof globalThis.fetch;
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

export { CodingBroApiError as ApiError };

interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || nonemptyString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validGatewayCredential(
  value: unknown,
): value is GatewayCredential {
  return (
    isRecord(value) &&
    nonemptyString(value.gatewayToken) &&
    optionalString(value.inferenceBaseUrl) &&
    optionalString(value.publicModelId) &&
    optionalString(value.profileVersion) &&
    optionalString(value.planVersion) &&
    optionalString(value.expiresAt)
  );
}

export function validSessionTokens(value: unknown): value is SessionTokens {
  return (
    isRecord(value) &&
    nonemptyString(value.accessToken) &&
    nonemptyString(value.refreshToken) &&
    optionalString(value.gatewayToken) &&
    (value.gatewayCredential === undefined ||
      validGatewayCredential(value.gatewayCredential))
  );
}

function copyTokens(value: SessionTokens | null): SessionTokens | null {
  if (!value) return null;
  return {
    ...value,
    ...(value.gatewayCredential
      ? { gatewayCredential: { ...value.gatewayCredential } }
      : {}),
  };
}

function expired(credential: GatewayCredential): boolean {
  if (!credential.expiresAt) return false;
  const at = Date.parse(credential.expiresAt);
  return !Number.isFinite(at) || at <= Date.now() + 30_000;
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("API 服务地址无效");
  }
  return url.href.replace(/\/+$/, "");
}

/**
 * All state belongs to this factory instance. The host supplies storage so the
 * full application and Lite never share a browser key or native session file.
 */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizedBaseUrl(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  let tokens: SessionTokens | null = null;
  let loadPromise: Promise<SessionTokens | null> | undefined;
  let saveQueue = Promise.resolve();
  let stateRevision = 0;
  // Public login/logout changes invalidate outstanding refresh and credential
  // requests. Internal token rotation stays within the same login session.
  let sessionGeneration = 0;
  let refreshPromise:
    | { generation: number; promise: Promise<boolean> }
    | undefined;
  let credentialPromise:
    | { generation: number; promise: Promise<GatewayCredential> }
    | undefined;

  function storedTokens(): SessionTokens | null {
    return copyTokens(tokens);
  }

  function loadTokens(): Promise<SessionTokens | null> {
    if (!loadPromise) {
      const revision = stateRevision;
      const operation = (async () => {
        const stored = await options.tokenStore.load();
        if (revision === stateRevision) {
          tokens = validSessionTokens(stored) ? copyTokens(stored) : null;
        }
        return storedTokens();
      })();
      loadPromise = operation;
      void operation.catch(() => {
        if (loadPromise === operation) loadPromise = undefined;
      });
    }
    return loadPromise.then(copyTokens);
  }

  function persistTokens(
    value: SessionTokens | null,
    newSession: boolean,
  ): Promise<void> {
    if (value !== null && !validSessionTokens(value)) {
      return Promise.reject(new Error("账户会话格式无效"));
    }
    if (newSession) sessionGeneration += 1;
    stateRevision += 1;
    tokens = copyTokens(value);
    loadPromise = Promise.resolve(storedTokens());
    const snapshot = copyTokens(value);
    // Serialize writes so an older login/refresh cannot overwrite a later
    // logout in an asynchronous native or browser store.
    const operation = saveQueue
      .catch(() => undefined)
      .then(() => options.tokenStore.save(snapshot));
    saveQueue = operation;
    return operation;
  }

  function saveTokens(value: SessionTokens | null): Promise<void> {
    return persistTokens(value, true);
  }

  function requestHeaders(
    init: RequestInit,
    session: SessionTokens | null,
  ): Headers {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);
    return headers;
  }

  async function envelope<T>(response: Response): Promise<ApiEnvelope<T>> {
    const value: unknown = await response.json().catch(() => undefined);
    if (!isRecord(value) || typeof value.code !== "number") {
      throw new CodingBroApiError(
        5001,
        `HTTP ${response.status}: API 返回格式无效`,
        response.status,
      );
    }
    return {
      code: value.code,
      msg:
        typeof value.msg === "string" ? value.msg : `HTTP ${response.status}`,
      data: value.data as T,
    };
  }

  async function refreshAccessToken(
    generation: number,
    session: SessionTokens,
  ): Promise<boolean> {
    if (generation !== sessionGeneration || !tokens) return false;
    if (tokens.accessToken !== session.accessToken) return true;
    if (refreshPromise?.generation === generation)
      return refreshPromise.promise;
    const operation = (async () => {
      try {
        const init: RequestInit = {
          method: "POST",
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        };
        const response = await fetcher(`${baseUrl}/api/auth/refresh`, {
          ...init,
          headers: requestHeaders(init, null),
        });
        const result = await envelope<SessionTokens>(response);
        if (
          !response.ok ||
          result.code !== 0 ||
          !validSessionTokens(result.data)
        ) {
          throw new Error("账户刷新失败");
        }
        if (generation !== sessionGeneration || !tokens) return false;
        await persistTokens(
          {
            ...tokens,
            accessToken: result.data.accessToken,
            refreshToken: result.data.refreshToken,
          },
          false,
        );
        return generation === sessionGeneration;
      } catch {
        if (generation === sessionGeneration) await persistTokens(null, true);
        return false;
      } finally {
        if (refreshPromise?.generation === generation)
          refreshPromise = undefined;
      }
    })();
    refreshPromise = { generation, promise: operation };
    return operation;
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    allowRefresh = true,
  ): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new Error("API 请求必须使用服务内的绝对路径");
    }
    await loadTokens();
    const generation = sessionGeneration;
    const session = storedTokens();
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: requestHeaders(init, session),
    });
    if (
      response.status === 401 &&
      allowRefresh &&
      session?.refreshToken &&
      (await refreshAccessToken(generation, session))
    ) {
      if (generation !== sessionGeneration) {
        throw new CodingBroApiError(1001, "登录会话已失效，请重新登录", 401);
      }
      return request<T>(path, init, false);
    }
    const result = await envelope<T>(response);
    // A successful response can also arrive after logout or a different login.
    // Never let old account data flow back into the current application state.
    if (generation !== sessionGeneration) {
      throw new CodingBroApiError(1001, "登录会话已失效，请重新登录", 401);
    }
    if (!response.ok || result.code !== 0) {
      throw new CodingBroApiError(result.code, result.msg, response.status);
    }
    return result.data;
  }

  async function ensureGatewayCredential(): Promise<GatewayCredential> {
    await loadTokens();
    if (!tokens) throw new Error("请先登录账户");
    if (tokens.gatewayCredential && !expired(tokens.gatewayCredential)) {
      return { ...tokens.gatewayCredential };
    }
    // Old login payloads supply a gateway token without the structured
    // credential. Reuse it instead of rotating a token that an existing Codex
    // process may still be using. An explicitly expired credential renews.
    if (!tokens.gatewayCredential && tokens.gatewayToken) {
      return { gatewayToken: tokens.gatewayToken };
    }
    const generation = sessionGeneration;
    if (credentialPromise?.generation === generation) {
      return credentialPromise.promise.then((value) => ({ ...value }));
    }
    const operation = (async () => {
      try {
        const result = await request<GatewayCredential>(
          "/api/auth/gateway-credential",
          { method: "POST" },
        );
        if (!validGatewayCredential(result) || expired(result)) {
          throw new Error("Gateway Credential 返回格式无效或已过期");
        }
        if (generation !== sessionGeneration || !tokens) {
          throw new Error("登录会话已失效，请重新登录");
        }
        await persistTokens(
          {
            ...tokens,
            gatewayToken: result.gatewayToken,
            gatewayCredential: result,
          },
          false,
        );
        if (generation !== sessionGeneration) {
          throw new Error("登录会话已失效，请重新登录");
        }
        return { ...result };
      } finally {
        if (credentialPromise?.generation === generation)
          credentialPromise = undefined;
      }
    })();
    credentialPromise = { generation, promise: operation };
    return operation;
  }

  return {
    baseUrl,
    storedTokens,
    loadTokens,
    saveTokens,
    request,
    apiRequest: request,
    ensureGatewayCredential,
    logoutLocal: () => saveTokens(null),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
