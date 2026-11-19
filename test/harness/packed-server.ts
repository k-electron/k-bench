// A real k-bench server, started from the packed package on a free port with a throwaway
// data folder and tmux socket: what `k-bench status` is pointed at in the packed-command
// tests (docs/internals/test-seams.md, Seam 3).
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { type PackedPackage, packedTempDir } from "./packed.ts";
import { pollUntil } from "./poll.ts";
import { testSocketName, tmuxSocketDir } from "./socket-leaks.ts";
import { killTmuxServer } from "./tmux.ts";

/** A port nothing is listening on right now. */
function freeLocalPort(): Promise<number> {
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

export interface PackedServer {
  port: number;
  /** Stops the server, and ends the tmux server it may have started on its own socket. */
  stop(): void;
}

/**
 * Starts the packed package's server, admitting only `login`, and waits until it listens.
 * `env` adds to the environment the server runs with (its tmux server inherits it).
 */
export async function startPackedServer(
  pkg: PackedPackage,
  login: string,
  env: Record<string, string> = {},
): Promise<PackedServer> {
  const port = await freeLocalPort();
  const tmuxSocket = testSocketName();
  const server = spawn(
    process.execPath,
    [join(pkg.packageDir, "dist/js/src/server/main.js")],
    {
      cwd: pkg.packageDir,
      env: {
        PATH: process.env.PATH,
        K_BENCH_DATA_DIR: packedTempDir(),
        K_BENCH_PORT: String(port),
        K_BENCH_TMUX_SOCKET: tmuxSocket,
        K_BENCH_ALLOWED_LOGIN: login,
        ...env,
      },
    },
  );
  let log = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      log += chunk;
    });
  }
  try {
    await pollUntil(() => log.includes("listening on"), {
      description: "the server to start",
    });
  } catch (error) {
    server.kill("SIGTERM");
    throw new Error(`${(error as Error).message}\nserver output:\n${log}`);
  }
  return {
    port,
    stop: () => {
      server.kill("SIGTERM");
      try {
        killTmuxServer(tmuxSocket);
      } catch {
        // No Session was ever started: there is no tmux server.
      }
      // tmux can leave its socket file behind even once its server is gone.
      rmSync(join(tmuxSocketDir(), tmuxSocket), { force: true });
    },
  };
}
