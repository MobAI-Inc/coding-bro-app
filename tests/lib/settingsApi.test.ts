import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { settingsApi } from "@/lib/api/settings";
import { server } from "../msw/server";

describe("settingsApi", () => {
  it("requests a local-only tool probe for the one-click launcher", async () => {
    let payload: Record<string, unknown> | undefined;
    server.use(
      http.post("http://tauri.local/get_tool_versions", async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json([
          {
            name: "codex",
            version: "0.148.0",
            latest_version: null,
            error: null,
            installed_but_broken: false,
            env_type: "macos",
            wsl_distro: null,
          },
        ]);
      }),
    );

    const result = await settingsApi.getToolVersions(
      ["codex"],
      undefined,
      true,
    );

    expect(result[0]?.version).toBe("0.148.0");
    expect(payload).toEqual({ tools: ["codex"], localOnly: true });
  });

  it("resolves the exact executable command before launching a tool", async () => {
    server.use(
      http.post("http://tauri.local/resolve_tool_launch_command", () =>
        HttpResponse.json(
          "'/Applications/ChatGPT.app/Contents/Resources/codex'",
        ),
      ),
    );

    await expect(settingsApi.resolveToolLaunchCommand("codex")).resolves.toBe(
      "'/Applications/ChatGPT.app/Contents/Resources/codex'",
    );
  });
});
