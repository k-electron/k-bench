import { useRef } from "react";
import { cn } from "@/lib/utils";
import { MAX_RATIO, MIN_RATIO, paneColumns } from "../layout";
import type { PaneView } from "../usePaneView";
import { Pane } from "./Pane";

const DELETED_NOTICE = "This Session was deleted.";

interface PaneAreaProps {
  panes: PaneView[];
  paneCount: 1 | 2;
  /** Share of the width the first Pane takes, when two are shown. */
  ratio: number;
  /** Shown in an empty Pane. */
  emptyMessage: string;
  /** Called with `PaneView.pane` of the Pane clicked in. */
  onFocus: (pane: 0 | 1) => void;
  onResize: (ratio: number) => void;
}

/** The main view: one or two Panes side by side, with a draggable divider between them. */
export function PaneArea({
  panes,
  paneCount,
  ratio,
  emptyMessage,
  onFocus,
  onResize,
}: PaneAreaProps) {
  const grid = useRef<HTMLDivElement>(null);
  const two = paneCount === 2;

  const [first, second] = panes;

  const slot = (index: number, { pane, content, focused }: PaneView) => {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the slot
      <div
        role="group"
        aria-label={`Pane ${index + 1}`}
        aria-current={focused ? "true" : undefined}
        // Capture, so a click anywhere in the Pane (including the terminal) focuses it.
        onMouseDownCapture={() => onFocus(pane)}
        className={cn(
          "min-h-0 min-w-0 border-t-2 border-transparent",
          two && focused && "border-primary",
        )}
      >
        {content.kind === "session" ? (
          <Pane key={content.session.id} session={content.session} focused={focused} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {content.kind === "deleted" ? (
              <p role="status" aria-label="Pane notice">
                {DELETED_NOTICE} {emptyMessage}
              </p>
            ) : (
              emptyMessage
            )}
          </div>
        )}
      </div>
    );
  };

  const moveDivider = (clientX: number) => {
    const rect = grid.current?.getBoundingClientRect();
    if (rect && rect.width > 0) onResize((clientX - rect.left) / rect.width);
  };

  return (
    <div
      ref={grid}
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: paneColumns(paneCount, ratio) }}
    >
      {first && slot(0, first)}
      {two && second && (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resizable split */}
          <div
            role="separator"
            aria-label="Resize panes"
            aria-orientation="vertical"
            aria-valuemin={Math.round(MIN_RATIO * 100)}
            aria-valuemax={Math.round(MAX_RATIO * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            className="cursor-col-resize touch-none bg-border hover:bg-primary focus-visible:bg-primary"
            onPointerDown={(event) =>
              event.currentTarget.setPointerCapture(event.pointerId)
            }
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                moveDivider(event.clientX);
              }
            }}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
              if (step) {
                event.preventDefault();
                onResize(ratio + step);
              }
            }}
          />
          {slot(1, second)}
        </>
      )}
    </div>
  );
}
