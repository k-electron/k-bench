import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The line over the conversation, as Claude Code's terminal opens: `claude <version> · <model>
 * · <folder>`. What is not known yet is left out: Claude Code reports the model only when a turn
 * starts, so before the first prompt it reads `claude <version> · <folder>`. `trailing` is what
 * sits at its right end (the Raw switch). `versionWarning` is the line under it when that
 * `claude` is older than the Claude Code k-bench's Agent SDK was made for; it never stops the
 * Agent.
 */
export function AgentHeader({
  version,
  versionWarning,
  model,
  folder,
  trailing,
}: {
  version?: string;
  versionWarning?: string;
  model?: string;
  folder?: string;
  trailing?: ReactNode;
}) {
  const parts = [version === undefined ? undefined : `claude ${version}`, model, folder];
  const text = parts.filter((part) => part !== undefined && part !== "").join(" · ");
  return (
    <div className="shrink-0 border-b">
      <div className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {text !== "" && (
          <div role="note" aria-label="Claude Code" className="flex min-w-0 gap-2">
            <span aria-hidden className="select-none">
              ✻
            </span>
            {/* Long folders cut at the end; the whole line is the tooltip. */}
            <span className="min-w-0 truncate" title={text}>
              {text}
            </span>
          </div>
        )}
        <div className="ml-auto shrink-0">{trailing}</div>
      </div>
      {versionWarning !== undefined && (
        <div
          role="note"
          aria-label="Version warning"
          className="flex items-start gap-2 px-3 pb-1.5 text-xs text-amber-600 dark:text-amber-400"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{versionWarning}</span>
        </div>
      )}
    </div>
  );
}
