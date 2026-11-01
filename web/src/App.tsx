import { useEffect, useState } from "react";
import { Pane } from "@/components/Pane";
import { Sidebar } from "@/components/Sidebar";
import { ApiError, api } from "./api";
import { useOpenSession } from "./layout";
import { useAppState } from "./useAppState";

/** The app shell: the sidebar beside the main view (a single Pane for now). */
export function App() {
  const { state, refresh, reorderWorkspaces } = useAppState();
  const [openId, setOpenId] = useOpenSession();

  const [error, setError] = useState<string>();

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
        onReorderWorkspaces={reorderWorkspaces}
        onUpdateWorkspace={async (id, changes) => {
          await api.updateWorkspace(id, changes);
          await refresh();
        }}
        onDeleteWorkspace={async (id) => {
          await api.deleteWorkspace(id);
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
        onRestartSession={async (sessionId) => {
          setError(undefined);
          try {
            await api.restartSession(sessionId);
          } catch (failure) {
            if (!(failure instanceof ApiError)) throw failure;
            setError(failure.message);
          }
          await refresh();
        }}
        error={error}
      />
      <main className="min-w-0 flex-1">
        {openSession ? (
          <Pane
            key={openSession.id}
            session={openSession}
            onEnded={() => void refresh()}
          />
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
