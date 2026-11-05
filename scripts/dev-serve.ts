// `pnpm dev:serve`: publishes the Dev instance's server on the tailnet at a second HTTPS
// port, so the phone layout can be tried before installing. It publishes the server itself
// (port 7690), not Vite: the server enforces the same `Tailscale-User-Login` check as the
// Installed instance, whereas Vite's dev proxy injects a login. So the page served is the
// last `pnpm build`. `--off` stops publishing, `--dry-run` only prints.
import { execFileSync } from "node:child_process";
import { delimiter } from "node:path";
import { parseArgs } from "node:util";
import { resolveConfig } from "../src/server/config.ts";
import { parseTailscaleStatus, resolveTailscaleCli } from "./install-lib.ts";
import { servePublishArgs } from "./tailscale-serve.ts";

const HTTPS_PORT = 8443;

const { values: flags } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    off: { type: "boolean", default: false },
  },
});

const { port } = resolveConfig({ K_BENCH_INSTANCE: "dev" });
const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
const tailscale = resolveTailscaleCli({ pathDirs });
if (!tailscale) {
  console.error(
    "dev:serve: the Tailscale CLI was not found on PATH or inside /Applications/Tailscale.app.",
  );
  process.exit(1);
}

const args = flags.off
  ? ["serve", `--https=${HTTPS_PORT}`, "off"]
  : servePublishArgs(HTTPS_PORT, port);
console.log(
  `${flags["dry-run"] ? "would run" : "running"}: ${tailscale} ${args.join(" ")}`,
);
if (flags["dry-run"]) process.exit(0);

execFileSync(tailscale, args, { stdio: "inherit" });
if (!flags.off) {
  const { login, dnsName } = parseTailscaleStatus(
    execFileSync(tailscale, ["status", "--json"], { encoding: "utf8" }),
  );
  console.log(`\nDev instance: https://${dnsName}:${HTTPS_PORT}/`);
  console.log(
    `It only admits ${login} if the Dev server is started with that login, e.g.\n  K_BENCH_ALLOWED_LOGIN=${login} pnpm dev\nand it serves the last \`pnpm build\`.`,
  );
}
