import { memo } from "react";
import type { UnsupportedItem } from "@/agent/items";
import { useShowRaw } from "./RawView";

/**
 * Something Claude met that k-bench can't show or answer (#153), where it happened: it says in
 * plain words what Claude tried and opens the raw view of the message. It makes no sound: the
 * Bell is the Agent's, and an Unsupported row never raises it. (Open in terminal joins it in
 * #155.)
 */
export const UnsupportedRow = memo(function UnsupportedRow({
  item,
}: {
  item: UnsupportedItem;
}) {
  const showRaw = useShowRaw();
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
        {item.seq !== undefined && (
          <button
            type="button"
            onClick={() => item.seq !== undefined && showRaw(item.seq)}
            className="mt-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            Open raw view
          </button>
        )}
      </div>
    </article>
  );
});
