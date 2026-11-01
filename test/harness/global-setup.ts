import { startSocketLeakCheck } from "./socket-leaks.ts";

/** Fails the run if any test leaves its tmux socket behind. */
export default function globalSetup(): () => void {
  return startSocketLeakCheck();
}
