import { useRef } from "react";
import type { SessionState } from "@/api";
import { cn } from "@/lib/utils";
import { type Layout, MAX_RATIO, MIN_RATIO } from "../layout";
import { Pane } from "./Pane";

interface PaneAreaProps {
  layout: Layout;
  sessions: SessionState[];
  /** Shown in an empty Pane. */
  emptyMessage: string;
  onFocus: (pane: 0 | 1) => void;
  onResize: (ratio: number) => void;
  /** A Pane's terminal closed because its Session was deleted or its shell ended. */
  onEnded: () => void;
}

/** The main view: one or two Panes side by side, with a draggable divider between them. */
export function PaneArea({
  layout,
  sessions,
  emptyMessage,
  onFocus,
  onResize,
  onEnded,
}: PaneAreaProps) {
  const grid = useRef<HTMLDivElement>(null);
  const two = layout.paneCount === 2;

  const slot = (index: 0 | 1) => {
    const session = sessions.find((s) => s.id === layout.sessions[index]);
    const focused = layout.focus === index;
    return (
      // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the slot
      <div
        role="group"
        aria-label={`Pane ${index + 1}`}
        aria-current={focused ? "true" : undefined}
        // Capture, so a click anywhere in the Pane (including the terminal) focuses it.
        onMouseDownCapture={() => onFocus(index)}
        className={cn(
          "min-h-0 min-w-0 border-t-2 border-transparent",
          two && focused && "border-primary",
        )}
      >
        {session ? (
          <Pane key={session.id} session={session} focused={focused} onEnded={onEnded} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
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
      style={{
        gridTemplateColumns: two
          ? `minmax(0, ${layout.ratio}fr) 6px minmax(0, ${1 - layout.ratio}fr)`
          : "minmax(0, 1fr)",
      }}
    >
      {slot(0)}
      {two && (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resizable split */}
          <div
            role="separator"
            aria-label="Resize panes"
            aria-orientation="vertical"
            aria-valuemin={Math.round(MIN_RATIO * 100)}
            aria-valuemax={Math.round(MAX_RATIO * 100)}
            aria-valuenow={Math.round(layout.ratio * 100)}
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
                onResize(layout.ratio + step);
              }
            }}
          />
          {slot(1)}
        </>
      )}
    </div>
  );
}
