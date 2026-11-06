import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TerminalClient } from "./terminal.ts";

const STUB = join(import.meta.dirname, "fake-claude.sh");

/**
 * Puts the fake Claude Code (`fake-claude.sh`) in a folder of `root` and returns its path,
 * for the instance config's Claude Code program. The conversations it saves live beside it,
 * so each test instance has its own.
 */
export function installFakeClaude(root: string): string {
  // Hidden, so it does not show up when a test lists the folders of the instance's root.
  const folder = join(root, ".fake-claude");
  mkdirSync(folder, { recursive: true });
  const program = join(folder, "claude");
  copyFileSync(STUB, program);
  chmodSync(program, 0o755);
  return program;
}

/**
 * The arguments the fake Claude Code printed, in order, once it has started. A restart may
 * try twice (resume, then a fresh start), and the screen shows both: this is the attempt
 * that started, the last one.
 */
export async function fakeClaudeArgs(terminal: TerminalClient): Promise<string[]> {
  await terminal.waitForOutput("claude-stub ready");
  const starts = terminal.output.split("claude-stub cwd:");
  const last = starts[starts.length - 1] ?? "";
  return [...last.matchAll(/claude-stub arg: ([^\r\n]+)/g)].map(
    (match) => match[1] as string,
  );
}
