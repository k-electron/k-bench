import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import type { AgentCommand } from "../../../../src/shared/agent-protocol.ts";
import { commandQuery, matchCommands } from "../../agent/slashCommands";
import { type PickerOption, pickerOptionId } from "./PickerMenu";
import { handlePickerKey } from "./pickerKeys";

const namedInFull = (matches: readonly AgentCommand[], query: string | undefined) =>
  matches.some(
    (command) => command.name === query || command.aliases?.includes(query ?? ""),
  );

/**
 * The state of the `/` menu (#150) for the input that owns it: whether it is open, which
 * commands it lists, which is active, and what the keys do while it is open. It holds no text:
 * the input's text decides whether it is open (`commandQuery`), and picking hands the command
 * back to the input to write.
 *
 * While it is open it owns Up, Down, Tab, Enter and Escape, so the arrows move the active row
 * and do not step through prompt history. Enter picks (inserting the name and stopping there)
 * unless the name is already typed in full, when it sends; Escape closes the menu until the
 * text changes again.
 */
export function useCommandMenu({
  text,
  commands,
  suppressed,
  onPick,
}: {
  text: string;
  commands: readonly AgentCommand[];
  /** Never open: the box is disabled, or shows a recalled prompt (Up and Down are history's then). */
  suppressed: boolean;
  /** A command was picked: the input writes its name. */
  onPick: (command: AgentCommand) => void;
}) {
  const id = useId();
  const query = suppressed ? undefined : commandQuery(text);
  const matches = useMemo(
    () => (query === undefined ? [] : matchCommands(commands, query)),
    [commands, query],
  );
  // The active row belongs to the text it was chosen for: typing again starts at the top.
  const [chosen, setChosen] = useState<{ text: string; index: number }>({
    text,
    index: 0,
  });
  const [dismissedFor, setDismissedFor] = useState<string | undefined>(undefined);
  // Escape closes the menu only until the text changes: the same text typed again opens it.
  useEffect(() => {
    setDismissedFor((was) => (was === text ? was : undefined));
  }, [text]);
  const open = query !== undefined && matches.length > 0 && dismissedFor !== text;
  const active = chosen.text === text ? Math.min(chosen.index, matches.length - 1) : 0;
  const options: PickerOption[] = useMemo(
    () =>
      matches.map((command) => ({
        key: command.name,
        label: `/${command.name}`,
        ...(command.argumentHint !== "" && { hint: command.argumentHint }),
        ...(command.description !== "" && { detail: command.description }),
      })),
    [matches],
  );
  const activeCommand = matches[active];

  const pick = (index: number) => {
    const command = matches[index];
    if (command) onPick(command);
  };

  /** Handles the key if the menu wants it (and then it has been `preventDefault`ed). */
  const handleKey = (event: KeyboardEvent): boolean => {
    if (!open || !activeCommand) return false;
    return handlePickerKey(event, {
      count: matches.length,
      active,
      // A name (or alias) typed in full is already complete: Enter then sends it.
      enterPicks: !namedInFull(matches, query),
      move: (index) => setChosen({ text, index }),
      pick: () => onPick(activeCommand),
      dismiss: () => setDismissedFor(text),
    });
  };

  return {
    open,
    menuId: id,
    options,
    active,
    /** The active row's DOM id, for the input's `aria-activedescendant`. */
    activeId: open && activeCommand ? pickerOptionId(id, activeCommand.name) : undefined,
    pick,
    handleKey,
  };
}
