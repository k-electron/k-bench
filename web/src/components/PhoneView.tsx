import { ChevronDownIcon, MenuIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { sessionsByRole } from "../../../src/shared/session-roles.ts";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { PhoneView as View } from "../phoneView";
import type { HintMarker } from "../workspaces";
import { SessionIcon } from "./SessionIcon";
import { SessionMarker } from "./SessionMarker";
import { MARKER_SAYS, StatusDot } from "./StatusDot";
import { WorkspaceTile } from "./WorkspaceTile";
import { SessionBody } from "./WorkspaceView";

/**
 * A dot hinting at other Sessions' marker, labelled "<who> <what the marker says>" for screen
 * readers and tests. A Session's own marker is `SessionMarker`.
 */
function HintDot({
  marker,
  who,
  className,
}: {
  marker: HintMarker;
  who: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${who} ${MARKER_SAYS[marker]}`}
      className={cn("grid size-2 shrink-0 rounded-full", className)}
    >
      <StatusDot marker={marker} className="size-full" />
    </span>
  );
}

/**
 * The phone's Menu button, which opens the drawer, with a dot for Waiting or a Bell in another
 * Workspace, as a folded Workspace's tile shows.
 */
export function PhoneMenuButton({ view, onOpen }: { view: View; onOpen: () => void }) {
  return (
    // The dot sits beside the button rather than in it, so its label stays its own.
    <span className="relative ml-2 inline-flex">
      <Button variant="ghost" size="sm" aria-label="Menu" onClick={onOpen}>
        <MenuIcon />
      </Button>
      {view.hintElsewhere && (
        <HintDot
          marker={view.hintElsewhere}
          who="A session in another workspace"
          className="pointer-events-none absolute top-1 right-1.5 ring-2 ring-background"
        />
      )}
    </span>
  );
}

/**
 * The phone's title beside the Menu button, a breadcrumb `Workspace › Session ⌄`. When space
 * runs short the Workspace's name is cut off first, and the Session's name keeps its width. A
 * dot on the Workspace's name says another of its Sessions has a Bell. Tapping it opens the
 * Sessions sheet. The Session's marker follows it, outside the button.
 *
 * The breadcrumb is hand-built from spans styled like shadcn's `Breadcrumb`: that one is a
 * `nav` of list items with a `role="link"` page, none of which may sit inside a button.
 */
export function PhoneTitle({ view }: { view: View }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { workspace, session } = view;
  if (!workspace) return null;
  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <h1 className="flex min-w-0 items-center gap-1 text-sm">
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={session ? `${workspace.name} › ${session.name}` : workspace.name}
            className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className={cn("relative flex min-w-0", view.bellHere && "pr-2")}>
              <span
                className="min-w-0 truncate text-muted-foreground"
                title={workspace.folder}
              >
                {workspace.name}
              </span>
              {view.bellHere && (
                <HintDot
                  marker="bell"
                  who="Another session here"
                  className="absolute top-0 right-0"
                />
              )}
            </span>
            {session && (
              <>
                <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                  {" › "}
                </span>
                <span className="shrink-0 text-foreground">{session.name}</span>
              </>
            )}
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>
        </SheetTrigger>
        {session && <SessionMarker session={session} />}
      </h1>
      <SheetContent
        side="bottom"
        className="max-h-[80dvh] gap-0 rounded-t-2xl pb-[max(12px,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="pb-2">
          <div
            aria-hidden="true"
            className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/40"
          />
          <SheetTitle
            className="flex min-w-0 items-center gap-2 text-sm"
            title={workspace.folder}
          >
            <WorkspaceTile workspace={workspace} />
            <span className="truncate">{workspace.name}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Choose a Session to show it.
          </SheetDescription>
        </SheetHeader>
        <SessionsList
          view={view}
          workspace={workspace}
          onClose={() => setSheetOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The Sessions sheet's list: the Prime and Worker, a separator, then the Other Sessions in
 * their order. Tapping one shows it and closes the sheet. It only switches: no create or menu
 * actions.
 */
function SessionsList({
  view,
  workspace,
  onClose,
}: {
  view: View;
  workspace: WorkspaceState;
  onClose: () => void;
}) {
  const { primeAndWorker, others } = sessionsByRole(workspace.sessions);
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
    <ul aria-label="Sessions" className="grid gap-1 overflow-y-auto px-3">
      {primeAndWorker.map(row)}
      {primeAndWorker.length > 0 && others.length > 0 && (
        <li aria-hidden="true" className="px-2 py-1">
          <Separator />
        </li>
      )}
      {others.map(row)}
    </ul>
  );
}

/** One row of the Sessions sheet: icon, name, a "stopped" badge when it is, and its marker. */
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
    <li className="relative">
      <Button
        variant="ghost"
        aria-label={session.name}
        aria-current={current ? "true" : undefined}
        className={cn(
          "h-12 w-full justify-start gap-3 pr-9 pl-3 font-normal",
          current && "bg-accent shadow-[inset_3px_0_0_var(--primary)]",
          stopped && !current && "text-muted-foreground",
        )}
        onClick={onChoose}
      >
        <SessionIcon
          session={session}
          className={cn("size-4", stopped && "opacity-50")}
        />
        <span className="min-w-0 flex-1 truncate text-left">{session.name}</span>
        {stopped && (
          <Badge
            variant="outline"
            className="text-[10px] font-normal tracking-wide text-muted-foreground uppercase"
          >
            stopped
          </Badge>
        )}
      </Button>
      <SessionMarker
        session={session}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
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
          // The Extra keys type into it, but the on-screen keyboard waits for a tap.
          focused
          takesFocus={false}
          starting={view.starting}
        />
      )}
    </div>
  );
}
