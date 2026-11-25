import { chmodSync, copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
 * Makes the fake Claude Code at `program` ignore `--settings` from its next start on, as
 * Claude Code does when hooks can't run (an untrusted folder, or `disableAllHooks`).
 */
export function ignoreClaudeSettings(program: string): void {
  writeFileSync(join(dirname(program), "ignore-settings"), "");
}

/** What the fake Claude Code printed for the attempt that started (see `fakeClaudeArgs`). */
async function lastStart(terminal: TerminalClient): Promise<string> {
  await terminal.waitForOutput("claude-stub ready");
  const starts = terminal.output.split("claude-stub cwd:");
  return starts[starts.length - 1] ?? "";
}

/**
 * The arguments the fake Claude Code printed, in order, once it has started, leaving out
 * `--settings` and its value (see `fakeClaudeSettings`). A restart may try twice (resume,
 * then a fresh start), and the screen shows both: this is the attempt that started, the last
 * one.
 */
export async function fakeClaudeArgs(terminal: TerminalClient): Promise<string[]> {
  const last = await lastStart(terminal);
  return [...last.matchAll(/claude-stub arg: ([^\r\n]+)/g)].map(
    (match) => match[1] as string,
  );
}

/**
 * The `--settings` the fake Claude Code started with, without their hooks, or undefined when
 * it had none. Like `fakeClaudeArgs`, it is the attempt that started.
 */
export async function fakeClaudeSettings(
  terminal: TerminalClient,
): Promise<Record<string, unknown> | undefined> {
  const line = /claude-stub settings: ([^\r\n]+)/.exec(await lastStart(terminal));
  return line ? JSON.parse(line[1] as string) : undefined;
}

/**
 * The conversation the fake Claude Code is on, as of its latest start or `clear`. It reports
 * one only once its SessionStart hooks have run.
 */
export function fakeClaudeConversation(terminal: TerminalClient): string | undefined {
  const reports = [
    ...terminal.output.matchAll(/claude-stub conversation: ([0-9a-f-]+)/g),
  ];
  return reports[reports.length - 1]?.[1];
}

/** The conversations the fake Claude Code at `program` has saved: those it can resume. */
export function fakeClaudeSavedConversations(program: string): string[] {
  try {
    return readdirSync(join(dirname(program), "conversations"));
  } catch {
    return [];
  }
}
