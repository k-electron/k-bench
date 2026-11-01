import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/** Runs the real entry point with a port setting, isolated from every real instance. */
async function startWithPort(port: string): Promise<{ code: number; stderr: string }> {
  const root = mkdtempSync(join(tmpdir(), "kb-test-config-"));
  try {
    await execFileAsync(process.execPath, ["src/server/main.ts"], {
      env: {
        PATH: process.env.PATH,
        K_BENCH_DATA_DIR: join(root, "data"),
        K_BENCH_TMUX_SOCKET: "kb-test-config",
        K_BENCH_PORT: port,
        K_BENCH_ALLOWED_LOGIN: "owner@example.com",
      },
      // A port that was accepted would keep running; the timeout stops that.
      timeout: 5_000,
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stderr?: string;
      killed?: boolean;
    };
    return {
      code: failure.killed ? 0 : Number(failure.code ?? 1),
      stderr: failure.stderr ?? "",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("K_BENCH_PORT", () => {
  it("refuses to start on a value that is not a port, naming the setting", async () => {
    for (const port of ["abc", "-1", "0", "65536", "80.5", "7680abc"]) {
      const result = await startWithPort(port);
      expect(result.code, port).not.toBe(0);
      expect(result.stderr, port).toContain("K_BENCH_PORT");
    }
  });
});
