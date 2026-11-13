import { providerFor } from "@/bro/api/managedProviders";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  clear: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  getCurrent: vi.fn(),
  save: vi.fn(),
  set: vi.fn(),
  switch: vi.fn(),
  update: vi.fn(),
  updateTrayMenu: vi.fn(),
  values: new Map<string, unknown>(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    clear = mocks.clear;
    get = mocks.get;
    save = mocks.save;
    set = mocks.set;
  },
}));

vi.mock("@/lib/api", () => ({
  providersApi: {
    add: mocks.add,
    delete: mocks.delete,
    getAll: mocks.getAll,
    getCurrent: mocks.getCurrent,
    switch: mocks.switch,
    update: mocks.update,
    updateTrayMenu: mocks.updateTrayMenu,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.values.clear();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  mocks.get.mockImplementation(async (key: string) => mocks.values.get(key));
  mocks.set.mockImplementation(async (key: string, value: unknown) => {
    mocks.values.set(key, value);
  });
  mocks.clear.mockImplementation(async () => {
    mocks.values.clear();
  });
  mocks.getAll.mockResolvedValue({});
  mocks.getCurrent.mockResolvedValue("personal-provider");
  for (const mock of [
    mocks.add,
    mocks.delete,
    mocks.save,
    mocks.switch,
    mocks.update,
    mocks.updateTrayMenu,
  ]) {
    mock.mockResolvedValue(undefined);
  }
});

describe("Coding Bro managed CLI providers", () => {
  it("builds an in-memory provider without writing or switching native config", async () => {
    const { configureManagedProvider } = await import(
      "@/bro/api/managedProviders"
    );

    const provider = await configureManagedProvider(
      "codex",
      {
        gatewayToken: "gateway-token",
        inferenceBaseUrl: "https://gateway.example",
        publicModelId: "codingbro-pro-2.1",
        profileVersion: "profile-v3",
        planVersion: "launch-2026-09-01:pro",
        expiresAt: "2099-09-02T00:00:00.000Z",
      },
      "pro",
    );

    expect(provider).toEqual(
      expect.objectContaining({
        id: "coding-bro-plan",
        category: "custom",
        settingsConfig: expect.objectContaining({
          auth: { OPENAI_API_KEY: "gateway-token" },
          codingBroModel: "codingbro-pro-2.1",
          codingBroApiBaseUrl: "https://gateway.example",
          codingBroProfileVersion: "profile-v3",
          codingBroPlanVersion: "launch-2026-09-01:pro",
          codingBroCredentialExpiresAt: "2099-09-02T00:00:00.000Z",
        }),
      }),
    );
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.switch).not.toHaveBeenCalled();
  });

  it("describes Hermes with the same Chat Completions transport used by the launcher", async () => {
    const { configureManagedProvider } = await import(
      "@/bro/api/managedProviders"
    );

    const provider = await configureManagedProvider(
      "hermes",
      "gateway-token",
      "lite",
    );

    expect(provider.settingsConfig).toEqual(
      expect.objectContaining({
        base_url: expect.stringMatching(/\/v1$/),
        api_mode: "chat_completions",
        codingBroModel: "codingbro-2.0",
      }),
    );
  });

  it("restores the provider that was active before logout", async () => {
    const { migrateLegacyManagedProviders } = await import(
      "@/bro/api/managedProviders"
    );
    mocks.values.set("previous-providers", { claude: "personal-provider" });
    mocks.getAll.mockImplementation(async (app: string) =>
      app === "claude"
        ? {
            "coding-bro-plan": {
              id: "coding-bro-plan",
              name: "Coding Bro Plan",
              settingsConfig: {},
              category: "custom",
            },
            "personal-provider": {
              id: "personal-provider",
              name: "Personal",
              settingsConfig: {},
            },
          }
        : {},
    );
    mocks.getCurrent.mockResolvedValue("coding-bro-plan");

    await migrateLegacyManagedProviders();

    expect(mocks.switch).toHaveBeenCalledWith("personal-provider", "claude");
    expect(mocks.delete).toHaveBeenCalledWith("coding-bro-plan", "claude");
    expect(mocks.clear).toHaveBeenCalledOnce();
  });
});

describe("selected ordinary model", () => {
  it("overrides the gateway product default in every launcher", () => {
    for (const app of [
      "claude",
      "codex",
      "gemini",
      "opencode",
      "pi",
      "hermes",
    ] as const) {
      const provider = providerFor(
        app,
        { gatewayToken: "gateway-token", publicModelId: "codingbro-pro-2.0" },
        "pro",
        "gpt-5.6-terra",
      );
      expect(provider.settingsConfig.codingBroModel).toBe("gpt-5.6-terra");
      expect(JSON.stringify(provider.settingsConfig)).not.toContain(
        "codingbro-pro-2.0",
      );
    }
  });
});
