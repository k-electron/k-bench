// A real k-bench server, started from the packed package on a free port with a throwaway
// data folder and tmux socket: what `k-bench status` is pointed at in the packed-command
// tests (docs/internals/test-seams.md, Seam 3).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { type PackedPackage, packedTempDir } from "./packed.ts";
import { pollUntil } from "./poll.ts";
import { testSocketName } from "./socket-leaks.ts";

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
  stop(): void;
}

/** Starts the packed package's server, admitting only `login`, and waits until it listens. */
export async function startPackedServer(
  pkg: PackedPackage,
  login: string,
): Promise<PackedServer> {
  const port = await freeLocalPort();
  const server = spawn(
    process.execPath,
    [join(pkg.packageDir, "dist/js/src/server/main.js")],
    {
      cwd: pkg.packageDir,
      env: {
        PATH: process.env.PATH,
        K_BENCH_DATA_DIR: packedTempDir(),
        K_BENCH_PORT: String(port),
        K_BENCH_TMUX_SOCKET: testSocketName(),
        K_BENCH_ALLOWED_LOGIN: login,
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
  return { port, stop: () => server.kill("SIGTERM") };
}
