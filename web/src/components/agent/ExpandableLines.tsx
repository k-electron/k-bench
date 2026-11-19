import { type ReactNode, useState } from "react";

/** The most lines shown of a long output or diff, until it is tapped open. */
const MORE_THAN_LINES = 1000;

/**
 * A run of lines collapsed to the first `limit` of them, with a button "+N lines, tap to
 * expand" for the rest (and "Show fewer lines" to fold it back), as the terminal folds long
 * tool output. The lines are the caller's rows; this only decides how many show. Used by tool
 * output and by diffs, and meant for any later long run of lines.
 */
export function ExpandableLines({
  rows,
  limit,
}: {
  rows: ReactNode[];
  /** How many rows show collapsed. */
  limit: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = rows.length - limit;
  // A row more than the limit by one would be hidden for a button saying "+1 line": show it.
  const collapsible = hidden > 1;
  const shown = expanded || !collapsible ? rows : rows.slice(0, limit);
  return (
    <>
      {shown.length > MORE_THAN_LINES ? shown.slice(0, MORE_THAN_LINES) : shown}
      {shown.length > MORE_THAN_LINES && (
        <div className="text-muted-foreground">
          … {shown.length - MORE_THAN_LINES} more lines not shown
        </div>
      )}
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="-mx-1 rounded px-1 py-1 text-left text-muted-foreground underline-offset-2 hover:underline"
        >
          {expanded ? "Show fewer lines" : `+${hidden} lines, tap to expand`}
        </button>
      )}
    </>
  );
}
