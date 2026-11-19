import { memo } from "react";
import { cn } from "@/lib/utils";
import type { DiffLine } from "../../agent/toolDisplay";
import { ExpandableLines } from "./ExpandableLines";

/** Lines of a diff shown before "+N lines, tap to expand". */
const COLLAPSED_DIFF_LINES = 20;

const SIGN = { add: "+", del: "-", context: " ", hunk: " " } as const;

/**
 * An edit as coloured lines: removed in red (`<del>`), added in green (`<ins>`), the lines
 * around them plain. Scrolls sideways inside its own box, so a long line never widens the page.
 * Reused by the permission panel (#146) for the edit being asked about.
 */
export const Diff = memo(function Diff({
  lines,
  label,
}: {
  lines: readonly DiffLine[];
  /** The diff's accessible name, usually the file it is of. */
  label: string;
}) {
  const rows = lines.map((line, index) => {
    // A diff never changes while it is shown, so its position is its identity.
    const key = `${index}`;
    const sign = (
      <span aria-hidden className="mr-2 select-none">
        {SIGN[line.kind]}
      </span>
    );
    // Each row is as wide as its longest line, so its colour runs the whole way when it scrolls.
    const row = "block w-max min-w-full px-2 whitespace-pre no-underline";
    if (line.kind === "add") {
      return (
        <ins key={key} className={cn(row, "bg-green-500/15 text-green-300")}>
          {sign}
          {line.text}
        </ins>
      );
    }
    if (line.kind === "del") {
      return (
        <del key={key} className={cn(row, "bg-red-500/15 text-red-300")}>
          {sign}
          {line.text}
        </del>
      );
    }
    return (
      <span key={key} className={cn(row, "text-muted-foreground")}>
        {sign}
        {line.text}
      </span>
    );
  });
  return (
    <figure
      aria-label={label}
      className="mt-1 ml-5 overflow-x-auto rounded-md bg-black/50 py-1 font-mono text-[12px] leading-relaxed"
    >
      <ExpandableLines rows={rows} limit={COLLAPSED_DIFF_LINES} />
    </figure>
  );
});
