import { providersApi, type AppId } from "@/lib/api";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { Provider } from "@/types";
import type { PlanId } from "../plan/types";
import { API_BASE_URL, type GatewayCredential } from "./client";

const APPS: readonly AppId[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "pi",
  "hermes",
];

const MANAGED_PROVIDER_ID = "coding-bro-plan";
const PREVIOUS_PROVIDERS_KEY = "previous-providers";
const managedStateStore = new LazyStore("coding_bro_managed_providers.json", {
  autoSave: false,
});
const EXCLUSIVE_APPS = new Set<AppId>(["claude", "codex", "gemini"]);

function productModel(plan: PlanId): string {
  return plan === "lite"
    ? "codingbro-2.0"
    : plan === "pro"
      ? "codingbro-pro-2.0"
      : "codingbro-max-2.0";
}

export function providerFor(
  app: AppId,
  credential: GatewayCredential | string,
  plan: PlanId,
  selectedModelId?: string,
): Provider {
  const normalizedCredential =
    typeof credential === "string" ? { gatewayToken: credential } : credential;
  const token = normalizedCredential.gatewayToken;
  const model =
    selectedModelId ||
    normalizedCredential.publicModelId?.trim() ||
    productModel(plan);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) {
    throw new Error("无效的模型 ID");
  }
  const apiOrigin = (
    normalizedCredential.inferenceBaseUrl?.trim() || API_BASE_URL
  ).replace(/\/$/, "");
  const openAiBaseUrl = `${apiOrigin}/v1`;
  const settingsConfig: Record<string, unknown> =
    app === "claude"
      ? {
          env: {
            ANTHROPIC_BASE_URL: apiOrigin,
            ANTHROPIC_AUTH_TOKEN: token,
            ANTHROPIC_MODEL: model,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
            ANTHROPIC_DEFAULT_SONNET_MODEL: model,
            ANTHROPIC_DEFAULT_OPUS_MODEL: model,
          },
        }
      : app === "codex"
        ? {
            auth: { OPENAI_API_KEY: token },
            config: `model_provider = "custom"
model = "${model}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = "Coding Bro"
base_url = "${openAiBaseUrl}"
wire_api = "responses"
requires_openai_auth = true`,
          }
        : app === "gemini"
          ? {
              env: {
                GOOGLE_GEMINI_BASE_URL: apiOrigin,
                GEMINI_API_KEY: token,
                GEMINI_MODEL: model,
              },
            }
          : app === "opencode"
            ? {
                npm: "@ai-sdk/openai-compatible",
                name: "Coding Bro",
                options: {
                  baseURL: openAiBaseUrl,
                  apiKey: token,
                  setCacheKey: true,
                },
                models: { [model]: { name: "Coding Bro" } },
              }
            : app === "pi"
              ? {
                  name: "coding-bro",
                  baseUrl: openAiBaseUrl,
                  api: "openai-responses",
                  apiKey: token,
                  models: [{ id: model, name: "Coding Bro" }],
                }
              : {
                  name: "coding-bro",
                  base_url: openAiBaseUrl,
                  api_key: token,
                  api_mode: "chat_completions",
                  models: [{ id: model, name: "Coding Bro" }],
                };
  settingsConfig.codingBroModel = model;
  settingsConfig.codingBroApiBaseUrl = apiOrigin;
  settingsConfig.codingBroProfileVersion = normalizedCredential.profileVersion;
  settingsConfig.codingBroPlanVersion = normalizedCredential.planVersion;
  settingsConfig.codingBroCredentialExpiresAt = normalizedCredential.expiresAt;
  return {
    id: MANAGED_PROVIDER_ID,
    name: "Coding Bro Plan",
    settingsConfig,
    category: "custom",
    icon: "coding-bro",
    meta: { codingBroPlan: true, apiFormat: "openai_responses" },
    inFailoverQueue: false,
  };
}

async function previousProviders(): Promise<Partial<Record<AppId, string>>> {
  return (
    (await managedStateStore.get<Partial<Record<AppId, string>>>(
      PREVIOUS_PROVIDERS_KEY,
    )) ?? {}
  );
}

export async function configureManagedProvider(
  app: AppId,
  gatewayCredential: GatewayCredential | string,
  plan: PlanId,
  selectedModelId?: string,
): Promise<Provider> {
  if (!APPS.includes(app)) {
    throw new Error(`无法在当前环境配置 ${app} 的 Coding Bro Plan`);
  }
  // Deliberately do not persist this provider or call switch_provider here.
  // Coding Bro is a per-process overlay; the user's official/OpenRouter
  // configuration must remain the native CLI default.
  return providerFor(app, gatewayCredential, plan, selectedModelId);
}

function withoutManagedCredential(provider: Provider, app: AppId): Provider {
  const config = provider.settingsConfig as Record<string, unknown>;
  if (app === "claude" || app === "gemini") {
    const env = { ...((config.env as Record<string, unknown>) ?? {}) };
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    delete env.GEMINI_API_KEY;
    return { ...provider, settingsConfig: { ...config, env } };
  }
  const auth = { ...((config.auth as Record<string, unknown>) ?? {}) };
  delete auth.OPENAI_API_KEY;
  return { ...provider, settingsConfig: { ...config, auth } };
}

/**
 * One-time cleanup for builds that used to persist Coding Bro into native CLI
 * configuration. New launches never create these rows or write native files.
 */
export async function migrateLegacyManagedProviders(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const previous = await previousProviders();
  for (const app of APPS) {
    const existing = await providersApi.getAll(app);
    const managed = existing[MANAGED_PROVIDER_ID];
    if (!managed) continue;

    if (EXCLUSIVE_APPS.has(app)) {
      const current = await providersApi.getCurrent(app).catch(() => "");
      if (current === MANAGED_PROVIDER_ID) {
        const remembered = previous[app];
        const fallback =
          (remembered && existing[remembered] ? remembered : undefined) ??
          Object.values(existing).find(
            (provider) =>
              provider.id !== MANAGED_PROVIDER_ID &&
              provider.category === "official",
          )?.id ??
          Object.values(existing).find(
            (provider) => provider.id !== MANAGED_PROVIDER_ID,
          )?.id;
        if (!fallback) {
          await providersApi.update(
            withoutManagedCredential(managed, app),
            app,
            MANAGED_PROVIDER_ID,
          );
          throw new Error(`无法安全恢复 ${app} 的原配置，已保留无凭据配置`);
        }
        await providersApi.switch(fallback, app);
      }
    }
    await providersApi.delete(MANAGED_PROVIDER_ID, app);
  }
  await managedStateStore.clear();
  await managedStateStore.save();
  await providersApi.updateTrayMenu();
}

export const removeManagedProviders = migrateLegacyManagedProviders;
