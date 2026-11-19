import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { fileMention, insertMention } from "@/agent/fileMentions";
import { api } from "@/api";
import { type PickerOption, pickerOptionId } from "./PickerMenu";
import { handlePickerKey } from "./pickerKeys";

const NO_FILES: readonly string[] = [];

/** How long a pause in typing the server waits for before it is asked. */
const ASK_AFTER_MS = 100;

/**
 * The state of the `@` file picker (#160) for the input that owns it, the second of the
 * hooks that drive a `PickerMenu` (`useCommandMenu` is the first). Like it, it holds no text:
 * the text and the caret decide whether it is open (`fileMention`), and picking hands the
 * new text and caret back to the input to write.
 *
 * It asks the server for the Workspace folder's files whose path contains what follows the
 * `@`, after a short pause in typing, and opens only when the answer is for what is typed now
 * and is not empty, so an answer to an earlier word is never picked from. While it is open it
 * owns Up, Down, Tab, Enter and Escape (`handlePickerKey`).
 */
export function useFileMenu({
  sessionId,
  text,
  caret,
  suppressed,
  onPick,
}: {
  sessionId: string;
  text: string;
  /** Where the caret is in `text`. */
  caret: number;
  /** Never open: the box is disabled, or shows a recalled prompt (Up and Down are history's then). */
  suppressed: boolean;
  /** A file was picked: the input takes this text and caret. */
  onPick: (edit: { text: string; caret: number }) => void;
}) {
  const id = useId();
  const mention = useMemo(
    () => (suppressed ? undefined : fileMention(text, caret)),
    [suppressed, text, caret],
  );
  const query = mention?.query;
  const [found, setFound] = useState<{ query: string; files: string[] } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (query === undefined) return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .searchAgentFiles(sessionId, query)
        .catch(() => [] as string[])
        .then((files) => {
          if (current) setFound({ query, files });
        });
    }, ASK_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [sessionId, query]);

  const files = found && found.query === query ? found.files : NO_FILES;
  // The active row belongs to the text it was chosen for: typing again starts at the top.
  const [chosen, setChosen] = useState<{ text: string; index: number }>({
    text,
    index: 0,
  });
  const [dismissedFor, setDismissedFor] = useState<string | undefined>(undefined);
  // Escape closes the picker only until the text changes: the same text typed again opens it.
  useEffect(() => {
    setDismissedFor((was) => (was === text ? was : undefined));
  }, [text]);
  const open = mention !== undefined && files.length > 0 && dismissedFor !== text;
  const active = chosen.text === text ? Math.min(chosen.index, files.length - 1) : 0;
  const options: PickerOption[] = useMemo(
    () =>
      files.map((path, index) => {
        const slash = path.lastIndexOf("/");
        return {
          // Not the path: a path may hold spaces, which an `aria-activedescendant` id cannot.
          key: String(index),
          label: path.slice(slash + 1),
          ...(slash > 0 && { detail: path.slice(0, slash) }),
        };
      }),
    [files],
  );
  const activePath = files[active];

  const pickPath = (path: string | undefined) => {
    if (mention && path !== undefined) onPick(insertMention(text, mention, path));
  };

  /** Handles the key if the picker wants it (and then it has been `preventDefault`ed). */
  const handleKey = (event: KeyboardEvent): boolean => {
    if (!open || activePath === undefined) return false;
    return handlePickerKey(event, {
      count: files.length,
      active,
      move: (index) => setChosen({ text, index }),
      pick: () => pickPath(activePath),
      dismiss: () => setDismissedFor(text),
    });
  };

  return {
    open,
    menuId: id,
    options,
    active,
    /** The active row's DOM id, for the input's `aria-activedescendant`. */
    activeId:
      open && activePath !== undefined ? pickerOptionId(id, String(active)) : undefined,
    pick: (index: number) => pickPath(files[index]),
    handleKey,
  };
}
