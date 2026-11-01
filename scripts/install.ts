// `pnpm install-app`: builds k-bench and installs it as the Installed instance (ADR-0001,
// ADR-0003). Safe to re-run: it updates the app in place, and running Sessions live in tmux,
// outside this server's process group, so they carry on. `--dry-run` prints the plan and
// changes nothing; `--login <login>` skips reading it from Tailscale.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { resolveConfig } from "../src/server/config.ts";
import {
  buildLaunchAgentPlist,
  findExecutable,
  nodePtyProblems,
  parseTailscaleStatus,
  resolveTailscaleCli,
  stageApp,
  swapInStagedApp,
} from "./install-lib.ts";

const LABEL = "com.k-bench.server";
const HTTPS_PORT = 443;

const { values: flags } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    login: { type: "string" },
  },
});
const dryRun = flags["dry-run"];

function fail(message: string): never {
  console.error(`install-app: ${message}`);
  process.exit(1);
}

function say(line: string): void {
  console.log(line);
}

/** Announces a step, and does it unless this is a dry run. */
async function step(
  description: string,
  action: () => void | Promise<void>,
): Promise<void> {
  say(`${dryRun ? "would: " : ""}${description}`);
  if (!dryRun) await action();
}

// Explicit env: the install must never pick up a K_BENCH_* override from the shell.
const config = resolveConfig({ K_BENCH_INSTANCE: "installed" });
const repoDir = resolve(import.meta.dirname, "..");
const appDir = join(config.dataDir, "app");
const stagingDir = join(config.dataDir, "app.staging");
const logPath = join(homedir(), "Library", "Logs", "k-bench", "k-bench.log");
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = `gui/${process.getuid?.() ?? 501}`;

// Prerequisites. These are read-only checks, so they run in a dry run too.
const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
const tmux = findExecutable("tmux", pathDirs);
if (!tmux) fail("tmux not found. Install it with `brew install tmux`.");
const tailscale = resolveTailscaleCli({ pathDirs });
if (!tailscale) {
  fail("the Tailscale CLI was not found on PATH or inside /Applications/Tailscale.app.");
}

function resolveNodePath(): string {
  // Prefer the stable name on PATH (e.g. /opt/homebrew/bin/node) over the versioned Cellar
  // path, so a `brew upgrade node` doesn't break the agent, when it is the running Node.
  const onPath = findExecutable("node", pathDirs);
  if (onPath && realpathSync(onPath) === realpathSync(process.execPath)) return onPath;
  return process.execPath;
}
const nodePath = resolveNodePath();

function agentPath(): string {
  const dirs = [
    dirname(nodePath),
    dirname(tmux as string),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(dirs)].join(delimiter);
}

function pnpm(args: string[], cwd: string): void {
  execFileSync("pnpm", args, { cwd, stdio: "inherit" });
}

function launchctl(args: string[]): boolean {
  return spawnSync("launchctl", args, { stdio: "ignore" }).status === 0;
}

async function waitFor(
  what: string,
  check: () => Promise<boolean> | boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  fail(`timed out waiting for ${what}`);
}

say(
  dryRun ? "k-bench install: dry run, nothing will be changed.\n" : "k-bench install\n",
);
say(`  node       ${nodePath}`);
say(`  tmux       ${tmux}`);
say(`  tailscale  ${tailscale}`);
say(`  app        ${appDir}`);
say(
  `  data       ${config.dataDir} (tmux socket "${config.tmuxSocket}", port ${config.port})`,
);
say(`  agent      ${plistPath}`);
say(`  log        ${logPath}\n`);

let identity = { login: flags.login ?? "", dnsName: "<this machine's tailnet name>" };
if (flags.login || dryRun) {
  if (!flags.login) identity.login = "<your login, read from `tailscale status --json`>";
} else {
  identity = parseTailscaleStatus(
    execFileSync(tailscale, ["status", "--json"], { encoding: "utf8" }),
  );
}
say(`allowed login: ${identity.login}\n`);

await step("build the front end (pnpm build)", () => pnpm(["build"], repoDir));

await step(`copy the server and built assets into ${stagingDir}`, () =>
  stageApp({ repoDir, stagingDir }),
);

await step("record the installed commit in build-info.json", () => {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
  const buildInfo = {
    commit: git(["rev-parse", "HEAD"]),
    // Uncommitted changes were installed too, so the commit alone doesn't describe the app.
    dirty: git(["status", "--porcelain"]) !== "",
    installedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(stagingDir, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );
});

await step(
  "install production dependencies there (pnpm install --prod --frozen-lockfile)",
  () => {
    pnpm(["install", "--prod", "--frozen-lockfile"], stagingDir);
    execFileSync(process.execPath, ["scripts/fix-node-pty.mjs"], {
      cwd: stagingDir,
      stdio: "inherit",
    });
    const problems = nodePtyProblems(stagingDir);
    if (problems.length > 0) fail(`node-pty is not usable:\n  ${problems.join("\n  ")}`);
  },
);

// The old server stops before its folder is replaced: otherwise it would keep running from
// a deleted directory, and KeepAlive could restart it against a half-swapped tree. Stopping
// the agent leaves tmux, and so every Session, running (AbandonProcessGroup, ADR-0001).
await step(
  `stop the running LaunchAgent (launchctl bootout, ${domain}), if loaded`,
  async () => {
    if (launchctl(["print", `${domain}/${LABEL}`])) {
      launchctl(["bootout", `${domain}/${LABEL}`]);
      await waitFor(
        "launchd to unload the old agent",
        () => !launchctl(["print", `${domain}/${LABEL}`]),
      );
    }
  },
);

await step(`swap the staged copy in as ${appDir}`, () =>
  swapInStagedApp({ appDir, stagingDir }),
);

await step(`write the LaunchAgent ${plistPath}`, () => {
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    plistPath,
    buildLaunchAgentPlist({
      label: LABEL,
      nodePath,
      appDir,
      logPath,
      env: {
        K_BENCH_INSTANCE: "installed",
        K_BENCH_ALLOWED_LOGIN: identity.login,
        PATH: agentPath(),
        HOME: homedir(),
      },
    }),
  );
});

await step(
  `load the LaunchAgent (launchctl bootstrap, ${domain}) and wait for it to answer`,
  async () => {
    execFileSync("launchctl", ["bootstrap", domain, plistPath], { stdio: "inherit" });
    // Up and guarded: without a Tailscale-User-Login header the server answers 403.
    await waitFor("k-bench to answer on 127.0.0.1", async () => {
      try {
        return (await fetch(`http://127.0.0.1:${config.port}/api/state`)).status === 403;
      } catch {
        return false;
      }
    });
  },
);

const serveArgs = [
  "serve",
  "--bg",
  `--https=${HTTPS_PORT}`,
  `http://127.0.0.1:${config.port}`,
];
await step(`publish on the tailnet: ${tailscale} ${serveArgs.join(" ")}`, () => {
  execFileSync(tailscale, serveArgs, { stdio: "inherit" });
});

say(
  dryRun
    ? "\nDry run finished: nothing was changed."
    : `\nInstalled. Open https://${identity.dnsName}/ from a device on your tailnet.`,
);
