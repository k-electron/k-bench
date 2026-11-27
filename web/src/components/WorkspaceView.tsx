import { type ReactNode, useRef, useState } from "react";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { PaneContent, Side, WorkspaceView as View } from "../workspaceView";
import { MissingPane } from "./MissingPane";
import { Pane } from "./Pane";
import { RightPaneTabs } from "./RightPaneTabs";
import { SessionIcon } from "./SessionIcon";
import { SessionMarker } from "./SessionMarker";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** How wide a shut Pane's rail is. */
const RAIL = "36px";

/** The CSS grid columns of the two Panes, with the divider's 6px between them. */
function columns(ratio: number, shut: Side | null): string {
  if (shut === "left") return `${RAIL} 6px minmax(0, 1fr)`;
  if (shut === "right") return `minmax(0, 1fr) 6px ${RAIL}`;
  return `minmax(0, ${ratio}fr) 6px minmax(0, ${1 - ratio}fr)`;
}

/**
 * What a shut Pane leaves: a thin rail, a ghost `Button` with its Session's icon and its
 * name written vertically, then the Session's marker slot. Its terminal is detached, so the
 * Session can ring its Bell. Clicking it reopens the Pane; its tooltip opens towards the
 * other Pane.
 */
function Rail({
  side,
  session,
  onOpen,
}: {
  side: Side;
  session: SessionState;
  onOpen: () => void;
}) {
  const label = `Show ${session.name}`;
  return (
    <div className="relative h-full border-x bg-sidebar">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={label}
            onClick={onOpen}
            className="h-full w-full flex-col justify-start gap-2 rounded-none px-0 py-3 text-xs font-normal text-muted-foreground"
          >
            <SessionIcon session={session} className="size-4" />
            <span className="min-h-0 truncate" style={{ writingMode: "vertical-rl" }}>
              {session.name}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side === "left" ? "right" : "left"}>{label}</TooltipContent>
      </Tooltip>
      <span className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2">
        <SessionMarker session={session} />
      </span>
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
  takesFocus,
  starting,
}: {
  session: SessionState;
  /** The Workspace it belongs to. */
  workspace: WorkspaceState;
  /** Every Workspace, for the folder picker of a Missing one's Change folder. */
  workspaces: WorkspaceState[];
  /** Whether its terminal should have the keyboard. */
  focused: boolean;
  /** Passed to `TerminalView`. */
  takesFocus?: boolean;
  /** The Workspace is being opened, which starts its Prime and Worker. */
  starting: boolean;
}) {
  const waiting = starting && session.role !== null;
  if (session.status !== "running" && !waiting && workspace.missing) {
    return <MissingPane workspace={workspace} workspaces={workspaces} />;
  }
  return (
    <Pane
      key={session.id}
      session={session}
      focused={focused}
      takesFocus={takesFocus}
      starting={waiting}
    />
  );
}

/** The bar naming what a Pane shows. */
function LabelBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
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
  const [dragging, setDragging] = useState(false);

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
        <Rail side={side} session={content.session} onOpen={() => view.reopen(side)} />
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
        <span className="flex items-center gap-1.5 px-1 text-sm font-medium">
          <SessionIcon session={{ role: "prime", kind: "claude" }} className="size-3.5" />
          Prime
          {left.kind === "session" && <SessionMarker session={left.session} />}
        </span>,
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
        data-dragging={dragging || undefined}
        // Lights up in the accent on hover and while dragging.
        className="cursor-col-resize touch-none bg-border transition-colors hover:bg-primary focus-visible:bg-primary data-dragging:bg-primary"
        onPointerDown={(event) => {
          dragFrom.current = ratio;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        // Covers both letting go and a cancelled drag.
        onLostPointerCapture={() => setDragging(false)}
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
