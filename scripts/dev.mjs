// `pnpm dev`: the Dev instance. Runs the server in watch mode and Vite side by side, and
// stops both together. The Dev instance config comes from K_BENCH_INSTANCE=dev (data in
// ./.data, tmux socket "k-bench-dev", port 7690); Vite proxies /api to it.
import { spawn, spawnSync } from "node:child_process";

const env = { ...process.env, K_BENCH_INSTANCE: "dev" };
// The Agent Runtime the server installs for Claude Agents is a built file, so build it
// before the server starts, then keep it built as its source changes. A new build is a new
// runtime: Agents already running keep the one they started with.
const runtimeBuild = ["exec", "vite", "build", "--config", "vite.runtime.config.ts"];
spawnSync("pnpm", [...runtimeBuild, "--logLevel", "warn"], { env, stdio: "inherit" });
const children = [
  spawn("node", ["--watch", "src/server/main.ts"], { env, stdio: "inherit" }),
  spawn("pnpm", ["exec", "vite"], { env, stdio: "inherit" }),
  spawn("pnpm", [...runtimeBuild, "--watch", "--logLevel", "warn"], {
    env,
    stdio: "inherit",
  }),
];

let exiting = false;
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) child.on("exit", (code) => shutdown(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));
