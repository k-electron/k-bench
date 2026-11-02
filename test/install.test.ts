import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLaunchAgentPlist,
  findExecutable,
  nodePtyProblems,
  parseTailscaleStatus,
  resolveTailscaleCli,
  stageApp,
  swapInStagedApp,
} from "../scripts/install-lib.ts";

const temporaryFolders: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-install-"));
  temporaryFolders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temporaryFolders.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content = "", mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
}

interface ParsedPlist {
  RunAtLoad: boolean;
  KeepAlive: boolean;
  AbandonProcessGroup: boolean;
  ProgramArguments: string[];
  WorkingDirectory: string;
  EnvironmentVariables: Record<string, string>;
}

/** The plist as macOS's own tooling reads it, not as text. */
function readPlist(xml: string): ParsedPlist {
  const file = join(tempDir(), "agent.plist");
  writeFileSync(file, xml);
  const json = execFileSync("plutil", ["-convert", "json", "-o", "-", file], {
    encoding: "utf8",
  });
  return JSON.parse(json);
}

describe.skipIf(process.platform !== "darwin")("the LaunchAgent plist", () => {
  const appDir = "/Users/me/Library/Application Support/k-bench/app";
  const env = {
    K_BENCH_INSTANCE: "installed",
    K_BENCH_ALLOWED_LOGIN: "me@example.com",
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    HOME: "/Users/me",
  };
  const plist = () =>
    readPlist(
      buildLaunchAgentPlist({
        label: "com.k-bench.server",
        nodePath: "/opt/homebrew/bin/node",
        appDir,
        logPath: "/Users/me/Library/Logs/k-bench/k-bench.log",
        env,
      }),
    );

  it("starts at login, restarts after a crash and leaves tmux alone when stopped", () => {
    expect(plist()).toMatchObject({
      RunAtLoad: true,
      KeepAlive: true,
      AbandonProcessGroup: true,
    });
  });

  it("runs the installed copy with an absolute Node path from the app folder", () => {
    const { ProgramArguments, WorkingDirectory } = plist();
    expect(ProgramArguments).toEqual([
      "/opt/homebrew/bin/node",
      `${appDir}/src/server/main.ts`,
    ]);
    expect(WorkingDirectory).toBe(appDir);
  });

  it("gives the server the installed instance's environment", () => {
    expect(plist().EnvironmentVariables).toEqual(env);
  });

  it("survives characters that are special in XML", () => {
    const login = `a&b<c>"d'@example.com`;
    const parsed = readPlist(
      buildLaunchAgentPlist({
        label: "com.k-bench.server",
        nodePath: "/usr/local/bin/node",
        appDir: "/a & b/app",
        logPath: "/tmp/log",
        env: { K_BENCH_ALLOWED_LOGIN: login },
      }),
    );
    expect(parsed.EnvironmentVariables.K_BENCH_ALLOWED_LOGIN).toBe(login);
    expect(parsed.WorkingDirectory).toBe("/a & b/app");
  });
});

describe("reading tailscale status --json", () => {
  const status = JSON.stringify({
    Self: { UserID: 222, DNSName: "my-mac.tail1234.ts.net.", HostName: "my-mac" },
    User: {
      "111": { ID: 111, LoginName: "friend@example.com" },
      "222": { ID: 222, LoginName: "owner@example.com" },
    },
  });

  it("takes the login of this node's own user, not another user on the tailnet", () => {
    expect(parseTailscaleStatus(status).login).toBe("owner@example.com");
  });

  it("gives the tailnet name without the trailing dot", () => {
    expect(parseTailscaleStatus(status).dnsName).toBe("my-mac.tail1234.ts.net");
  });

  it("refuses output that does not say who this node belongs to", () => {
    expect(() => parseTailscaleStatus(JSON.stringify({ Self: {}, User: {} }))).toThrow(
      /login/i,
    );
    expect(() => parseTailscaleStatus("not json")).toThrow();
  });
});

describe("finding the Tailscale CLI", () => {
  it("prefers the one on PATH", () => {
    const onPath = tempDir();
    const app = join(tempDir(), "Tailscale");
    write(join(onPath, "tailscale"), "#!/bin/sh\n", 0o755);
    write(app, "#!/bin/sh\n", 0o755);
    expect(resolveTailscaleCli({ pathDirs: [onPath], appBundleCli: app })).toBe(
      join(onPath, "tailscale"),
    );
  });

  it("falls back to the CLI inside Tailscale.app", () => {
    const empty = tempDir();
    const app = join(tempDir(), "Tailscale");
    write(app, "#!/bin/sh\n", 0o755);
    expect(resolveTailscaleCli({ pathDirs: [empty], appBundleCli: app })).toBe(app);
  });

  it("reports nothing when neither exists or the file is not executable", () => {
    const dir = tempDir();
    write(join(dir, "tailscale"), "", 0o644);
    expect(
      resolveTailscaleCli({ pathDirs: [dir], appBundleCli: join(dir, "missing") }),
    ).toBeUndefined();
  });

  it("finds any command by name, skipping directories", () => {
    const first = tempDir();
    const second = tempDir();
    mkdirSync(join(first, "tmux"));
    write(join(second, "tmux"), "", 0o755);
    expect(findExecutable("tmux", [first, second])).toBe(join(second, "tmux"));
  });
});

describe("installing the app files", () => {
  function fakeRepo(version: string): string {
    const repo = tempDir();
    write(join(repo, "src/server/main.ts"), `main ${version}`);
    write(join(repo, "src/server/app.ts"), `app ${version}`);
    write(join(repo, "src/shared/terminal-protocol.ts"), `protocol ${version}`);
    write(join(repo, "dist/web/index.html"), `<html>${version}</html>`);
    write(join(repo, "package.json"), "{}");
    write(join(repo, "pnpm-lock.yaml"), "lock");
    write(join(repo, "pnpm-workspace.yaml"), "allowBuilds:\n  node-pty: true\n");
    write(join(repo, "scripts/fix-node-pty.mjs"), "// fix");
    write(join(repo, "scripts/install.ts"), "// not part of the app");
    write(join(repo, "test/other.test.ts"), "// not part of the app");
    write(join(repo, ".data/secret.db"), "dev data");
    return repo;
  }

  it("stages the server, built assets and install manifest, and nothing else", () => {
    const staged = join(tempDir(), "app.staging");
    stageApp({ repoDir: fakeRepo("1"), stagingDir: staged });
    expect(readFileSync(join(staged, "src/server/main.ts"), "utf8")).toBe("main 1");
    // The server imports the terminal protocol it shares with the browser.
    expect(readFileSync(join(staged, "src/shared/terminal-protocol.ts"), "utf8")).toBe(
      "protocol 1",
    );
    expect(readFileSync(join(staged, "dist/web/index.html"), "utf8")).toBe(
      "<html>1</html>",
    );
    for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
      expect(existsSync(join(staged, file))).toBe(true);
    }
    expect(existsSync(join(staged, "scripts/fix-node-pty.mjs"))).toBe(true);
    expect(existsSync(join(staged, "scripts/install.ts"))).toBe(false);
    expect(existsSync(join(staged, "test"))).toBe(false);
    expect(existsSync(join(staged, ".data"))).toBe(false);
  });

  it("starts from a clean staging folder", () => {
    const staged = join(tempDir(), "app.staging");
    write(join(staged, "leftover-from-a-failed-run"), "x");
    stageApp({ repoDir: fakeRepo("1"), stagingDir: staged });
    expect(existsSync(join(staged, "leftover-from-a-failed-run"))).toBe(false);
  });

  it("fails clearly when the front end has not been built", () => {
    const repo = fakeRepo("1");
    rmSync(join(repo, "dist"), { recursive: true });
    expect(() => stageApp({ repoDir: repo, stagingDir: join(tempDir(), "s") })).toThrow(
      /pnpm build/,
    );
  });

  it("an update replaces the app and leaves the rest of the data folder alone", () => {
    const dataDir = tempDir();
    write(join(dataDir, "k-bench.db"), "the owner's workspaces");
    const appDir = join(dataDir, "app");
    const staging = join(dataDir, "app.staging");

    stageApp({ repoDir: fakeRepo("1"), stagingDir: staging });
    swapInStagedApp({ appDir, stagingDir: staging });
    expect(readFileSync(join(appDir, "src/server/main.ts"), "utf8")).toBe("main 1");

    stageApp({ repoDir: fakeRepo("2"), stagingDir: staging });
    swapInStagedApp({ appDir, stagingDir: staging });

    expect(readFileSync(join(appDir, "src/server/main.ts"), "utf8")).toBe("main 2");
    expect(readFileSync(join(dataDir, "k-bench.db"), "utf8")).toBe(
      "the owner's workspaces",
    );
    expect(readdirSync(dataDir).sort()).toEqual(["app", "k-bench.db"]);
  });
});

describe("the native node-pty build", () => {
  function fakePty(helperMode: number): string {
    const root = tempDir();
    const prebuilds = join(root, "node_modules/node-pty/prebuilds/darwin-arm64");
    write(join(root, "node_modules/node-pty/package.json"), "{}");
    write(join(prebuilds, "spawn-helper"), "", helperMode);
    write(join(prebuilds, "pty.node"), "");
    return root;
  }

  it("reports a spawn-helper that lost its execute bit", () => {
    expect(nodePtyProblems(fakePty(0o644)).join("\n")).toMatch(/spawn-helper/);
  });

  it("accepts an executable spawn-helper", () => {
    expect(nodePtyProblems(fakePty(0o755))).toEqual([]);
  });

  it("reports node-pty missing altogether", () => {
    expect(nodePtyProblems(tempDir()).join("\n")).toMatch(/node-pty/);
  });
});

describe("pnpm install-app --dry-run", () => {
  function run(home: string, path: string) {
    return spawnSync(
      process.execPath,
      ["scripts/install.ts", "--dry-run", "--login", "owner@example.com"],
      { encoding: "utf8", env: { HOME: home, PATH: path } },
    );
  }

  it("describes the install and changes nothing", () => {
    const home = tempDir();
    const bin = tempDir();
    write(join(bin, "tailscale"), "#!/bin/sh\necho ran > $HOME/ran\n", 0o755);
    write(join(bin, "tmux"), "#!/bin/sh\n", 0o755);
    const result = run(home, `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("dry run");
    expect(result.stdout).toContain("owner@example.com");
    expect(result.stdout).toContain("--https=443");
    expect(result.stdout).toContain(join(home, "Library/LaunchAgents"));
    expect(readdirSync(home)).toEqual([]);
  });

  it("fails when tmux is missing, even as a dry run", () => {
    const bin = tempDir();
    write(join(bin, "tailscale"), "", 0o755);
    const result = run(tempDir(), bin);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/tmux/);
  });
});
