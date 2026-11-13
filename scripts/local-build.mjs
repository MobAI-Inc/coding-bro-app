import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = realpathSync(process.cwd());
const packageName = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).name;
if (!["coding-bro", "@coding-bro/codex-lite"].includes(packageName)) {
  throw new Error(`Run the build from a Coding Bro client package directory: ${cwd}`);
}
const lite = packageName === "@coding-bro/codex-lite";
const paths = {
  project: cwd,
  renderer: path.join(cwd, "dist"),
  cargo: path.join(cwd, "src-tauri/target"),
  release: path.resolve(cwd, lite ? "../../release/coding-bro-lite" : "release"),
  temporary: path.join(cwd, ".build-tmp"),
};
const [command, ...args] = process.argv.slice(2);
if (command === "--print-paths") {
  console.log(JSON.stringify(paths, null, 2));
} else {
  if (!command) throw new Error("Expected a build command or --print-paths");
  const env = { ...process.env };
  mkdirSync(paths.temporary, { recursive: true });
  env.TMPDIR = paths.temporary;
  env.TMP = paths.temporary;
  env.TEMP = paths.temporary;
  env.CARGO_TARGET_DIR ||= paths.cargo;
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
}
