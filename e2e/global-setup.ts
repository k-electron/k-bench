import { execFileSync } from "node:child_process";
import { buildAgentRuntime } from "../test/harness/agent-runtime.ts";
import { startSocketLeakCheck } from "../test/harness/socket-leaks.ts";

/**
 * Builds the front end and the Agent Runtime once per run; the tests then use the production
 * build and start Claude Agents with the real runtime. The returned teardown fails the run
 * if any test leaves its tmux socket behind.
 */
export default function globalSetup(): () => void {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    stdio: "inherit",
  });
  buildAgentRuntime();
  return startSocketLeakCheck();
}
