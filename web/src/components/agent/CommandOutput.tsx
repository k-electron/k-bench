import { memo } from "react";
import { ExpandableLines } from "./ExpandableLines";

/** Lines of a command's reply shown before "+N lines, tap to expand". */
const COLLAPSED_LINES = 8;

/**
 * `⎿` and what a typed command (`/context`, `/usage`, `/model opus`) answered, muted, in the
 * terminal's monospace, folded after a few lines as long tool output is. Its accessible name
 * is "Command output".
 */
export const CommandOutput = memo(function CommandOutput({ text }: { text: string }) {
  const rows = text.split("\n").map((line, index) => (
    // The reply never changes once shown.
    // biome-ignore lint/suspicious/noArrayIndexKey: lines are static and may repeat
    <div key={index} className="break-words whitespace-pre-wrap">
      {line === "" ? " " : line}
    </div>
  ));
  return (
    <article
      aria-label="Command output"
      className="my-1 flex gap-2 pl-5 text-muted-foreground"
    >
      <span aria-hidden className="shrink-0 select-none">
        ⎿
      </span>
      <div className="min-w-0 flex-1">
        <ExpandableLines rows={rows} limit={COLLAPSED_LINES} />
      </div>
    </article>
  );
});
