// Resolve JS tool entrypoints directly: Windows .cmd shims cannot be spawned
// without cmd.exe, whose quoting would turn build arguments into shell source.
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const [tool, ...args] = process.argv.slice(2);
const entries = {
  tauri: ["@tauri-apps/cli", "tauri.js"],
  vite: ["vite", "bin/vite.js"],
  tsc: ["typescript", "bin/tsc"],
};
if (!entries[tool]) throw new Error(`Unknown Lite build tool: ${tool}`);
const result = spawnSync(
  process.execPath,
  [
    "../../scripts/local-build.mjs",
    process.execPath,
    path.join(
      path.dirname(require.resolve(`${entries[tool][0]}/package.json`)),
      entries[tool][1],
    ),
    ...args,
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
