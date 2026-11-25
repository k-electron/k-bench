import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LaunchOptions } from "../../src/shared/launch-options.ts";
import { sessionsByRole } from "../../src/shared/session-roles.ts";
import {
  EVENTS_PATH,
  type RightPaneState,
  type State,
} from "../../src/shared/state-protocol.ts";
import { ApiError, api, type Change } from "./api";
import { createStateClient, type StateClient } from "./stateClient";

/** The events WebSocket URL: the server pushes a full state snapshot on every change. */
function eventsUrl(): string {
  const url = new URL(EVENTS_PATH, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * The owner's actions. Each one finishes once its change is in `state`, so whatever runs
 * after it (closing a dialog, opening a new Session in a Pane) sees the result.
 *
 * An action whose form can show why it was refused rejects with an `ApiError`. Opening a
 * Workspace, and creating and restarting a Session, have no form: their refusal goes in
 * `error` instead.
 */
export interface Actions {
  /**
   * When the folder already has a Workspace, opens that one instead with `openExisting` (the
   * view's open, as choosing its name) and says so in `error`, so the owner ends up where
   * they meant to be. Any other refusal rejects.
   */
  createWorkspace(
    input: {
      folder: string;
      name?: string;
      createMissingFolders?: boolean;
    },
    openExisting: (id: string) => void,
  ): Promise<void>;
  updateWorkspace(
    id: string,
    changes: { name?: string; folder?: string; createMissingFolders?: boolean },
  ): Promise<void>;
  /** Shows the new Workspace order at once, then saves it. `ids` is every Workspace. */
  reorderWorkspaces(ids: string[]): Promise<void>;
  /**
   * Makes it the Open Workspace, on every device, and starts its Prime and Worker. With
   * `showWorker` (chosen by its name), its right Pane shows the Worker again, at once.
   */
  openWorkspace(id: string, options?: { showWorker?: boolean }): Promise<void>;
  /**
   * Shows what the Workspace's right Pane holds at once, then saves it on the Host, so
   * every device follows.
   */
  setRightPane(workspaceId: string, rightPane: RightPaneState): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  /**
   * The new Session's id, once it is in state. Undefined if it was refused (see `error`) or
   * did not show in time.
   */
  createSession(workspaceId: string): Promise<string | undefined>;
  /**
   * Launches a Claude Session and resolves with its id once it is in state (undefined if it
   * did not show in time). Its dialog shows why it was refused, so a refusal rejects with an
   * `ApiError` instead of going in `error`.
   */
  createClaudeSession(
    workspaceId: string,
    input: { name?: string; claude: LaunchOptions },
  ): Promise<string | undefined>;
  renameSession(sessionId: string, name: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  restartSession(sessionId: string): Promise<void>;
  /**
   * Shows the Workspace's new Other Session order at once, then saves it. `ids` is every
   * Other Session of the Workspace; its Prime and Worker stay first.
   */
  reorderSessions(workspaceId: string, ids: string[]): Promise<void>;
}

/** A change to a Workspace's right Pane, shown before the Host's snapshots have it. */
interface PendingRightPane {
  workspaceId: string;
  change: (current: RightPaneState) => RightPaneState;
}

/** `state` with the right Pane changes still on their way applied, oldest first. */
function withPendingRightPanes(
  state: State | undefined,
  pending: readonly PendingRightPane[],
): State | undefined {
  if (!state || pending.length === 0) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((w) => ({
      ...w,
      rightPane: pending.reduce(
        (rightPane, p) => (p.workspaceId === w.id ? p.change(rightPane) : rightPane),
        w.rightPane,
      ),
    })),
  };
}

/**
 * The Workspaces and Sessions the server reports, and the owner's actions on them.
 *
 * State only ever arrives through the `StateClient` (the events WebSocket), which this
 * mirrors into React state. An action finishes when the client says its change shows. The
 * client resyncs at once when the tab regains focus, since a socket that slept with the
 * device may look open but be dead.
 *
 * A change to a right Pane shows at once and stays shown until a snapshot has it: a snapshot
 * the Host sent before it got the change must not take the Pane back meanwhile, which would
 * swap the terminal under the owner's typing.
 */
export function useAppState(): {
  state: State | undefined;
  actions: Actions;
  /**
   * Why the last Session create or restart, or Workspace open, was refused, or that a new
   * Workspace's folder already had one; until the next of those.
   */
  error: string | undefined;
} {
  const [state, setState] = useState<State>();
  const [pendingRightPanes, setPendingRightPanes] = useState<readonly PendingRightPane[]>(
    [],
  );
  const [error, setError] = useState<string>();
  const clientRef = useRef<StateClient>(undefined);

  useEffect(() => {
    const created = createStateClient({ openSocket: () => new WebSocket(eventsUrl()) });
    clientRef.current = created;
    const unsubscribe = created.subscribe(setState);
    const resync = () => created.resync();
    window.addEventListener("focus", resync);
    return () => {
      window.removeEventListener("focus", resync);
      unsubscribe();
      created.close();
      clientRef.current = undefined;
    };
  }, []);

  const actions = useMemo((): Actions => {
    const whenShown = (change: Change<unknown>) =>
      clientRef.current?.whenShown(change) ?? Promise.resolve(false);
    const act = async (request: Promise<Change<unknown>>) => {
      await whenShown(await request);
    };
    /**
     * Shows a change to a Workspace's right Pane at once, over every snapshot, until `save`
     * finishes: once its change shows, or it was refused or timed out, the Host's state rules.
     */
    const showRightPane = async (
      workspaceId: string,
      change: (current: RightPaneState) => RightPaneState,
      save: () => Promise<unknown>,
    ) => {
      const pending: PendingRightPane = { workspaceId, change };
      setPendingRightPanes((list) => [...list, pending]);
      try {
        await save();
      } finally {
        setPendingRightPanes((list) => list.filter((p) => p !== pending));
      }
    };
    /** For the actions with no form: a refusal goes in `error` rather than rejecting. */
    const reporting = async <T>(request: () => Promise<T>): Promise<T | undefined> => {
      setError(undefined);
      try {
        return await request();
      } catch (failure) {
        if (!(failure instanceof ApiError)) throw failure;
        setError(failure.message);
        return undefined;
      }
    };

    return {
      createWorkspace: async (input, openExisting) => {
        try {
          await act(api.createWorkspace(input));
        } catch (failure) {
          if (!(failure instanceof ApiError) || !failure.folderOwner) throw failure;
          // Opening clears `error` as it starts, so the message is set after it.
          openExisting(failure.folderOwner.id);
          setError(failure.message);
        }
      },
      updateWorkspace: (id, changes) => act(api.updateWorkspace(id, changes)),
      reorderWorkspaces: (ids) => {
        setState(
          (current) =>
            current && {
              ...current,
              workspaces: ids.flatMap(
                (id) => current.workspaces.find((w) => w.id === id) ?? [],
              ),
            },
        );
        // A refused order sends no snapshot: resync for one, putting the order right.
        return act(api.reorderWorkspaces(ids)).catch(() => clientRef.current?.resync());
      },
      openWorkspace: async (id, options = {}) => {
        const open = () => reporting(() => act(api.openWorkspace(id, options)));
        if (options.showWorker) {
          await showRightPane(id, (current) => ({ ...current, shown: null }), open);
        } else {
          await open();
        }
      },
      setRightPane: (workspaceId, rightPane) =>
        showRightPane(
          workspaceId,
          () => rightPane,
          // A refused change sends no snapshot: resync for one, putting the Pane right.
          () =>
            act(api.setRightPane(workspaceId, rightPane)).catch(() =>
              clientRef.current?.resync(),
            ),
        ),
      deleteWorkspace: (id) => act(api.deleteWorkspace(id)),
      createSession: (workspaceId) =>
        reporting(async () => {
          const change = await api.createSession(workspaceId);
          return (await whenShown(change)) ? change.value.id : undefined;
        }),
      createClaudeSession: async (workspaceId, input) => {
        const change = await api.createSession(workspaceId, input);
        return (await whenShown(change)) ? change.value.id : undefined;
      },
      renameSession: (sessionId, name) => act(api.renameSession(sessionId, name)),
      deleteSession: (sessionId) => act(api.deleteSession(sessionId)),
      restartSession: async (sessionId) => {
        await reporting(() => act(api.restartSession(sessionId)));
      },
      reorderSessions: (workspaceId, ids) => {
        setState(
          (current) =>
            current && {
              ...current,
              workspaces: current.workspaces.map((w) =>
                w.id === workspaceId
                  ? {
                      ...w,
                      sessions: [
                        ...sessionsByRole(w.sessions).primeAndWorker,
                        ...ids.flatMap((id) => w.sessions.find((s) => s.id === id) ?? []),
                      ],
                    }
                  : w,
              ),
            },
        );
        // A refused order sends no snapshot: resync for one, putting the order right.
        return act(api.reorderSessions(workspaceId, ids)).catch(() =>
          clientRef.current?.resync(),
        );
      },
    };
  }, []);

  const shown = useMemo(
    () => withPendingRightPanes(state, pendingRightPanes),
    [state, pendingRightPanes],
  );
  return { state: shown, actions, error };
}

const ActionsContext = createContext<Actions | undefined>(undefined);

/** Gives every component below it the owner's actions (see `useActions`). */
export const ActionsProvider = ActionsContext.Provider;

/** The owner's actions, from the nearest `ActionsProvider`. */
export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("useActions needs an ActionsProvider above it");
  return actions;
}
