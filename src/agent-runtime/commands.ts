import type { AgentCommand } from "../shared/agent-protocol.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A command as Claude Code lists it, kept only if it has a name; the rest is made safe. */
export function toAgentCommand(raw: unknown): AgentCommand | undefined {
  if (!isObject(raw) || typeof raw.name !== "string" || raw.name === "") return undefined;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((a): a is string => typeof a === "string" && a !== "")
    : [];
  return {
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    argumentHint: typeof raw.argumentHint === "string" ? raw.argumentHint : "",
    ...(aliases.length > 0 && { aliases }),
  };
}

/** The names a `system/init` marks terminal-only. Absent means none: Claude Code leaves the field out when empty. */
function terminalNames(init: Record<string, unknown>): string[] {
  return Array.isArray(init.terminal_slash_commands)
    ? init.terminal_slash_commands.filter((n): n is string => typeof n === "string")
    : [];
}

/**
 * What the `/` menu offers (#150): the commands and skills Claude Code lists, minus the ones
 * it marks as bound to a terminal.
 *
 * Claude Code says it in two places. The command list comes in the reply to the SDK's first
 * request, and again, whole, as `commands_changed` whenever it changes. Which of them are
 * **terminal-only** (`exit`, `statusline`...) it says only in `terminal_slash_commands` of
 * each turn's `system/init`, so before the Agent's first turn nothing is known and every
 * command is offered. The runtime keeps what the last `init` said, and starts from the one in
 * the log when it is started again, so an Agent that has had a turn never offers one again.
 * (Which names are terminal-only is Claude Code's to say: k-bench keeps no list of its own.)
 */
export class CommandList {
  private all: AgentCommand[] = [];
  private terminalOnly: ReadonlySet<string>;
  private current: AgentCommand[] = [];

  constructor(terminalOnly: Iterable<string> = []) {
    this.terminalOnly = new Set(terminalOnly);
  }

  /** What the menu offers now. */
  get commands(): readonly AgentCommand[] {
    return this.current;
  }

  /** Takes a command list as Claude Code gave it. True when what the menu offers changed. */
  set(raw: unknown): boolean {
    if (!Array.isArray(raw)) return false;
    // Rows can share a name: the one Claude Code owns (`builtin`) is what `/name` runs, so
    // it is the one offered. Rows without the marker lose to it, and otherwise the first wins.
    const byName = new Map<string, { command: AgentCommand; builtin: boolean }>();
    for (const row of raw) {
      const command = toAgentCommand(row);
      if (!command) continue;
      const builtin = isObject(row) && row.builtin === true;
      const held = byName.get(command.name);
      if (!held || (builtin && !held.builtin))
        byName.set(command.name, { command, builtin });
    }
    this.all = [...byName.values()].map((entry) => entry.command);
    return this.refresh();
  }

  /**
   * Reads a message Claude Code sent: a replaced list (`commands_changed`) or a turn's `init`
   * naming the terminal-only ones. True when what the menu offers changed.
   */
  observe(message: Record<string, unknown>): boolean {
    if (message.type !== "system") return false;
    if (message.subtype === "commands_changed") return this.set(message.commands);
    if (message.subtype === "init") {
      this.terminalOnly = new Set(terminalNames(message));
      return this.refresh();
    }
    return false;
  }

  private refresh(): boolean {
    const next = this.all.filter((command) => !this.terminalOnly.has(command.name));
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    return changed;
  }
}

/** The terminal-only commands the latest `system/init` in these log messages named. */
export function terminalOnlyFrom(messages: Iterable<Record<string, unknown>>): string[] {
  let names: string[] = [];
  for (const message of messages) {
    if (message.type === "system" && message.subtype === "init") {
      names = terminalNames(message);
    }
  }
  return names;
}
