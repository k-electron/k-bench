import type { SessionState, WorkspaceState } from "@/api";
import { cn } from "@/lib/utils";
import { type Layout, paneColumns } from "../layout";

/** A Session with the name of the Workspace it belongs to. */
export function locateSession(
  workspaces: WorkspaceState[] | undefined,
  id: string | null,
): { workspace: string; session: SessionState } | undefined {
  for (const workspace of workspaces ?? []) {
    const session = workspace.sessions.find((s) => s.id === id);
    if (session) return { workspace: workspace.name, session };
  }
  return undefined;
}

interface PaneLabelsProps {
  layout: Layout;
  workspaces: WorkspaceState[] | undefined;
  className?: string;
}

/**
 * The row of labels in the top bar, one over each Pane showing a Session, reading
 * `Workspace › Session`. It uses the Panes' own grid columns, so each label starts at its
 * Pane's left edge, divider drags included. A label is cut off with an ellipsis at about
 * two thirds of its Pane's width, which also keeps the right-hand one clear of the toggle.
 */
export function PaneLabels({ layout, workspaces, className }: PaneLabelsProps) {
  const two = layout.paneCount === 2;
  const label = (index: 0 | 1) => {
    const found = locateSession(workspaces, layout.sessions[index]);
    if (!found) return <div />;
    return (
      <div
        role="note"
        aria-label={`Pane ${index + 1} label`}
        className={cn(
          "max-w-2/3 truncate px-2 text-sm",
          two && layout.focus !== index && "opacity-50",
        )}
      >
        <span className="text-muted-foreground">{found.workspace} ›</span>{" "}
        <span>{found.session.name}</span>
      </div>
    );
  };
  return (
    <div
      className={cn("grid min-w-0 items-center", className)}
      style={{ gridTemplateColumns: paneColumns(layout) }}
    >
      {label(0)}
      {two && (
        <>
          <div />
          {label(1)}
        </>
      )}
    </div>
  );
}
