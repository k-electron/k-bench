import { memo } from "react";
import type { UnsupportedItem } from "@/agent/items";
import { useOpenInTerminalAction } from "./OpenInTerminal";
import { useShowRaw } from "./RawView";

/**
 * Something Claude met that k-bench can't show or answer (#153), where it happened: it says in
 * plain words what Claude tried, opens the raw view of the message, and offers Open in terminal
 * (#155), where Claude Code can do it. It makes no sound: the Bell is the Agent's, and an
 * Unsupported row never raises it.
 */
export const UnsupportedRow = memo(function UnsupportedRow({
  item,
}: {
  item: UnsupportedItem;
}) {
  const showRaw = useShowRaw();
  const openInTerminal = useOpenInTerminalAction();
  return (
    <article
      aria-label="Unsupported"
      className="my-1.5 flex gap-2 rounded border border-amber-300/30 bg-amber-300/[0.06] px-2 py-1"
    >
      <span aria-hidden className="shrink-0 text-amber-300 select-none">
        ⚠
      </span>
      <div className="min-w-0">
        <p>
          <span className="font-semibold text-amber-200">Unsupported. </span>
          {item.summary}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.seq !== undefined && (
            <button
              type="button"
              onClick={() => item.seq !== undefined && showRaw(item.seq)}
              className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Open raw view
            </button>
          )}
          {openInTerminal && (
            <button
              type="button"
              onClick={openInTerminal}
              className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Open in terminal
            </button>
          )}
        </div>
      </div>
    </article>
  );
});
