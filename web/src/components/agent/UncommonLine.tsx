import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { compactionSummary, type UncommonItem } from "../../agent/uncommon";
import { ExpandableLines } from "./ExpandableLines";

/** Lines of a hook's output shown before "+N lines, tap to expand". */
const COLLAPSED_HOOK_LINES = 5;

function Gutter({ children, className }: { children: string; className?: string }) {
  return (
    <span aria-hidden className={cn("shrink-0 select-none", className)}>
      {children}
    </span>
  );
}

/** One line under a `⎿`, indented as a tool's result is. */
function Under({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "bad" | "warn";
}) {
  return (
    <div
      className={cn(
        "flex gap-2 pl-5",
        tone === "bad" && "text-red-300",
        tone === "warn" && "text-amber-300",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      <Gutter>⎿</Gutter>
      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">{children}</div>
    </div>
  );
}

/** When a usage limit lifts, as the device shows times. */
function resetTime(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleString([], {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

const CHECKBOX = { pending: "☐", in_progress: "◼", completed: "☒" } as const;
const CHECKBOX_STATE = {
  pending: "To do: ",
  in_progress: "In progress: ",
  completed: "Done: ",
} as const;

/**
 * The less common lines of the Transcript, one kind each (`agent/uncommon.ts`): compaction,
 * hook output, MCP activity, errors and usage limits, the advisor, the task list and notices.
 * Each is an `article` with a stable accessible name.
 */
export const UncommonLine = memo(function UncommonLine({ item }: { item: UncommonItem }) {
  switch (item.kind) {
    case "compaction": {
      const summary = compactionSummary(item);
      return (
        <article
          aria-label={
            item.state === "running"
              ? "Compacting conversation"
              : item.state === "failed"
                ? "Compaction failed"
                : "Conversation compacted"
          }
          className={cn(
            "my-1 flex gap-2 italic",
            item.state === "failed" ? "text-red-300" : "text-muted-foreground",
          )}
        >
          <Gutter>✻</Gutter>
          <span>
            {item.state === "running"
              ? "Compacting conversation…"
              : item.state === "failed"
                ? `Compaction failed${item.error ? `: ${item.error}` : ""}`
                : `Conversation compacted${summary ? ` (${summary})` : ""}`}
          </span>
        </article>
      );
    }
    case "hook": {
      const rows = item.lines.map((line, index) => (
        // The output of a hook that ran never changes while it is shown.
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are static and may repeat
        <div key={index} className="break-words whitespace-pre-wrap">
          {line === "" ? " " : line}
        </div>
      ));
      const bad = item.outcome !== "success";
      return (
        <article aria-label={`Hook ${item.name}`} className="my-1.5">
          <div className="flex gap-2">
            <Gutter className={bad ? "text-red-400" : "text-muted-foreground"}>⏺</Gutter>
            <span className="min-w-0 break-words">
              <strong>{item.name}</strong>
              <span className="text-muted-foreground"> hook</span>
              {item.outcome === "error" && <span className="text-red-300"> failed</span>}
              {item.outcome === "cancelled" && (
                <span className="text-red-300"> cancelled</span>
              )}
            </span>
          </div>
          {rows.length > 0 && (
            <div
              className={cn(
                "flex gap-2 pl-5",
                bad ? "text-red-300" : "text-muted-foreground",
              )}
            >
              <Gutter>⎿</Gutter>
              <div className="min-w-0 flex-1">
                <ExpandableLines rows={rows} limit={COLLAPSED_HOOK_LINES} />
              </div>
            </div>
          )}
        </article>
      );
    }
    case "mcp":
      return (
        <article aria-label="MCP servers" className="my-1">
          {item.lines.map((line) => (
            <Under key={line.text} tone={line.tone === "problem" ? "warn" : "muted"}>
              {line.text}
            </Under>
          ))}
        </article>
      );
    case "problem":
      return (
        <article
          aria-label={
            item.tone === "limit"
              ? "Usage limit"
              : item.tone === "retry"
                ? "Retrying"
                : "Error"
          }
          className="my-1"
        >
          <Under tone={item.tone === "error" ? "bad" : "warn"}>
            {item.text}
            {item.resetsAt !== undefined && (
              <span className="text-muted-foreground">
                {" "}
                · resets {resetTime(item.resetsAt)}
              </span>
            )}
          </Under>
        </article>
      );
    case "notice":
      return (
        <article
          aria-label={item.tone === "warning" ? "Warning" : "Notice"}
          className="my-1"
        >
          <Under tone={item.tone === "warning" ? "warn" : "muted"}>{item.text}</Under>
        </article>
      );
    case "advisor":
      return (
        <article aria-label="Advisor" className="my-1.5">
          <div className="flex gap-2">
            <Gutter className="text-white/70">⏺</Gutter>
            <span>
              <strong>Advisor</strong>
              {item.status === "consulting" && (
                <span className="text-muted-foreground"> consulting…</span>
              )}
            </span>
          </div>
          {item.status === "advice" && item.text !== undefined && (
            <Under>{item.text}</Under>
          )}
          {item.status === "encrypted" && (
            <Under>Consulted. The advice is encrypted, so it is not shown.</Under>
          )}
          {item.status === "error" && (
            <Under tone="warn">
              The advisor could not answer
              {item.errorCode ? ` (${item.errorCode.replace(/_/g, " ")})` : ""}.
            </Under>
          )}
        </article>
      );
    case "todos": {
      const done = item.todos.filter((todo) => todo.status === "completed").length;
      return (
        <article aria-label="Task list" className="my-1.5">
          <div className="flex gap-2">
            <Gutter className="text-white/70">⏺</Gutter>
            <span>
              <strong>Tasks</strong>
              <span className="text-muted-foreground">
                {" "}
                ({done} of {item.todos.length} done)
              </span>
            </span>
          </div>
          <ul className="pl-5">
            {item.todos.map((todo, index) => (
              <li
                // A list is rewritten whole each time, and two tasks can read alike.
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
                key={index}
                className={cn(
                  "flex gap-2",
                  todo.status === "completed" && "text-muted-foreground line-through",
                  todo.status === "in_progress" && "font-semibold",
                )}
              >
                <Gutter>{CHECKBOX[todo.status]}</Gutter>
                <span className="min-w-0 break-words">
                  <span className="sr-only">{CHECKBOX_STATE[todo.status]}</span>
                  {todo.status === "in_progress" ? todo.activeForm : todo.content}
                </span>
              </li>
            ))}
          </ul>
        </article>
      );
    }
    default: {
      // Every kind of uncommon line has a case above: a new one fails to compile here.
      const missing: never = item;
      return missing;
    }
  }
});
