// The pure parts of the install: nothing in here talks to launchd or Tailscale. Every path
// and command is an argument, so `test/install.test.ts` can check them in temporary folders.
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Where the Tailscale macOS app keeps its command-line tool. */
export const TAILSCALE_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The first executable file called `name` in `dirs`, like `which`. */
export function findExecutable(name: string, dirs: string[]): string | undefined {
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

/** `tailscale` from PATH, else the CLI inside Tailscale.app, else undefined. */
export function resolveTailscaleCli(options: {
  pathDirs: string[];
  appBundleCli?: string;
}): string | undefined {
  const onPath = findExecutable("tailscale", options.pathDirs);
  if (onPath) return onPath;
  const app = options.appBundleCli ?? TAILSCALE_APP_CLI;
  return isExecutableFile(app) ? app : undefined;
}

/**
 * What to tell the owner when the running Node is older than the package's `engines.node`
 * (a `>=<major>` range), which npm only warns about. Undefined when it is new enough.
 */
export function nodeVersionProblem(
  running: string,
  engines?: string,
): string | undefined {
  const required = Number(/\d+/.exec(engines ?? "")?.[0]);
  if (!Number.isInteger(required) || Number(running.split(".")[0]) >= required) {
    return undefined;
  }
  return `Node ${running} is too old: k-bench needs Node ${required} or later. Install a current Node (for example \`brew install node\`), then run \`k-bench install\` again.`;
}

export interface TailscaleIdentity {
  /** The tailnet login of the user this node belongs to. */
  login: string;
  /** This node's tailnet name, e.g. `host.tailnet.ts.net` (no trailing dot). */
  dnsName: string;
}

/** Reads the output of `tailscale status --json`. */
export function parseTailscaleStatus(json: string): TailscaleIdentity {
  const status = JSON.parse(json) as {
    Self?: { UserID?: number; DNSName?: string };
    User?: Record<string, { LoginName?: string }>;
  };
  const userId = status.Self?.UserID;
  const login =
    userId === undefined ? undefined : status.User?.[String(userId)]?.LoginName;
  if (!login) {
    throw new Error(
      "Could not read your tailnet login from `tailscale status --json`. Is Tailscale running and logged in?",
    );
  }
  return { login, dnsName: (status.Self?.DNSName ?? "").replace(/\.$/, "") };
}

function xml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The compiled server, relative to the app folder (and to the package root). */
export const SERVER_ENTRY = "dist/js/src/server/main.js";

/**
 * The LaunchAgent for the Installed instance.
 * - `RunAtLoad` and `KeepAlive`: starts at login and after a crash.
 * - `AbandonProcessGroup`: when launchd stops the server it must not kill the rest of the
 *   job's process group, which is where tmux (and so every Session) may live (ADR-0001).
 */
export function buildLaunchAgentPlist(options: {
  label: string;
  nodePath: string;
  appDir: string;
  logPath: string;
  env: Record<string, string>;
}): string {
  const env = Object.entries(options.env)
    .map(
      ([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.nodePath)}</string>
    <string>${xml(join(options.appDir, SERVER_ENTRY))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(options.appDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(options.logPath)}</string>
</dict>
</plist>
`;
}

/**
 * What the installed app copies from the package: the compiled server (with the modules it
 * shares with the browser), the built front end, and the script that restores node-pty's
 * spawn-helper execute bit. Its package.json is generated: see `appManifest`.
 */
const APP_FILES = ["dist/js/src", "dist/web", "scripts/fix-node-pty.mjs"];

/** The nearest folder at or above `start` that holds a package.json. */
export function findPackageRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) throw new Error(`no package.json at or above ${start}`);
  }
}

/**
 * The installed app's package.json: only what its dependencies and `engines` need, so that
 * installing them in the app folder runs none of the package's own scripts.
 */
export function appManifest(pkg: {
  version?: string;
  engines?: unknown;
  dependencies?: Record<string, string>;
}): Record<string, unknown> {
  return {
    name: "k-bench-app",
    private: true,
    version: pkg.version,
    type: "module",
    engines: pkg.engines,
    dependencies: pkg.dependencies,
  };
}

/**
 * Copies the app files from the package (the npm package, or a built checkout) into a fresh
 * `stagingDir` (replacing any leftovers), with `manifest` as its package.json.
 */
export function stageApp(options: {
  packageDir: string;
  stagingDir: string;
  manifest: Record<string, unknown>;
}): void {
  for (const built of ["dist/web/index.html", SERVER_ENTRY]) {
    if (!existsSync(join(options.packageDir, built))) {
      throw new Error(`${built} has not been built: run \`pnpm build\` first.`);
    }
  }
  rmSync(options.stagingDir, { recursive: true, force: true });
  for (const file of APP_FILES) {
    const target = join(options.stagingDir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(options.packageDir, file), target, { recursive: true });
  }
  writeFileSync(
    join(options.stagingDir, "package.json"),
    `${JSON.stringify(options.manifest, null, 2)}\n`,
  );
}

/**
 * Makes the staged copy the app. Two renames, so a running server never sees a half-written
 * app folder; the previous app is deleted afterwards. Only the two app folders are touched.
 */
export function swapInStagedApp(options: { appDir: string; stagingDir: string }): void {
  const previous = `${options.appDir}.previous`;
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(options.appDir)) renameSync(options.appDir, previous);
  renameSync(options.stagingDir, options.appDir);
  rmSync(previous, { recursive: true, force: true });
}

/**
 * Reasons the native node-pty build under `appDir/node_modules` would not work. pnpm
 * installs its `spawn-helper` without the execute bit, which makes every pty.spawn fail.
 */
export function nodePtyProblems(appDir: string): string[] {
  const root = join(appDir, "node_modules/node-pty");
  if (!existsSync(root)) return [`node-pty is not installed in ${appDir}/node_modules`];
  const problems: string[] = [];
  const prebuilds = join(root, "prebuilds");
  const platforms = existsSync(prebuilds) ? readdirSync(prebuilds) : [];
  if (platforms.length === 0 && !existsSync(join(root, "build/Release/pty.node"))) {
    problems.push("node-pty has no native build (prebuilds/ or build/Release/pty.node)");
  }
  for (const platform of platforms) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper) && !isExecutableFile(helper)) {
      problems.push(`${helper} is not executable`);
    }
  }
  return problems;
}
