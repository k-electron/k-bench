#!/usr/bin/env node
// The `k-bench` command (the package's `bin`). From a checkout, `pnpm install-app` runs it
// as `node scripts/k-bench.ts install`; in the npm package it is compiled to JavaScript.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { install } from "./install.ts";
import { findPackageRoot } from "./install-lib.ts";
import { uninstall } from "./uninstall.ts";

const USAGE = `Usage: k-bench <command> [options]

Commands:
  install [--dry-run] [--login <login>] [--https-port <n>] [--force]
                  install or update k-bench as a background service, published on
                  HTTPS port 443 unless --https-port says otherwise; --force replaces
                  whatever else is on that port
  uninstall [--dry-run] [--purge]
                  stop and remove the service, its tailscale serve entry and the app
                  folder, keeping your data and running Sessions; --purge also deletes
                  the data and ends every Session

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
} else {
  console.error(`k-bench: unknown command "${command}"\n\n${USAGE}`);
  process.exit(1);
}
