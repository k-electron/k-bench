import type { AgentCommand } from "../../../src/shared/agent-protocol.ts";

/**
 * The `/` menu's rules, pure (#150). The menu is open while the whole input is a slash and the
 * start of a name, nothing else: `/`, `/co`. Once the name is followed by a space the owner is
 * on the arguments (`/model opus`) and the menu is gone, so a command typed in full and sent
 * is never in its way. A prompt that merely contains a slash (`fix /etc/hosts`) never opens it.
 */
export function commandQuery(text: string): string | undefined {
  const match = /^\/(\S*)$/.exec(text);
  return match ? (match[1] ?? "") : undefined;
}

/**
 * The commands whose name (or alias) starts with what was typed, then those that merely
 * contain it, each group in alphabetical order. Nothing typed after the slash lists them all.
 */
export function matchCommands(
  commands: readonly AgentCommand[],
  query: string,
): AgentCommand[] {
  const wanted = query.toLowerCase();
  const rank = (command: AgentCommand): number => {
    const name = command.name.toLowerCase();
    if (name.startsWith(wanted)) return 0;
    if (command.aliases?.some((alias) => alias.toLowerCase().startsWith(wanted)))
      return 1;
    if (name.includes(wanted)) return 2;
    return 3;
  };
  return commands
    .map((command) => ({ command, rank: rank(command) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.command.name.localeCompare(b.command.name, "en"))
    .map((entry) => entry.command);
}

/**
 * What picking a command puts in the input: its name and a space, and nothing more. The owner
 * carries on with the arguments, or sends it as it is.
 */
export function completion(command: AgentCommand): string {
  return `/${command.name} `;
}
