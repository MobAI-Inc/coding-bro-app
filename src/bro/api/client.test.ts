import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  enabled: true,
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  save: vi.fn(),
}));
const originalFetch = globalThis.fetch;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = tauri.get;
    set = tauri.set;
    delete = tauri.delete;
    save = tauri.save;
  },
}));

beforeEach(() => {
  vi.resetModules();
  tauri.enabled = true;
  tauri.get.mockReset();
  tauri.set.mockReset();
  tauri.delete.mockReset();
  tauri.save.mockReset();
  tauri.set.mockResolvedValue(undefined);
  tauri.delete.mockResolvedValue(true);
  tauri.save.mockResolvedValue(undefined);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Coding Bro session storage", () => {
  it("loads a persisted desktop session through a native command", async () => {
    const session = {
      accessToken: "access",
      refreshToken: "refresh",
      gatewayToken: "gateway",
    };
    tauri.get.mockResolvedValueOnce(session);
    const client = await import("./client");

    await expect(client.loadTokens()).resolves.toEqual(session);
    expect(client.storedTokens()).toEqual(session);
    expect(tauri.get).toHaveBeenCalledWith("coding-bro-account-session-v1");
  });

  it("coalesces concurrent native session loads", async () => {
    const session = { accessToken: "access", refreshToken: "refresh" };
    let resolveLoad: ((value: unknown) => void) | undefined;
    tauri.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const client = await import("./client");

    const first = client.loadTokens();
    const second = client.loadTokens();
    resolveLoad?.(session);

    await expect(Promise.all([first, second])).resolves.toEqual([
      session,
      session,
    ]);
    expect(tauri.get).toHaveBeenCalledTimes(1);
  });

  it("migrates and removes the legacy localStorage session", async () => {
    const session = { accessToken: "access", refreshToken: "refresh" };
    localStorage.setItem(
      "coding-bro-account-session-v1",
      JSON.stringify(session),
    );
    tauri.get.mockResolvedValueOnce(undefined);
    const client = await import("./client");

    await expect(client.loadTokens()).resolves.toEqual(session);
    expect(tauri.set).toHaveBeenCalledWith(
      "coding-bro-account-session-v1",
      session,
    );
    expect(tauri.save).toHaveBeenCalled();
    expect(localStorage.getItem("coding-bro-account-session-v1")).toBeNull();
  });

  it("ignores malformed persisted and legacy sessions", async () => {
    tauri.get.mockResolvedValueOnce({ accessToken: "access" });
    localStorage.setItem("coding-bro-account-session-v1", "not-json");
    const client = await import("./client");

    await expect(client.loadTokens()).resolves.toBeNull();
    expect(tauri.set).not.toHaveBeenCalled();
    expect(localStorage.getItem("coding-bro-account-session-v1")).toBeNull();
  });

  it("does not write desktop tokens to browser storage", async () => {
    const session = { accessToken: "access", refreshToken: "refresh" };
    const client = await import("./client");

    await client.saveTokens(session);

    expect(tauri.set).toHaveBeenCalledWith(
      "coding-bro-account-session-v1",
      session,
    );
    expect(tauri.save).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("uses tab-scoped storage only in browser development", async () => {
    tauri.enabled = false;
    const session = { accessToken: "access", refreshToken: "refresh" };
    const client = await import("./client");

    await client.saveTokens(session);

    expect(sessionStorage.getItem("coding-bro-account-session-v1")).toBe(
      JSON.stringify(session),
    );
    expect(localStorage.length).toBe(0);
  });

  it("recovers and persists a missing gateway credential", async () => {
    const session = { accessToken: "access", refreshToken: "refresh" };
    tauri.get.mockResolvedValueOnce(session);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: "ok",
          data: {
            gatewayToken: "cbg_recovered",
            inferenceBaseUrl: "https://gateway.example",
            publicModelId: "codingbro-pro-2.1",
            profileVersion: "profile-v3",
            planVersion: "launch-2026-09-01:pro",
            expiresAt: "2099-09-02T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = await import("./client");
    await client.loadTokens();

    await expect(client.ensureGatewayCredential()).resolves.toEqual({
      gatewayToken: "cbg_recovered",
      inferenceBaseUrl: "https://gateway.example",
      publicModelId: "codingbro-pro-2.1",
      profileVersion: "profile-v3",
      planVersion: "launch-2026-09-01:pro",
      expiresAt: "2099-09-02T00:00:00.000Z",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/gateway-credential"),
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );
    expect(tauri.set).toHaveBeenCalledWith("coding-bro-account-session-v1", {
      ...session,
      gatewayToken: "cbg_recovered",
      gatewayCredential: {
        gatewayToken: "cbg_recovered",
        inferenceBaseUrl: "https://gateway.example",
        publicModelId: "codingbro-pro-2.1",
        profileVersion: "profile-v3",
        planVersion: "launch-2026-09-01:pro",
        expiresAt: "2099-09-02T00:00:00.000Z",
      },
    });
  });
});
