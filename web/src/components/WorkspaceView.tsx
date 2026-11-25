import { type ReactNode, useRef } from "react";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { PaneContent, Side, WorkspaceView as View } from "../workspaceView";
import { MissingPane } from "./MissingPane";
import { Pane } from "./Pane";
import { RightPaneTabs } from "./RightPaneTabs";
import { SessionIcon } from "./SessionIcon";

/** How wide a shut Pane's rail is. */
const RAIL = "28px";

/** The CSS grid columns of the two Panes, with the divider's 6px between them. */
function columns(ratio: number, shut: Side | null): string {
  if (shut === "left") return `${RAIL} 6px minmax(0, 1fr)`;
  if (shut === "right") return `minmax(0, 1fr) 6px ${RAIL}`;
  return `minmax(0, ${ratio}fr) 6px minmax(0, ${1 - ratio}fr)`;
}

/**
 * What a shut Pane leaves: a thin rail with its Session's icon, its name written
 * vertically and a Bell dot. Its terminal is detached, so the Session can ring its Bell.
 * Clicking it reopens the Pane.
 */
function Rail({ session, onOpen }: { session: SessionState; onOpen: () => void }) {
  return (
    <div className="relative h-full">
      <button
        type="button"
        aria-label={`Show ${session.name}`}
        title={`Show ${session.name}`}
        onClick={onOpen}
        className="flex h-full w-full flex-col items-center gap-2 bg-card py-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <SessionIcon session={session} className="size-4" />
        <span className="min-h-0 truncate" style={{ writingMode: "vertical-rl" }}>
          {session.name}
        </span>
      </button>
      {session.bell && (
        <span
          role="img"
          aria-label={`${session.name} rang the bell`}
          className="pointer-events-none absolute bottom-3 left-1/2 size-2 -translate-x-1/2 rounded-full bg-amber-400"
        />
      )}
    </div>
  );
}

/**
 * A Session's terminal in a Pane, or why it has none. A starting Prime or Worker waits for
 * its terminal, which shows Claude Code's own startup. Otherwise a Session that isn't
 * running offers Restart, or in a Missing Workspace, where it can't start, Change folder.
 * The desktop's Panes and the phone's one Session on screen both show this.
 */
export function SessionBody({
  session,
  workspace,
  workspaces,
  focused,
  starting,
}: {
  session: SessionState;
  /** The Workspace it belongs to. */
  workspace: WorkspaceState;
  /** Every Workspace, for the folder picker of a Missing one's Change folder. */
  workspaces: WorkspaceState[];
  /** Whether its terminal should have the keyboard. */
  focused: boolean;
  /** The Workspace is being opened, which starts its Prime and Worker. */
  starting: boolean;
}) {
  const waiting = starting && session.role !== null;
  if (session.status !== "running" && !waiting && workspace.missing) {
    return <MissingPane workspace={workspace} workspaces={workspaces} />;
  }
  return <Pane key={session.id} session={session} focused={focused} starting={waiting} />;
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
  // Where the divider was when a drag began: a drag that shuts a Pane reopens it there.
  const dragFrom = useRef(view.ratio);

  const { workspace } = view;
  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Create a Workspace to get started.
      </div>
    );
  }

  const body = (side: Side, session: SessionState) => (
    <SessionBody
      session={session}
      workspace={workspace}
      workspaces={workspaces}
      focused={view.focusedTerminal === side}
      starting={view.starting}
    />
  );

  const slot = (side: Side, content: PaneContent, label: ReactNode) => (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the slot
    <div
      role="group"
      aria-label={side === "left" ? "Left Pane" : "Right Pane"}
      // Capture, so clicking into the terminal counts.
      onFocusCapture={() => view.focusTerminal(side)}
      className="flex min-h-0 min-w-0 flex-col"
    >
      {view.shut === side && content.kind === "session" ? (
        <Rail session={content.session} onOpen={() => view.reopen(side)} />
      ) : (
        <>
          <LabelBar>{label}</LabelBar>
          <div className="min-h-0 flex-1">
            {content.kind === "session" && body(side, content.session)}
          </div>
        </>
      )}
    </div>
  );

  const { left, right, ratio, shut } = view;
  const moveDivider = (clientX: number) => {
    const rect = grid.current?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      view.setRatio((clientX - rect.left) / rect.width, dragFrom.current);
    }
  };
  const position = shut === "left" ? 0 : shut === "right" ? 1 : ratio;

  return (
    <div
      ref={grid}
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: columns(ratio, shut) }}
    >
      {slot(
        "left",
        left,
        <>
          <SessionIcon session={{ role: "prime", kind: "claude" }} className="size-3" />
          Prime
        </>,
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resizable divider */}
      <div
        role="separator"
        aria-label="Resize panes"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position * 100)}
        title="Drag to resize, or to an edge to shut a Pane. Double-click for half and half."
        tabIndex={0}
        className="cursor-col-resize touch-none bg-border hover:bg-primary focus-visible:bg-primary"
        onPointerDown={(event) => {
          dragFrom.current = ratio;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            moveDivider(event.clientX);
          }
        }}
        onDoubleClick={() => view.setRatio(0.5)}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
          if (!step) return;
          event.preventDefault();
          // A step away from a shut Pane's edge reopens it; a step into an edge shuts.
          if (!shut) view.setRatio(ratio + step);
          else if ((shut === "left") === step > 0) view.reopen(shut);
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
