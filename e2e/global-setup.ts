import { execFileSync } from "node:child_process";
import { startSocketLeakCheck } from "../test/harness/socket-leaks.ts";

/**
 * Builds the front end once per run; the tests then use the production build. The returned
 * teardown fails the run if any test leaves its tmux socket behind.
 */
export default function globalSetup(): () => void {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    stdio: "inherit",
  });
  return startSocketLeakCheck();
}
