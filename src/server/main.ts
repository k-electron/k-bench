import { resolveConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = resolveConfig();
if (!config.allowedLogin) {
  console.warn(
    "K_BENCH_ALLOWED_LOGIN is not set: every request will be refused with 403 until it is.",
  );
}
const server = await startServer(config);
console.log(
  `k-bench listening on http://127.0.0.1:${server.port} (tmux socket "${config.tmuxSocket}", data ${config.dataDir})`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Stopping the server leaves tmux, and so every Session, running.
    void server.stop().then(() => process.exit(0));
  });
}
