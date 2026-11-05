// `k-bench install`: installs k-bench as the Installed instance (ADR-0001, ADR-0003), from
// the npm package or, as `pnpm install-app`, from a checkout. Safe to re-run: it updates the
// app in place, and running Sessions live in tmux, outside this server's process group, so
// they carry on. `--dry-run` prints the plan and changes nothing; `--login <login>` skips
// reading it from Tailscale. It publishes on HTTPS port 443, or `--https-port <n>`, and
// refuses (before changing anything) when that port already serves something other than
// k-bench, unless `--force`.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { resolveConfig } from "../src/server/config.ts";
import {
  appDirIn,
  BUILD_INFO_FILE,
  LAUNCH_AGENT_LABEL,
  launchAgentPlistPath,
  launchdDomain,
  logPath,
  pathDirs as pathDirsOf,
  reporter,
  succeeds,
} from "./command-lib.ts";
import {
  appManifest,
  buildLaunchAgentPlist,
  findExecutable,
  findPackageRoot,
  nodePtyProblems,
  nodeVersionProblem,
  parseTailscaleStatus,
  resolveTailscaleCli,
  stageApp,
  swapInStagedApp,
} from "./install-lib.ts";
import {
  DEFAULT_HTTPS_PORT,
  portUse,
  readServeConfig,
  serveOffArgs,
  servePublishArgs,
  serveUrl,
} from "./tailscale-serve.ts";

export async function install(argv: string[]): Promise<void> {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      login: { type: "string" },
      "https-port": { type: "string", default: String(DEFAULT_HTTPS_PORT) },
      force: { type: "boolean", default: false },
    },
  });
  const dryRun = flags["dry-run"];
  const httpsPortText = flags["https-port"];
  const httpsPort = Number(httpsPortText);

  function fail(message: string): never {
    console.error(`k-bench install: ${message}`);
    process.exit(1);
  }

  // The npm package, or the checkout: where the files to install come from. Its `engines`
  // are checked before anything else, in a dry run too, because npm only warns about them.
  const packageDir = findPackageRoot(import.meta.dirname);
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const nodeProblem = nodeVersionProblem(process.versions.node, pkg.engines?.node);
  if (nodeProblem) fail(nodeProblem);

  if (!/^\d+$/.test(httpsPortText) || httpsPort < 1 || httpsPort > 65535) {
    fail(`--https-port needs a port number from 1 to 65535, not "${httpsPortText}".`);
  }

  const { say, step } = reporter(dryRun);

  // Explicit env: the install must never pick up a K_BENCH_* override from the shell.
  const config = resolveConfig({ K_BENCH_INSTANCE: "installed" });
  // A checkout has the TypeScript source (the package ships only compiled JavaScript), and
  // so can be built and asked for its git commit.
  const fromCheckout = existsSync(join(packageDir, "src/server/main.ts"));
  const appDir = appDirIn(config.dataDir);
  const stagingDir = join(config.dataDir, "app.staging");
  const logFile = logPath();
  const plistPath = launchAgentPlistPath();
  const domain = launchdDomain();

  // Prerequisites. These are read-only checks, so they run in a dry run too.
  const pathDirs = pathDirsOf();
  const tmux = findExecutable("tmux", pathDirs);
  if (!tmux) fail("tmux not found. Install it with `brew install tmux`.");
  const tailscale = resolveTailscaleCli({ pathDirs });
  if (!tailscale) {
    fail(
      "the Tailscale CLI was not found on PATH or inside /Applications/Tailscale.app.",
    );
  }

  // Read before anything is done: if the port is taken by someone else's setup, the install
  // stops here, having changed nothing.
  let serveConfig: ReturnType<typeof readServeConfig>;
  try {
    serveConfig = readServeConfig(tailscale);
  } catch (error) {
    fail((error as Error).message);
  }
  const occupant = portUse(serveConfig, httpsPort, config.port);
  if (occupant.kind === "other" && !flags.force) {
    const what = occupant.entry.targets.map((target) => `  ${target.description}`);
    fail(
      `HTTPS port ${httpsPort} already serves something other than k-bench:\n${what.join("\n")}\n` +
        "Nothing was changed. Publish k-bench on another port with `--https-port <n>` " +
        `(for example \`--https-port 8443\`), or replace what is on port ${httpsPort} with \`--force\`.`,
    );
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

  const launchctl = (args: string[]) => succeeds("launchctl", args);

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
  say(`  version    ${pkg.version}${fromCheckout ? " (checkout)" : ""}`);
  say(`  node       ${nodePath}`);
  say(`  tmux       ${tmux}`);
  say(`  tailscale  ${tailscale}`);
  say(`  app        ${appDir}`);
  say(
    `  data       ${config.dataDir} (tmux socket "${config.tmuxSocket}", port ${config.port})`,
  );
  say(`  agent      ${plistPath}`);
  say(`  log        ${logFile}\n`);

  // The login the server admits, and the name the URL is built from. A dry run only looks,
  // so it carries on with placeholders when Tailscale can't say.
  let identity = {
    login: flags.login ?? "<your login, read from `tailscale status --json`>",
    dnsName: "<this machine's tailnet name>",
  };
  try {
    const status = parseTailscaleStatus(
      execFileSync(tailscale, ["status", "--json"], { encoding: "utf8" }),
    );
    identity = { login: flags.login ?? status.login, dnsName: status.dnsName };
  } catch (error) {
    if (!dryRun) fail((error as Error).message);
  }
  say(`allowed login: ${identity.login}\n`);

  if (fromCheckout) {
    await step("build the server and the front end (pnpm build)", () => {
      execFileSync("pnpm", ["build"], { cwd: packageDir, stdio: "inherit" });
    });
  }

  await step(`copy the server and built assets into ${stagingDir}`, () =>
    stageApp({ packageDir, stagingDir, manifest: appManifest(pkg) }),
  );

  await step(
    fromCheckout
      ? `record the installed version and commit in ${BUILD_INFO_FILE}`
      : `record the installed version in ${BUILD_INFO_FILE}`,
    () => {
      const git = (args: string[]) =>
        execFileSync("git", args, { cwd: packageDir, encoding: "utf8" }).trim();
      const buildInfo = {
        version: pkg.version,
        ...(fromCheckout && {
          commit: git(["rev-parse", "HEAD"]),
          // Uncommitted changes were installed too, so the commit alone doesn't describe it.
          dirty: git(["status", "--porcelain"]) !== "",
        }),
        installedAt: new Date().toISOString(),
      };
      writeFileSync(
        join(stagingDir, BUILD_INFO_FILE),
        `${JSON.stringify(buildInfo, null, 2)}\n`,
      );
    },
  );

  await step("install production dependencies there (npm install --omit=dev)", () => {
    const npm = findExecutable("npm", pathDirs);
    if (!npm) fail("npm not found on PATH. It comes with Node.");
    // Not inside pnpm's or npm's own run: their npm_* variables would change what npm does.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("npm_")),
    );
    execFileSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: stagingDir,
      stdio: "inherit",
      env,
    });
    execFileSync(process.execPath, ["scripts/fix-node-pty.mjs"], {
      cwd: stagingDir,
      stdio: "inherit",
    });
    const problems = nodePtyProblems(stagingDir);
    if (problems.length > 0) fail(`node-pty is not usable:\n  ${problems.join("\n  ")}`);
  });

  // The old server stops before its folder is replaced: otherwise it would keep running from
  // a deleted directory, and KeepAlive could restart it against a half-swapped tree. Stopping
  // the agent leaves tmux, and so every Session, running (AbandonProcessGroup, ADR-0001).
  await step(
    `stop the running LaunchAgent (launchctl bootout, ${domain}), if loaded`,
    async () => {
      if (launchctl(["print", `${domain}/${LAUNCH_AGENT_LABEL}`])) {
        launchctl(["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`]);
        await waitFor(
          "launchd to unload the old agent",
          () => !launchctl(["print", `${domain}/${LAUNCH_AGENT_LABEL}`]),
        );
      }
    },
  );

  await step(`swap the staged copy in as ${appDir}`, () =>
    swapInStagedApp({ appDir, stagingDir }),
  );

  await step(`write the LaunchAgent ${plistPath}`, () => {
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(
      plistPath,
      buildLaunchAgentPlist({
        label: LAUNCH_AGENT_LABEL,
        nodePath,
        appDir,
        logPath: logFile,
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
          return (
            (await fetch(`http://127.0.0.1:${config.port}/api/state`)).status === 403
          );
        } catch {
          return false;
        }
      });
    },
  );

  if (occupant.kind === "other") {
    const offArgs = serveOffArgs(occupant.entry);
    await step(
      `remove what is on port ${httpsPort} (--force): ${tailscale} ${offArgs.join(" ")}`,
      () => {
        execFileSync(tailscale, offArgs, { stdio: "inherit" });
      },
    );
  }
  const serveArgs = servePublishArgs(httpsPort, config.port);
  await step(`publish on the tailnet: ${tailscale} ${serveArgs.join(" ")}`, () => {
    execFileSync(tailscale, serveArgs, { stdio: "inherit" });
  });

  const url = serveUrl(identity.dnsName, httpsPort);
  say(
    dryRun
      ? `\nDry run finished: nothing was changed. k-bench would be reachable at ${url}`
      : `\nInstalled. Open ${url} from a device on your tailnet.`,
  );
}
