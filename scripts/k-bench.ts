#!/usr/bin/env node
// The `k-bench` command (the package's `bin`). From a checkout, `pnpm install-app` runs it
// as `node scripts/k-bench.ts install`; in the npm package it is compiled to JavaScript.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { install } from "./install.ts";
import { findPackageRoot } from "./install-lib.ts";
import { status } from "./status.ts";
import { DEFAULT_HTTPS_PORT } from "./tailscale-serve.ts";
import { uninstall } from "./uninstall.ts";

const USAGE = `Usage: k-bench <command> [options]

Commands:
  install [--dry-run] [--login <login>] [--https-port <n>] [--force]
                  install or update k-bench as a background service, published on
                  HTTPS port ${DEFAULT_HTTPS_PORT} unless --https-port says otherwise; --force replaces
                  whatever else is on that port
  uninstall [--dry-run] [--purge]
                  stop and remove the service, its tailscale serve entry and the app
                  folder, keeping your data and running Sessions; --purge also deletes
                  the data and ends every Session
  status          check that k-bench is set up and healthy: each check passes or
                  fails with a fix, and the exit status is non-zero when one fails

Options:
  --help, -h      show this help
  --version, -v   show the version
`;

const [command, ...rest] = process.argv.slice(2);

if (command === "--version" || command === "-v") {
  const root = findPackageRoot(import.meta.dirname);
  console.log(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
} else if (command === "--help" || command === "-h") {
  console.log(USAGE);
} else if (command === undefined) {
  console.error(USAGE);
  process.exit(1);
} else if (command === "install") {
  await install(rest);
} else if (command === "uninstall") {
  await uninstall(rest);
} else if (command === "status") {
  await status(rest);
} else {
  console.error(`k-bench: unknown command "${command}"\n\n${USAGE}`);
  process.exit(1);
}
