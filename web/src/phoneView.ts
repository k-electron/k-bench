import { useEffect, useLayoutEffect, useState } from "react";
import type {
  SessionState,
  State,
  WorkspaceState,
} from "../../src/shared/state-protocol.ts";
import type { WorkspaceView } from "./workspaceView";

export interface PhoneView {
  /** The Open Workspace, which the phone shows one Session of. */
  workspace: WorkspaceState | undefined;
  /** The Session on screen: the one last shown in the Open Workspace, or its Prime. */
  session: SessionState | undefined;
  /** As `WorkspaceView.starting`: a Stopped Prime or Worker waits rather than offering Restart. */
  starting: boolean;
  /** Shows a Session of the Open Workspace (`workspaceId`), remembering it on this device. */
  show(workspaceId: string, sessionId: string): void;
  /** Opens a Workspace (choosing it by name), which shows its Prime. */
  openWorkspace(id: string): void;
}

/**
 * Where the browser keeps the Session the phone shows in each Workspace, which stays on
 * this device and apart from the desktop's right Pane.
 */
const SHOWN_KEY = "k-bench.phone-sessions";

/** Where the phone kept its one Session before it showed the Open Workspace. */
const RETIRED_KEY = "k-bench.phone-session";

function loadShown(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "{}");
    if (typeof saved !== "object" || saved === null) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, id]) => typeof id === "string"),
    );
  } catch {
    // Storage unavailable or garbled: every Workspace shows its Prime.
    return {};
  }
}

function saveShown(shown: Record<string, string>): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    // Storage unavailable: what the phone shows lasts until the page is closed.
  }
}

/**
 * The phone view, below the desktop breakpoint: one Session of the Open Workspace. Which one
 * is remembered per Workspace in this browser's storage; it is the Prime when nothing is
 * saved or the saved Session no longer exists.
 *
 * Opening goes through the desktop view's `open`, which leaves its right Pane alone, so
 * the open on load and `starting` are shared with it.
 */
export function usePhoneView(
  state: State | undefined,
  { open, starting }: Pick<WorkspaceView, "open" | "starting">,
): PhoneView {
  const [shown, setShown] = useState(loadShown);
  // Saved before the browser paints, so what is on screen is always what is stored.
  useLayoutEffect(() => saveShown(shown), [shown]);

  useEffect(() => {
    try {
      localStorage.removeItem(RETIRED_KEY);
    } catch {
      // Storage unavailable: there is nothing saved to throw away either.
    }
  }, []);

  const workspace = state?.workspaces.find((w) => w.id === state.openWorkspaceId);
  const sessions = workspace?.sessions ?? [];
  const saved = workspace && shown[workspace.id];
  const session =
    sessions.find((s) => s.id === saved) ?? sessions.find((s) => s.role === "prime");

  return {
    workspace,
    session,
    starting,
    show: (workspaceId, sessionId) =>
      setShown((current) => ({ ...current, [workspaceId]: sessionId })),
    openWorkspace: (id) => {
      setShown(({ [id]: _forgotten, ...rest }) => rest);
      open(id);
    },
  };
}
