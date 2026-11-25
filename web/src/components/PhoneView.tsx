import { ChevronDownIcon } from "lucide-react";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { PhoneView as View } from "../phoneView";
import { SessionBody } from "./WorkspaceView";

/**
 * The phone's title beside the Menu button: `Workspace › Session ▾`. When space runs short
 * the Workspace's name is cut off first, and the Session's name keeps its width.
 */
export function PhoneTitle({ view }: { view: View }) {
  const { workspace, session } = view;
  if (!workspace) return null;
  return (
    <h1 className="flex min-w-0 items-center gap-1 px-1 text-sm">
      <span className="min-w-0 truncate text-muted-foreground" title={workspace.folder}>
        {workspace.name}
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
    </h1>
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
