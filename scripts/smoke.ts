// `pnpm smoke`: builds the front end and runs the production server against a throwaway
// instance (temp data folder, its own tmux socket, a free port). It probes the access guard,
// the built page, the API and a terminal, then tears everything down. Use it instead of
// starting `pnpm start` or Vite in the background by hand: everything it starts runs in this
// process or on its own tmux socket, and is cleaned up however the script ends.
//
//   pnpm smoke                 probe, clean up, exit (non-zero if a probe fails)
//   pnpm smoke --hold          probe, then keep the server up for manual requests until
//                              Ctrl-C or --minutes (default 10) pass, then clean up
//   pnpm smoke --no-build      reuse the existing dist/web
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { LOGIN_HEADER, TestInstance } from "../test/harness/instance.ts";
import { tmuxSocketDir } from "../test/harness/socket-leaks.ts";
import { echoCommand } from "../test/harness/terminal.ts";

const { values: flags } = parseArgs({
  options: {
    hold: { type: "boolean", default: false },
    minutes: { type: "string", default: "10" },
    "no-build": { type: "boolean", default: false },
  },
});
const SOCKET_PREFIX = "kb-test-smoke-";

/** Removes tmux servers left by an earlier smoke run that was killed before cleaning up. */
function removeStaleSmokeSockets(): void {
  let names: string[] = [];
  try {
    names = readdirSync(tmuxSocketDir()).filter((name) => name.startsWith(SOCKET_PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    try {
      execFileSync("tmux", ["-L", name, "kill-server"], { stdio: "ignore" });
    } catch {
      // Server already gone.
    }
    rmSync(resolve(tmuxSocketDir(), name), { force: true });
    console.log(`removed a stale smoke socket: ${name}`);
  }
}

function check(condition: boolean, what: string): void {
  console.log(`${condition ? "ok  " : "FAIL"} ${what}`);
  if (!condition) process.exitCode = 1;
}

removeStaleSmokeSockets();
if (!flags["no-build"]) {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    stdio: "inherit",
  });
}
const webDir = resolve("dist/web");
if (!existsSync(resolve(webDir, "index.html"))) {
  console.error("smoke: dist/web has not been built (drop --no-build)");
  process.exit(1);
}

const instance = new TestInstance({
  tmuxSocket: `${SOCKET_PREFIX}${process.pid}`,
  allowedLogin: "smoke@k-bench.local",
});
let cleaned = false;
async function cleanUp(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  await instance.dispose();
  console.log("cleaned up: server stopped, tmux socket and temp data removed");
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    void cleanUp().then(() => process.exit(process.exitCode ?? 0));
  });
}

try {
  const server = await instance.start({ webDir });
  console.log(
    `smoke instance at ${server.baseUrl} (tmux socket ${instance.config.tmuxSocket})`,
  );

  const anonymous = await fetch(new URL("/api/state", server.baseUrl));
  check(anonymous.status === 403, "a request without the login header is refused (403)");

  const page = await server.request("/");
  check(
    page.status === 200 && (page.headers.get("content-type") ?? "").includes("text/html"),
    "the built page is served",
  );

  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  const session = await server.createSession(workspace.id);
  const state = await server.state();
  const listed = state.workspaces
    .find((w) => w.id === workspace.id)
    ?.sessions.find((s) => s.id === session.id);
  check(listed?.status === "running", "a new Session is listed as running");

  const terminal = await server.openTerminal(session.id);
  const marker = `smoke-${process.pid}`;
  terminal.run(echoCommand(marker));
  try {
    await terminal.waitForOutput(marker);
    check(true, "the Session's shell runs a command typed over the terminal WebSocket");
  } catch {
    check(false, "the Session's shell runs a command typed over the terminal WebSocket");
  }
  terminal.close();

  if (flags.hold) {
    const minutes = Number(flags.minutes);
    console.log(
      `\nholding for ${minutes} min (Ctrl-C to stop sooner). Send requests with the header\n` +
        `  ${LOGIN_HEADER}: ${instance.config.allowedLogin}\n` +
        `e.g. curl -H '${LOGIN_HEADER}: ${instance.config.allowedLogin}' ${server.baseUrl}/api/state`,
    );
    await new Promise((done) => setTimeout(done, minutes * 60_000));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanUp();
}
