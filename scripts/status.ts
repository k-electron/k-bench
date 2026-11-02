// `k-bench status`: a one-command health check of the Installed instance. Each check prints
// as ok or FAIL, a failure with a one-line fix, and the exit status is non-zero when any
// check failed. It only looks: it never changes the machine, the tailnet or the app.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import { resolveConfig } from "../src/server/config.ts";
import {
  findExecutable,
  parseTailscaleStatus,
  resolveTailscaleCli,
} from "./install-lib.ts";
import { findOwnEntry, readServeConfig, serveUrl } from "./tailscale-serve.ts";

/** The LaunchAgent's label, as `k-bench install` loads it. */
const LABEL = "com.k-bench.server";
const LOG_HINT = "~/Library/Logs/k-bench/k-bench.log";
/** The header `tailscale serve` adds to every request it proxies; the server's login check. */
const LOGIN_HEADER = "Tailscale-User-Login";

type Check =
  | { name: string; result: "ok"; detail?: string }
  | { name: string; result: "fail"; problem: string; fix: string }
  | { name: string; result: "skip"; why: string };

const ok = (name: string, detail?: string): Check => ({ name, result: "ok", detail });
const fail = (name: string, problem: string, fix: string): Check => ({
  name,
  result: "fail",
  problem,
  fix,
});
const skip = (name: string, why: string): Check => ({ name, result: "skip", why });

/** What `tailscale status --json` says about the node's login and HTTPS certificates. */
function readTailscaleStatus(
  tailscale: string,
):
  | { running: true; json: string; certDomains: string[] }
  | { running: false; why: string } {
  let json: string;
  try {
    json = execFileSync(tailscale, ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return {
      running: false,
      why: "`tailscale status --json` failed (is Tailscale running?)",
    };
  }
  try {
    const parsed = JSON.parse(json) as { BackendState?: string; CertDomains?: string[] };
    if (parsed.BackendState !== "Running") {
      return {
        running: false,
        why: `Tailscale is not up and logged in (state: ${parsed.BackendState ?? "unknown"})`,
      };
    }
    return { running: true, json, certDomains: parsed.CertDomains ?? [] };
  } catch {
    return { running: false, why: "`tailscale status --json` did not print JSON" };
  }
}

/** Asks the running server's health check, as the owner when their login is known. */
async function checkServer(port: number, login: string | undefined): Promise<Check> {
  const name = "the server answers its health check";
  const notAnswering = fail(
    name,
    `nothing answered on 127.0.0.1:${port}`,
    `run \`k-bench install\` to start it again, or look in ${LOG_HINT} for why it stopped`,
  );
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: login ? { [LOGIN_HEADER]: login } : {},
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return notAnswering;
  }
  if (response.status === 200) {
    const body = (await response.json().catch(() => ({}))) as { status?: string };
    return body.status === "ok"
      ? ok(name)
      : fail(
          name,
          `127.0.0.1:${port} answered, but not like k-bench`,
          "something else is using the port: stop it, then run `k-bench install`",
        );
  }
  if (response.status === 403) {
    // Up, and guarded. Without a login there was nothing more to ask.
    return login
      ? fail(
          name,
          `the server is up but refused the login ${login}`,
          "run `k-bench install` to set the allowed login again",
        )
      : ok(name, "up (could not ask as the owner: no Tailscale login)");
  }
  return fail(
    name,
    `the server answered HTTP ${response.status}`,
    `look in ${LOG_HINT}, then run \`k-bench install\``,
  );
}

/** The version `k-bench install` recorded in the installed app, e.g. `0.1.0`. */
function installedVersion(appDir: string): string | undefined {
  try {
    const info = JSON.parse(readFileSync(join(appDir, "build-info.json"), "utf8")) as {
      version?: string;
      commit?: string;
      dirty?: boolean;
    };
    if (!info.version) return undefined;
    const commit = info.commit
      ? ` (commit ${info.commit.slice(0, 7)}${info.dirty ? "+uncommitted" : ""})`
      : "";
    return `${info.version}${commit}`;
  } catch {
    return undefined;
  }
}

export async function status(argv: string[]): Promise<void> {
  parseArgs({ args: argv, options: {}, allowPositionals: false });

  // Explicit env: status describes the Installed instance, whatever the shell has set. The
  // one override, K_BENCH_STATUS_PORT, is for the tests, to ask a throwaway server instead
  // of the one on the Installed instance's port.
  const config = resolveConfig({ K_BENCH_INSTANCE: "installed" });
  const override = process.env.K_BENCH_STATUS_PORT;
  const port = override && /^\d+$/.test(override) ? Number(override) : config.port;
  const appDir = join(config.dataDir, "app");
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

  const checks: Check[] = [];

  const tmux = findExecutable("tmux", pathDirs);
  checks.push(
    tmux
      ? ok("tmux is found", tmux)
      : fail(
          "tmux is found",
          "tmux is not on PATH",
          "install it with `brew install tmux`",
        ),
  );

  const tailscale = resolveTailscaleCli({ pathDirs });
  let login: string | undefined;
  let dnsName: string | undefined;
  let loggedIn = false;
  if (!tailscale) {
    checks.push(
      fail(
        "the Tailscale CLI is found",
        "the Tailscale CLI is on neither PATH nor inside /Applications/Tailscale.app",
        "install Tailscale from https://tailscale.com/download",
      ),
      skip("Tailscale is logged in", "needs the Tailscale CLI"),
      skip("HTTPS certificates are available", "needs the Tailscale CLI"),
    );
  } else {
    checks.push(ok("the Tailscale CLI is found", tailscale));
    const tailscaleStatus = readTailscaleStatus(tailscale);
    if (!tailscaleStatus.running) {
      checks.push(
        fail(
          "Tailscale is logged in",
          tailscaleStatus.why,
          "open the Tailscale app and log in or turn it on (or run `tailscale up`)",
        ),
        skip("HTTPS certificates are available", "needs a logged-in Tailscale"),
      );
    } else {
      loggedIn = true;
      try {
        ({ login, dnsName } = parseTailscaleStatus(tailscaleStatus.json));
      } catch {
        // A running node with no readable owner: the server is still asked, without a login.
      }
      checks.push(ok("Tailscale is logged in", login));
      checks.push(
        tailscaleStatus.certDomains.length > 0
          ? ok("HTTPS certificates are available", tailscaleStatus.certDomains[0])
          : fail(
              "HTTPS certificates are available",
              "HTTPS certificates are not turned on for your tailnet",
              "turn on HTTPS Certificates at https://login.tailscale.com/admin/dns",
            ),
      );
    }
  }

  const uid = process.getuid?.() ?? 501;
  const loaded =
    spawnSync("launchctl", ["print", `gui/${uid}/${LABEL}`], { stdio: "ignore" })
      .status === 0;
  checks.push(
    loaded
      ? ok("the LaunchAgent is loaded", LABEL)
      : fail(
          "the LaunchAgent is loaded",
          `${LABEL} is not loaded in launchd`,
          "run `k-bench install` to install and load it",
        ),
  );

  checks.push(await checkServer(port, login));

  // What the checks don't say: the version installed and where it is reachable.
  const version = installedVersion(appDir);
  let url: string;
  if (!tailscale || !loggedIn || !dnsName) {
    url = "unknown (needs a logged-in Tailscale)";
  } else {
    try {
      const own = findOwnEntry(readServeConfig(tailscale), port);
      url = own
        ? serveUrl(dnsName, own.port)
        : "not published on the tailnet (run `k-bench install`)";
    } catch (error) {
      url = `unknown (${(error as Error).message})`;
    }
  }

  console.log("k-bench status\n");
  for (const check of checks) {
    if (check.result === "ok") {
      console.log(`  ok    ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
    } else if (check.result === "skip") {
      console.log(`  skip  ${check.name} (${check.why})`);
    } else {
      console.log(`  FAIL  ${check.name}: ${check.problem}`);
      console.log(`        fix: ${check.fix}`);
    }
  }
  console.log(
    `\n  version  ${version ?? (existsSync(appDir) ? "unknown" : "not installed (run `k-bench install`)")}`,
  );
  console.log(`  url      ${url}\n`);

  const failed = checks.filter((check) => check.result === "fail").length;
  if (failed > 0) {
    console.log(`${failed} of ${checks.length} checks failed.`);
    process.exit(1);
  }
  console.log("All checks passed.");
}
