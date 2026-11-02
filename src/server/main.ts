import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = resolveConfig();
if (!config.allowedLogin) {
  console.warn(
    "K_BENCH_ALLOWED_LOGIN is not set: every request will be refused with 403 until it is.",
  );
}
// A production build (`pnpm build`) is served by this server alone. In `pnpm dev` there is
// usually none, and Vite serves the front end instead.
const webDir = resolve("dist/web");
const server = await startServer(config, {
  webDir: existsSync(webDir) ? webDir : undefined,
});
console.log(
  `k-bench ${describeBuild()} listening on http://127.0.0.1:${server.port} (tmux socket "${config.tmuxSocket}", data ${config.dataDir})`,
);

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Which version, and from a checkout which commit, is running. `k-bench install` records
 * both in build-info.json; without it (a checkout, or the package run in place) the version
 * is read from package.json.
 */
function describeBuild(): string {
  const info = readJson("build-info.json");
  const version = info.version ?? readJson("package.json").version ?? "(unknown version)";
  const commit = info.commit
    ? ` commit ${String(info.commit).slice(0, 7)}${info.dirty ? "+uncommitted" : ""}`
    : "";
  return `${version}${commit} (${info.installedAt ? `installed ${info.installedAt}` : "not installed"})`;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Stopping the server leaves tmux, and so every Session, running.
    void server.stop().then(() => process.exit(0));
  });
}
