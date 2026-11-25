import { useEffect, useLayoutEffect, useState } from "react";
import type { SessionState, State } from "../../src/shared/state-protocol.ts";

/** What the phone's one Pane shows. */
export type PhonePaneContent =
  | { kind: "session"; session: SessionState; workspace: string }
  /** Its Session was deleted (here or on another device). */
  | { kind: "deleted" }
  | { kind: "empty" };

export interface PhonePane {
  content: PhonePaneContent;
  /** The Session on screen, if any. */
  sessionId: string | undefined;
  /** Shows a Session, from any Workspace. */
  open(sessionId: string): void;
}

const KEY = "k-bench.phone-session";

function load(): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function save(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    // Storage unavailable: the Session on screen just doesn't survive a reload.
  }
}

/**
 * The phone's one Pane, below the desktop breakpoint: whichever Session the owner last
 * opened from the drawer, from any Workspace, remembered on this device. It stands in
 * until the phone shows the Open Workspace too.
 */
export function usePhonePane(state: State | undefined): PhonePane {
  const [id, setId] = useState<string | null>(load);
  const [deleted, setDeleted] = useState(false);
  // Saved before the browser paints, so what is on screen is always what is stored.
  useLayoutEffect(() => save(id), [id]);

  let content: PhonePaneContent = { kind: "empty" };
  for (const workspace of state?.workspaces ?? []) {
    const session = workspace.sessions.find((s) => s.id === id);
    if (session) content = { kind: "session", session, workspace: workspace.name };
  }

  // A Session deleted (here or on another device) empties the Pane, with a notice, rather
  // than reconnecting to nothing.
  const gone = state !== undefined && id !== null && content.kind === "empty";
  useEffect(() => {
    if (!gone) return;
    setId(null);
    setDeleted(true);
  }, [gone]);
  if (content.kind === "empty" && (deleted || gone)) content = { kind: "deleted" };

  return {
    content,
    sessionId: content.kind === "session" ? content.session.id : undefined,
    open: (sessionId) => {
      setId(sessionId);
      setDeleted(false);
    },
  };
}
