import { buildAgentRuntime } from "./agent-runtime.ts";
import { startSocketLeakCheck } from "./socket-leaks.ts";

/**
 * Builds the Agent Runtime once per run (the tests that start a Claude Agent run the real
 * one), and fails the run if any test leaves its tmux socket behind.
 */
export default function globalSetup(): () => void {
  buildAgentRuntime();
  return startSocketLeakCheck();
}
