import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ToolItem } from "../../agent/items";
import { toolMarkWithTask } from "../../agent/tasks";
import { toolDisplayName } from "../../agent/toolDisplay";
import { Diff } from "./Diff";
import { ExpandableLines } from "./ExpandableLines";
import { StatusMark } from "./StatusMark";
import { TaskDetail } from "./TaskLine";

/** Lines of a tool's output shown before "+N lines, tap to expand". */
const COLLAPSED_OUTPUT_LINES = 5;

/**
 * `⏺ Bash(ls -la)`, and under it what came of it: `⎿` and the result's lines (collapsed to
 * about five, with "+N lines, tap to expand"), and for an edit its diff. Its accessible name
 * is `Bash(ls -la)`.
 */
export const ToolCall = memo(function ToolCall({ item }: { item: ToolItem }) {
  const name = toolDisplayName(item.name);
  const { result } = item;
  const failed = item.status === "denied" || item.status === "failed";
  const interrupted = item.status === "interrupted";
  const rows = (result?.lines ?? []).map((line, index) => (
    // The output of a finished tool never changes while it is shown.
    // biome-ignore lint/suspicious/noArrayIndexKey: lines are static and may repeat
    <div key={index} className="break-words whitespace-pre-wrap">
      {line === "" ? " " : line}
    </div>
  ));
  return (
    <article aria-label={`${name}(${item.target})`} className="my-1.5">
      <div className="flex gap-2">
        <StatusMark status={toolMarkWithTask(item.status, item.task)} />
        <span className="min-w-0 break-words">
          <strong>{name}</strong>
          <span className="text-muted-foreground">({item.target})</span>
        </span>
      </div>
      {result && (
        <div
          className={cn(
            "flex gap-2 pl-5",
            failed || interrupted ? "text-red-300" : "text-muted-foreground",
          )}
        >
          <span aria-hidden className="select-none">
            ⎿
          </span>
          <div className="min-w-0 flex-1">
            {result.summary !== undefined && <div>{result.summary}</div>}
            <ExpandableLines rows={rows} limit={COLLAPSED_OUTPUT_LINES} />
          </div>
        </div>
      )}
      {item.diff && item.diff.length > 0 && (
        <Diff lines={item.diff} label={`Diff of ${item.target}`} />
      )}
      {item.task && <TaskDetail task={item.task} />}
    </article>
  );
});
