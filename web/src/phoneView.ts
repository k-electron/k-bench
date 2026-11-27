import { useEffect, useLayoutEffect, useState } from "react";
import { sessionsByRole } from "../../src/shared/session-roles.ts";
import type {
  SessionState,
  State,
  WorkspaceState,
} from "../../src/shared/state-protocol.ts";
import { loadPerWorkspace, savePerWorkspace } from "./perWorkspaceStorage";
import { findOpenWorkspace, type HintMarker, hintMarker } from "./workspaces";
import type { WorkspaceView } from "./workspaceView";

export interface PhoneView {
  /** The Open Workspace, which the phone shows one Session of. */
  workspace: WorkspaceState | undefined;
  /** The Session on screen: the one last shown in the Open Workspace, or its Prime. */
  session: SessionState | undefined;
  /** As `WorkspaceView.starting`: a Stopped Prime or Worker waits rather than offering Restart. */
  starting: boolean;
  /** Some Session of the Open Workspace other than the one on screen has a Bell. */
  bellHere: boolean;
  /** The hint for the Sessions of every other Workspace, as a folded Workspace's tile has. */
  hintElsewhere: HintMarker | null;
  /** Shows a Session of the Open Workspace (`workspaceId`), remembering it on this device. */
  show(workspaceId: string, sessionId: string): void;
}

/**
 * Where the browser keeps the Session the phone shows in each Workspace, which stays on
 * this device and apart from the desktop's right Pane.
 */
const SHOWN_KEY = "k-bench.phone-sessions";

/** Where the phone kept its one Session before it showed the Open Workspace. */
const RETIRED_KEY = "k-bench.phone-session";

/**
 * The phone view, below the desktop breakpoint: one Session of the Open Workspace. Which one
 * is remembered per Workspace in this browser's storage; it is the Prime when nothing is
 * saved or the saved Session no longer exists.
 *
 * Workspaces are opened by the desktop view's `open`, which also does the open on load, so
 * `starting` is shared with it.
 */
export function usePhoneView(
  state: State | undefined,
  { starting }: Pick<WorkspaceView, "starting">,
): PhoneView {
  const [shown, setShown] = useState(() =>
    loadPerWorkspace(SHOWN_KEY, (id): id is string => typeof id === "string"),
  );
  // Saved before the browser paints, so what is on screen is always what is stored.
  useLayoutEffect(() => savePerWorkspace(SHOWN_KEY, shown), [shown]);

  useEffect(() => {
    try {
      localStorage.removeItem(RETIRED_KEY);
    } catch {
      // Storage unavailable: there is nothing saved to throw away either.
    }
  }, []);

  const workspace = findOpenWorkspace(state);
  const sessions = workspace?.sessions ?? [];
  const saved = workspace && shown[workspace.id];
  const session = sessions.find((s) => s.id === saved) ?? sessionsByRole(sessions).prime;

  return {
    workspace,
    session,
    starting,
    bellHere: sessions.some((s) => s.bell && s.id !== session?.id),
    hintElsewhere: hintMarker(
      (state?.workspaces ?? []).filter((w) => w !== workspace).flatMap((w) => w.sessions),
    ),
    show: (workspaceId, sessionId) =>
      setShown((current) => ({ ...current, [workspaceId]: sessionId })),
  };
}
