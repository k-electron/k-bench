// The packed `k-bench` command as a process: the real package, built with `npm pack`,
// installed into a throwaway prefix, and run with stub `tailscale`, `tmux` and `launchctl`
// programs first on PATH. See docs/internals/test-seams.md (Seam 3).
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const temporaryFolders: string[] = [];

/** A fresh temp folder, removed by `cleanUpPacked()`. */
export function packedTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-packed-"));
  temporaryFolders.push(dir);
  return dir;
}

export function cleanUpPacked(): void {
  packedPackagePromise = undefined;
  for (const dir of temporaryFolders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface PackedPackage {
  /** Where `npm install -g --prefix` put the package: the folder holding `dist/`. */
  packageDir: string;
  /** The installed `k-bench` command. */
  bin: string;
  /** The version in the package's package.json. */
  version: string;
}

function npm(args: string[], cwd: string): string {
  // A clean environment: running under pnpm leaves npm_config_* and npm_lifecycle_*
  // variables behind that change what npm does.
  const result = spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

let packedPackagePromise: Promise<PackedPackage> | undefined;

/**
 * Builds the package from this checkout, packs it and installs the tarball into a temp
 * prefix (never the real one), once per test process. The install fetches the package's
 * dependencies from the npm registry, as a stranger's `npm i -g` does, so it needs the
 * network and takes a while: call it from a `beforeAll` with a generous timeout.
 */
export function packedPackage(): Promise<PackedPackage> {
  packedPackagePromise ??= (async () => {
    const work = packedTempDir();
    const build = spawnSync("pnpm", ["build"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      // Vitest sets NODE_ENV=test, which would build React's development bundle.
      env: { ...process.env, NODE_ENV: "production" },
    });
    if (build.status !== 0) {
      throw new Error(`pnpm build failed:\n${build.stdout}\n${build.stderr}`);
    }
    // --ignore-scripts: `pnpm build` above already did what the package's prepack does.
    const packed = JSON.parse(
      npm(["pack", "--ignore-scripts", "--json", "--pack-destination", work], REPO_ROOT),
    ) as { filename: string }[];
    const tarball = join(work, packed[0]?.filename ?? "missing.tgz");
    const prefix = join(work, "prefix");
    npm(
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        tarball,
      ],
      work,
    );
    const packageDir = join(prefix, "lib/node_modules/@k-electron/k-bench");
    const version = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
      .version as string;
    return { packageDir, bin: join(prefix, "bin/k-bench"), version };
  })();
  return packedPackagePromise;
}

/** What a stub `tailscale` prints for `status --json` unless a test says otherwise. */
export const HEALTHY_TAILSCALE_STATUS = {
  Self: { UserID: 1, DNSName: "my-mac.example-tailnet.ts.net." },
  User: { "1": { LoginName: "owner@example.com" } },
};

export interface StubOptions {
  /** `false` leaves tmux off PATH. Default: present. */
  tmux?: boolean;
  /** `false` leaves tailscale off PATH. Default: present, logged in, serving nothing. */
  tailscale?:
    | false
    | {
        /** Printed by `tailscale status --json` (an object is stringified). */
        status?: unknown;
        /** Printed by `tailscale serve status --json`. */
        serveStatus?: unknown;
      };
  /** `false` leaves launchctl off PATH. `loaded` is whether `launchctl print` succeeds. */
  launchctl?: false | { loaded?: boolean };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * A folder of stub programs to put first on PATH, with bash 3.2-safe (plain `sh`) scripts.
 * - `tailscale` answers `status --json` and `serve status --json` from files a test can
 *   rewrite with `setStatus` and `setServeStatus`. Any other invocation is a change to the
 *   tailnet, and is recorded: `tailscaleWrites()`.
 * - `tmux` does nothing; `launchctl` records every call (`launchctlCalls()`).
 * - `node` is a link to the running Node, so `#!/usr/bin/env node` works with a PATH
 *   that holds nothing else (in particular, no real tmux or tailscale).
 */
export class Stubs {
  readonly dir = packedTempDir();

  constructor(options: StubOptions = {}) {
    const state = this.dir;
    symlinkSync(process.execPath, join(state, "node"));
    if (options.tmux !== false) this.script("tmux", "exit 0");
    if (options.tailscale !== false) {
      this.setStatus(options.tailscale?.status ?? HEALTHY_TAILSCALE_STATUS);
      this.setServeStatus(options.tailscale?.serveStatus ?? {});
      this.script(
        "tailscale",
        `case "$1" in
  status) cat '${state}/tailscale-status.json'; exit 0 ;;
  serve) if [ "$2" = status ]; then cat '${state}/tailscale-serve-status.json'; exit 0; fi ;;
esac
echo "$*" >> '${state}/tailscale-writes.log'`,
      );
    }
    if (options.launchctl !== false) {
      const loaded = options.launchctl?.loaded ?? false;
      this.script(
        "launchctl",
        `echo "$*" >> '${state}/launchctl.log'
if [ "$1" = print ]; then exit ${loaded ? 0 : 113}; fi`,
      );
    }
  }

  private script(name: string, body: string): void {
    const path = join(this.dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  }

  setStatus(status: unknown): void {
    writeFileSync(join(this.dir, "tailscale-status.json"), asText(status));
  }

  setServeStatus(serveStatus: unknown): void {
    writeFileSync(join(this.dir, "tailscale-serve-status.json"), asText(serveStatus));
  }

  private lines(file: string): string[] {
    const path = join(this.dir, file);
    return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  }

  /** The `tailscale` invocations that would have changed the tailnet, as argument lines. */
  tailscaleWrites(): string[] {
    return this.lines("tailscale-writes.log");
  }

  /** Every `launchctl` invocation, as argument lines. */
  launchctlCalls(): string[] {
    return this.lines("launchctl.log");
  }

  /** PATH for a `k-bench` process: the stubs, then only the system tools `env` needs. */
  get path(): string {
    return `${this.dir}:/usr/bin:/bin`;
  }
}

/**
 * Runs the packed `k-bench` with `args`. HOME is a fresh empty folder unless given, so the
 * command cannot touch the real machine; the environment holds nothing else.
 */
export function runKBench(
  pkg: PackedPackage,
  args: string[],
  options: { stubs: Stubs; home?: string; env?: Record<string, string> },
): SpawnSyncReturns<string> & { home: string } {
  const home = options.home ?? mkHome();
  const result = spawnSync(pkg.bin, args, {
    encoding: "utf8",
    env: { HOME: home, PATH: options.stubs.path, ...options.env },
  });
  return Object.assign(result, { home });
}

function mkHome(): string {
  const home = packedTempDir();
  mkdirSync(home, { recursive: true });
  return home;
}
