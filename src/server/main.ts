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

/** Which commit is running: `pnpm install-app` records it in build-info.json. */
function describeBuild(): string {
  try {
    const info = JSON.parse(readFileSync(resolve("build-info.json"), "utf8"));
    return `${String(info.commit).slice(0, 7)}${info.dirty ? "+uncommitted" : ""} (installed ${info.installedAt})`;
  } catch {
    return "(uninstalled checkout)";
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Stopping the server leaves tmux, and so every Session, running.
    void server.stop().then(() => process.exit(0));
  });
}
