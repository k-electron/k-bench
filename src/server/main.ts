import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = resolveConfig();
// A production build (`pnpm build`) is served by this server alone. In `pnpm dev` there is
// usually none, and Vite serves the front end instead.
const webDir = resolve("dist/web");
const server = await startServer(config, {
  webDir: existsSync(webDir) ? webDir : undefined,
});
console.log(
  `k-bench listening on http://127.0.0.1:${server.port} (tmux socket "${config.tmuxSocket}", data ${config.dataDir})`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Stopping the server leaves tmux, and so every Session, running.
    void server.stop().then(() => process.exit(0));
  });
}
