import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import { createApiClient, type SessionTokens } from "@coding-bro/product-core";

const SESSION_KEY = "coding-bro-lite-session-v1";
const store = new LazyStore("codex_lite_session.json", { autoSave: false });

// Lite owns its product identity and network deadline. Keep the shared client
// unchanged so full-app requests retain their existing headers and behavior.
const liteFetch: typeof globalThis.fetch = async (input, init) => {
  const controller = new AbortController();
  const upstream =
    init?.signal ?? (input instanceof Request ? input.signal : null);
  const abort = () => controller.abort();
  if (upstream?.aborted) abort();
  else upstream?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20_000);
  try {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("X-Coding-Bro-Product", "codex-lite");
    const response = await globalThis.fetch(input, {
      ...init,
      headers,
      signal: controller.signal,
    });
    // All API calls return JSON. Buffer the body under the same deadline:
    // receiving headers alone must not leave response.json() hanging forever.
    let body = await response.arrayBuffer();
    // The credential endpoint represents absent metadata as JSON null.
    // Normalize only optional metadata; token and expiry validation stay in
    // product-core, including rejection of malformed/nonempty expiry values.
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      "https://localhost",
    ).pathname;
    if (path === "/api/auth/gateway-credential" && response.ok) {
      const envelope = JSON.parse(new TextDecoder().decode(body));
      if (
        envelope.code === 0 &&
        envelope.data &&
        typeof envelope.data === "object"
      ) {
        for (const key of [
          "inferenceBaseUrl",
          "publicModelId",
          "profileVersion",
          "planVersion",
          "expiresAt",
        ]) {
          if (envelope.data[key] === null) delete envelope.data[key];
        }
        body = new TextEncoder().encode(JSON.stringify(envelope)).buffer;
      }
    }
    return new Response(
      [204, 205, 304].includes(response.status) ? null : body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  } catch (error) {
    if (timedOut)
      throw new Error("Lite 服务连接超时（20 秒），请检查网络后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", abort);
  }
};

export const api = createApiClient({
  fetch: liteFetch,
  baseUrl:
    !isTauri() && import.meta.env.DEV
      ? window.location.origin
      : import.meta.env.VITE_CODING_BRO_API_URL ||
        (import.meta.env.DEV || import.meta.env.MODE === "local"
          ? "http://127.0.0.1:3001"
          : "https://api.example.invalid"),
  tokenStore: {
    async load() {
      if (isTauri())
        return (await store.get<SessionTokens>(SESSION_KEY)) ?? null;
      try {
        return JSON.parse(
          sessionStorage.getItem(SESSION_KEY) ?? "null",
        ) as SessionTokens | null;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      if (isTauri()) {
        if (tokens) await store.set(SESSION_KEY, tokens);
        else await store.delete(SESSION_KEY);
        await store.save();
      } else if (tokens) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    },
  },
});
