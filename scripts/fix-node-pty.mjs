// node-pty ships a prebuilt `spawn-helper` binary that pnpm installs without its execute
// bit, which makes every pty.spawn fail with "posix_spawnp failed". Restore the bit.
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
let root;
try {
  root = dirname(require.resolve("node-pty/package.json"));
} catch {
  process.exit(0); // node-pty not installed (e.g. a partial install): nothing to fix
}

const prebuilds = join(root, "prebuilds");
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
