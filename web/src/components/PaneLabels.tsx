import { cn } from "@/lib/utils";
import { paneColumns } from "../layout";
import type { PaneView } from "../usePaneView";

interface PaneLabelsProps {
  panes: PaneView[];
  paneCount: 1 | 2;
  ratio: number;
  className?: string;
}

/**
 * The row of labels in the top bar, one over each Pane showing a Session, reading
 * `Workspace › Session`. It uses the Panes' own grid columns, so each label starts at its
 * Pane's left edge, divider drags included. A label is cut off with an ellipsis at about
 * two thirds of its Pane's width, which also keeps the right-hand one clear of the toggle.
 */
export function PaneLabels({ panes, paneCount, ratio, className }: PaneLabelsProps) {
  const two = paneCount === 2;
  const [first, second] = panes;
  const label = (index: number, { content, focused }: PaneView) => {
    if (content.kind !== "session") return <div />;
    return (
      <div
        role="note"
        aria-label={`Pane ${index + 1} label`}
        className={cn("max-w-2/3 truncate px-2 text-sm", two && !focused && "opacity-50")}
      >
        <span className="text-muted-foreground">{content.workspace} ›</span>{" "}
        <span>{content.session.name}</span>
      </div>
    );
  };
  return (
    <div
      className={cn("grid min-w-0 items-center", className)}
      style={{ gridTemplateColumns: paneColumns(paneCount, ratio) }}
    >
      {first ? label(0, first) : <div />}
      {two && second && (
        <>
          <div />
          {label(1, second)}
        </>
      )}
    </div>
  );
}
