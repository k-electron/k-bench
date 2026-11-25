import { ChevronDownIcon, MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { PhoneView as View } from "../phoneView";
import { SessionIcon } from "./SessionIcon";
import { SessionBody } from "./WorkspaceView";

/** An amber Bell dot, labelled for screen readers and tests. */
function BellDot({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("size-2 shrink-0 rounded-full bg-amber-400", className)}
    />
  );
}

/** The phone's Menu button, which opens the drawer, with a dot for a Bell in another Workspace. */
export function PhoneMenuButton({ view, onOpen }: { view: View; onOpen: () => void }) {
  return (
    // The dot sits beside the button rather than in it, so its label stays its own.
    <span className="relative ml-2 inline-flex">
      <Button variant="ghost" size="sm" aria-label="Menu" onClick={onOpen}>
        <MenuIcon />
      </Button>
      {view.bellElsewhere && (
        <BellDot
          label="A session in another workspace rang the bell"
          className="pointer-events-none absolute top-1 right-1.5 ring-2 ring-background"
        />
      )}
    </span>
  );
}

/**
 * The phone's title beside the Menu button: `Workspace › Session ▾`. When space runs short
 * the Workspace's name is cut off first, and the Session's name keeps its width. A dot on the
 * Workspace's name says another of its Sessions has a Bell. Tapping it opens the Sessions sheet.
 */
export function PhoneTitle({ view }: { view: View }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { workspace, session } = view;
  if (!workspace) return null;
  return (
    <>
      <h1 className="flex min-w-0 text-sm">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 hover:bg-accent"
          onClick={() => setSheetOpen(true)}
        >
          <span className={cn("relative flex min-w-0", view.bellHere && "pr-2")}>
            <span
              className="min-w-0 truncate text-muted-foreground"
              title={workspace.folder}
            >
              {workspace.name}
            </span>
            {view.bellHere && (
              <BellDot
                label="Another session here rang the bell"
                className="absolute top-0 right-0"
              />
            )}
          </span>
          {session && (
            <>
              <span className="shrink-0 text-muted-foreground"> › </span>
              <span className="shrink-0">{session.name}</span>
            </>
          )}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
      </h1>
      {sheetOpen && (
        <SessionsSheet
          view={view}
          workspace={workspace}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The Sessions sheet: the Open Workspace's Sessions from the bottom of the screen, Prime and
 * Worker, a divider, then the Other Sessions in their order. Tapping one shows it; tapping
 * outside closes the sheet. It only switches: no create or menu actions.
 */
function SessionsSheet({
  view,
  workspace,
  onClose,
}: {
  view: View;
  workspace: WorkspaceState;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fixed = workspace.sessions.filter((s) => s.role !== null);
  const others = workspace.sessions.filter((s) => s.role === null);
  const row = (session: SessionState) => (
    <SheetRow
      key={session.id}
      session={session}
      current={session.id === view.session?.id}
      onChoose={() => {
        view.show(workspace.id, session.id);
        onClose();
      }}
    />
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sessions"
      className="fixed inset-0 z-40 flex flex-col justify-end font-normal"
    >
      <button
        type="button"
        aria-label="Close sessions"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t bg-card p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/40"
        />
        <div
          className="truncate px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          title={workspace.folder}
        >
          {workspace.name}
        </div>
        <ul className="grid gap-1">
          {fixed.map(row)}
          {fixed.length > 0 && others.length > 0 && (
            <li aria-hidden="true" className="mx-2 my-1 border-t" />
          )}
          {others.map(row)}
        </ul>
      </div>
    </div>
  );
}

/** One row of the Sessions sheet: icon, name, "stopped" when it is, and its Bell. */
function SheetRow({
  session,
  current,
  onChoose,
}: {
  session: SessionState;
  current: boolean;
  onChoose: () => void;
}) {
  const stopped = session.status === "stopped";
  return (
    <li>
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm",
          current ? "bg-accent text-foreground" : "hover:bg-accent/60",
          stopped && !current && "text-muted-foreground",
        )}
        onClick={onChoose}
      >
        <SessionIcon
          session={session}
          className={cn("size-4", stopped && "opacity-50")}
        />
        <span className="min-w-0 flex-1 truncate">{session.name}</span>
        {stopped && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            stopped
          </span>
        )}
        {session.bell && <BellDot label={`${session.name} rang the bell`} />}
      </button>
    </li>
  );
}

/**
 * The main view on a phone: one Session of the Open Workspace, filling the screen. Only it
 * has a terminal attached, so every other Session can ring its Bell.
 */
export function PhoneView({
  view,
  workspaces,
}: {
  view: View;
  /** Every Workspace, for the folder picker of a Missing one's Change folder. */
  workspaces: WorkspaceState[];
}) {
  const { workspace, session } = view;
  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Create a Workspace to get started.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1">
      {session && (
        <SessionBody
          session={session}
          workspace={workspace}
          workspaces={workspaces}
          focused
          starting={view.starting}
        />
      )}
    </div>
  );
}
