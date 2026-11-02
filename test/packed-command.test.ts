import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOGIN_HEADER } from "./harness/instance.ts";
import {
  cleanUpPacked,
  type PackedPackage,
  packedPackage,
  packedTempDir,
  runKBench,
  STUB_DNS_NAME,
  Stubs,
  serveStatusOf,
} from "./harness/packed.ts";
import { pollUntil } from "./harness/poll.ts";
import { testSocketName } from "./harness/socket-leaks.ts";

// Seam 3: the packed `k-bench` command, run as a process (docs/internals/test-seams.md).
let pkg: PackedPackage;
beforeAll(async () => {
  pkg = await packedPackage();
}, 300_000);
afterAll(cleanUpPacked);

describe("the packed k-bench command", () => {
  it("runs at all: compiled JavaScript, no TypeScript, nothing missing", () => {
    const result = runKBench(pkg, ["--version"], { stubs: new Stubs() });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("serves the built front end from the installed package's server", async () => {
    const dataDir = packedTempDir();
    const port = await freePort();
    const server = spawn(
      process.execPath,
      [join(pkg.packageDir, "dist/js/src/server/main.js")],
      {
        cwd: pkg.packageDir,
        env: {
          PATH: process.env.PATH,
          K_BENCH_DATA_DIR: dataDir,
          K_BENCH_PORT: String(port),
          K_BENCH_TMUX_SOCKET: testSocketName(),
          K_BENCH_ALLOWED_LOGIN: "owner@example.com",
        },
      },
    );
    let log = "";
    server.stdout.on("data", (chunk) => {
      log += chunk;
    });
    server.stderr.on("data", (chunk) => {
      log += chunk;
    });
    try {
      await pollUntil(() => log.includes("listening on"), {
        description: "the server to start",
      }).catch((error) => {
        throw new Error(`${error.message}\nserver output:\n${log}`);
      });
      // The startup line names the version, and the page is the real built front end.
      expect(log).toContain(pkg.version);
      const page = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { [LOGIN_HEADER]: "owner@example.com" },
      });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<div id="root">');
    } finally {
      server.kill("SIGTERM");
    }
  });

  describe("install --dry-run", () => {
    it("describes the install and changes nothing", () => {
      const stubs = new Stubs();
      const result = runKBench(
        pkg,
        ["install", "--dry-run", "--login", "owner@example.com"],
        {
          stubs,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("dry run");
      expect(result.stdout).toContain("owner@example.com");
      expect(result.stdout).toContain("--https=443");
      expect(result.stdout).toContain(join(result.home, "Library/LaunchAgents"));
      expect(readdirSync(result.home)).toEqual([]);
      expect(stubs.tailscaleWrites()).toEqual([]);
      expect(stubs.launchctlCalls()).toEqual([]);
    });

    it("fails when tmux is missing, even as a dry run", () => {
      const result = runKBench(pkg, ["install", "--dry-run"], {
        stubs: new Stubs({ tmux: false }),
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/tmux/);
    });

    it("ends with the URL k-bench is reachable at", () => {
      const result = runKBench(pkg, ["install", "--dry-run"], { stubs: new Stubs() });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`https://${STUB_DNS_NAME}/`);
    });
  });

  describe("install when the HTTPS port is already in use", () => {
    const elsewhere = serveStatusOf([443, "http://127.0.0.1:3000"]);
    const dryRun = (args: string[], serveStatus: unknown) => {
      const stubs = new Stubs({ tailscale: { serveStatus } });
      return {
        stubs,
        result: runKBench(pkg, ["install", "--dry-run", ...args], { stubs }),
      };
    };

    it("stops, names both ways out and changes nothing", () => {
      const { stubs, result } = dryRun([], elsewhere);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("http://127.0.0.1:3000");
      expect(result.stderr).toContain("--https-port");
      expect(result.stderr).toContain("--force");
      expect(result.stdout).not.toContain("would:");
      expect(readdirSync(result.home)).toEqual([]);
      expect(stubs.tailscaleWrites()).toEqual([]);
      expect(stubs.launchctlCalls()).toEqual([]);
    });

    it("goes ahead with --force", () => {
      const { result } = dryRun(["--force"], elsewhere);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("--https=443");
      expect(result.stdout).toContain(`https://${STUB_DNS_NAME}/`);
    });

    it("goes ahead on another port with --https-port, and says where it is", () => {
      const { result } = dryRun(["--https-port", "8443"], elsewhere);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("--https=8443");
      expect(result.stdout).toContain(`https://${STUB_DNS_NAME}:8443/`);
    });

    it("stops on the chosen port too, when that one is taken", () => {
      const { result } = dryRun(
        ["--https-port", "8443"],
        serveStatusOf([8443, "http://127.0.0.1:7690"]),
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("http://127.0.0.1:7690");
    });

    it("reinstalls over k-bench's own entry without --force", () => {
      const { result } = dryRun([], serveStatusOf([443, "http://127.0.0.1:7680"]));
      expect(result.status, result.stderr).toBe(0);
      // Its own entry is updated in place, not removed first.
      expect(result.stdout).not.toContain("remove what is on port");
    });

    it("rejects a port that is not a port", () => {
      const { result } = dryRun(["--https-port", "https"], {});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--https-port");
    });
  });
});

describe("the packed k-bench command: uninstall", () => {
  // k-bench published on 8443 beside another service on 443.
  const serveStatus = () => {
    const own = serveStatusOf([8443, "http://127.0.0.1:7680"]) as {
      TCP: object;
      Web: object;
    };
    const other = serveStatusOf([443, "http://127.0.0.1:3000"]) as typeof own;
    return { TCP: { ...own.TCP, ...other.TCP }, Web: { ...own.Web, ...other.Web } };
  };
  const installedStubs = () =>
    new Stubs({ launchctl: { loaded: true }, tailscale: { serveStatus: serveStatus() } });

  /** A HOME laid out as `k-bench install` leaves it. */
  function installedHome() {
    const home = packedTempDir();
    const dataDir = join(home, "Library/Application Support/k-bench");
    const paths = {
      plist: join(home, "Library/LaunchAgents/com.k-bench.server.plist"),
      app: join(dataDir, "app"),
      database: join(dataDir, "k-bench.db"),
      log: join(home, "Library/Logs/k-bench/k-bench.log"),
    };
    for (const file of [
      paths.plist,
      join(paths.app, "package.json"),
      paths.database,
      paths.log,
    ]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "x");
    }
    return { home, dataDir, ...paths };
  }

  const endedTmux = (stubs: Stubs) =>
    stubs.tmuxCalls().some((call) => call.includes("kill-server"));

  it("--dry-run says it removes the service and keeps the data, and changes nothing", () => {
    const { home, dataDir, ...paths } = installedHome();
    const stubs = installedStubs();
    const result = runKBench(pkg, ["uninstall", "--dry-run"], { stubs, home });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("dry run");
    expect(result.stdout).toContain("bootout");
    expect(result.stdout).toContain(paths.plist);
    expect(result.stdout).toContain(paths.app);
    expect(result.stdout).toMatch(/would keep/i);
    expect(result.stdout).toContain(dataDir);
    expect(result.stdout).not.toContain("kill-server");
    expect(result.stdout).toMatch(/Sessions? carry on/);
    // Only k-bench's own entry (8443) goes; the other service on 443 stays.
    expect(result.stdout).toContain("--https=8443 off");
    expect(result.stdout).not.toContain("--https=443");
    for (const path of Object.values(paths)) expect(existsSync(path), path).toBe(true);
    expect(stubs.tailscaleWrites()).toEqual([]);
    expect(stubs.launchctlCalls().every((call) => call.startsWith("print "))).toBe(true);
    expect(endedTmux(stubs)).toBe(false);
  });

  it("--purge --dry-run says it deletes the data and ends every Session, and changes nothing", () => {
    const { home, dataDir, ...paths } = installedHome();
    const stubs = installedStubs();
    const result = runKBench(pkg, ["uninstall", "--purge", "--dry-run"], {
      stubs,
      home,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/delete.*data/i);
    expect(result.stdout).toContain(dataDir);
    expect(result.stdout).toMatch(/ends? every Session/i);
    expect(result.stdout).toContain("kill-server");
    for (const path of Object.values(paths)) expect(existsSync(path), path).toBe(true);
    expect(stubs.tailscaleWrites()).toEqual([]);
    expect(endedTmux(stubs)).toBe(false);
  });

  it("--dry-run works, and says there is nothing to remove, when k-bench is not installed", () => {
    for (const args of [["--dry-run"], ["--purge", "--dry-run"]]) {
      const stubs = new Stubs();
      const result = runKBench(pkg, ["uninstall", ...args], { stubs });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/no LaunchAgent/i);
      expect(result.stdout).toMatch(/no tailscale serve entry/i);
      expect(result.stdout).toMatch(/no app folder/i);
      expect(readdirSync(result.home)).toEqual([]);
      expect(stubs.tailscaleWrites()).toEqual([]);
    }
  });

  it("removes the service but keeps the data and the Sessions; --purge removes the rest", () => {
    const { home, dataDir, ...paths } = installedHome();
    const stubs = installedStubs();
    const first = runKBench(pkg, ["uninstall"], { stubs, home });
    expect(first.status, first.stderr).toBe(0);
    expect(existsSync(paths.plist)).toBe(false);
    expect(existsSync(paths.app)).toBe(false);
    expect(existsSync(paths.database)).toBe(true);
    expect(
      stubs
        .launchctlCalls()
        .some((call) => /^bootout .*com\.k-bench\.server$/.test(call)),
    ).toBe(true);
    // The other service on 443 is left alone.
    expect(stubs.tailscaleWrites()).toEqual(["serve --https=8443 off"]);
    expect(endedTmux(stubs)).toBe(false);
    expect(first.stdout).toMatch(/kept/i);

    const purge = runKBench(pkg, ["uninstall", "--purge"], { stubs, home });
    expect(purge.status, purge.stderr).toBe(0);
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(paths.log)).toBe(false);
    expect(stubs.tmuxCalls()).toContain("-L k-bench kill-server");
  });
});

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}
