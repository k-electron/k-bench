import { useEffect } from "react";
import { Pane } from "@/components/Pane";
import { Sidebar } from "@/components/Sidebar";
import { api } from "./api";
import { useOpenSession } from "./layout";
import { useAppState } from "./useAppState";

/** The app shell: the sidebar beside the main view (a single Pane for now). */
export function App() {
  const { state, refresh } = useAppState();
  const [openId, setOpenId] = useOpenSession();

  const sessions = state?.workspaces.flatMap((w) => w.sessions) ?? [];
  const openSession = sessions.find((s) => s.id === openId);

  // The open Session was deleted elsewhere: forget it rather than reconnect to nothing.
  useEffect(() => {
    if (state && openId && !openSession) setOpenId(undefined);
  }, [state, openId, openSession, setOpenId]);

  return (
    <div className="flex h-full">
      <Sidebar
        state={state}
        openId={openId}
        onOpen={setOpenId}
        onCreateWorkspace={async (input) => {
          await api.createWorkspace(input);
          await refresh();
        }}
        onCreateSession={async (workspaceId) => {
          const session = await api.createSession(workspaceId);
          await refresh();
          setOpenId(session.id);
        }}
        onRenameSession={async (sessionId, name) => {
          await api.renameSession(sessionId, name);
          await refresh();
        }}
        onDeleteSession={async (sessionId) => {
          await api.deleteSession(sessionId);
          await refresh();
        }}
      />
      <main className="min-w-0 flex-1">
        {openSession ? (
          <Pane key={openSession.id} session={openSession} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {state?.workspaces.length === 0
              ? "Create a Workspace to get started."
              : "Select a Session."}
          </div>
        )}
      </main>
    </div>
  );
}
