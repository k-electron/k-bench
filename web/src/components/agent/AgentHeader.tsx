/**
 * The line over the conversation, as Claude Code's terminal opens: `claude <version> · <model>
 * · <folder>`. What is not known yet is left out: Claude Code reports the model only when a turn
 * starts, so before the first prompt it reads `claude <version> · <folder>`.
 */
export function AgentHeader({
  version,
  model,
  folder,
}: {
  version?: string;
  model?: string;
  folder?: string;
}) {
  const parts = [version === undefined ? undefined : `claude ${version}`, model, folder];
  const text = parts.filter((part) => part !== undefined && part !== "").join(" · ");
  if (text === "") return null;
  return (
    <div
      role="note"
      aria-label="Claude Code"
      className="flex shrink-0 gap-2 border-b px-3 py-1.5 font-mono text-xs text-muted-foreground"
    >
      <span aria-hidden className="select-none">
        ✻
      </span>
      {/* Long folders cut at the end; the whole line is the tooltip. */}
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
    </div>
  );
}
