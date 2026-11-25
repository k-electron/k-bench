import { type ReactNode, useRef } from "react";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import {
  MAX_RATIO,
  MIN_RATIO,
  type PaneContent,
  type Side,
  type WorkspaceView as View,
} from "../workspaceView";
import { MissingPane } from "./MissingPane";
import { Pane } from "./Pane";
import { RightPaneTabs } from "./RightPaneTabs";
import { SessionIcon } from "./SessionIcon";

/** The CSS grid columns of the two Panes, with the divider's 6px between them. */
function columns(ratio: number): string {
  return `minmax(0, ${ratio}fr) 6px minmax(0, ${1 - ratio}fr)`;
}

/** The slim bar naming what a Pane shows. */
function LabelBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-b bg-card px-2 text-xs">
      {children}
    </div>
  );
}

/**
 * The main view on a desktop or tablet: the Open Workspace's Prime in the left Pane and
 * its Worker, or an Other Session, in the right, with a draggable divider between them.
 */
export function WorkspaceView({
  view,
  workspaces,
}: {
  view: View;
  /** Every Workspace, for the folder picker of a Missing one's Change folder. */
  workspaces: WorkspaceState[];
}) {
  const grid = useRef<HTMLDivElement>(null);

  const { workspace } = view;
  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Create a Workspace to get started.
      </div>
    );
  }

  /**
   * A Pane's Session: its terminal, or why it has none. A starting Prime or Worker waits
   * for its terminal, which shows Claude Code's own startup. Otherwise a Session that isn't
   * running offers Restart, or in a Missing Workspace, where it can't start, Change folder.
   */
  const body = (side: Side, session: SessionState) => {
    const starting = view.starting && session.role !== null;
    if (session.status !== "running" && !starting && workspace.missing) {
      return <MissingPane workspace={workspace} workspaces={workspaces} />;
    }
    return (
      <Pane
        key={session.id}
        session={session}
        focused={view.focus === side}
        starting={starting}
      />
    );
  };

  const slot = (side: Side, content: PaneContent, label: ReactNode) => (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the slot
    <div
      role="group"
      aria-label={side === "left" ? "Left Pane" : "Right Pane"}
      // Capture, so clicking into the terminal counts.
      onFocusCapture={() => view.focusPane(side)}
      className="flex min-h-0 min-w-0 flex-col"
    >
      <LabelBar>{label}</LabelBar>
      <div className="min-h-0 flex-1">
        {content.kind === "session" && body(side, content.session)}
      </div>
    </div>
  );

  const moveDivider = (clientX: number) => {
    const rect = grid.current?.getBoundingClientRect();
    if (rect && rect.width > 0) view.setRatio((clientX - rect.left) / rect.width);
  };

  const { left, right, ratio } = view;
  return (
    <div
      ref={grid}
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: columns(ratio) }}
    >
      {slot(
        "left",
        left,
        <>
          <SessionIcon session={{ role: "prime", kind: "claude" }} className="size-3" />
          Prime
        </>,
      )}
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
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
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
            view.setRatio(ratio + step);
          }
        }}
      />
      {slot(
        "right",
        right,
        <RightPaneTabs
          worker={view.worker}
          tabs={view.tabs}
          shownId={right.kind === "session" ? right.session.id : undefined}
          onShowWorker={view.showWorker}
          onShowTab={(id) => view.openOtherSession(workspace.id, id)}
          onCloseTab={view.closeTab}
        />,
      )}
    </div>
  );
}
