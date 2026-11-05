import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EVENTS_PATH, type State } from "../../src/shared/state-protocol.ts";
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
 * An action whose form can show why it was refused rejects with an `ApiError`. Creating and
 * restarting a Session have no form: their refusal goes in `error` instead.
 */
export interface Actions {
  createWorkspace(input: { folder: string; name?: string }): Promise<void>;
  updateWorkspace(id: string, changes: { name?: string; folder?: string }): Promise<void>;
  /** Shows the new Workspace order at once, then saves it. `ids` is every Workspace. */
  reorderWorkspaces(ids: string[]): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  /**
   * The new Session's id, once it is in state. Undefined if it was refused (see `error`) or
   * did not show in time.
   */
  createSession(workspaceId: string): Promise<string | undefined>;
  renameSession(sessionId: string, name: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  restartSession(sessionId: string): Promise<void>;
}

/**
 * The Workspaces and Sessions the server reports, and the owner's actions on them.
 *
 * State only ever arrives through the `StateClient` (the events WebSocket), which this
 * mirrors into React state. An action finishes when the client says its change shows. The
 * client resyncs at once when the tab regains focus, since a socket that slept with the
 * device may look open but be dead.
 */
export function useAppState(): {
  state: State | undefined;
  actions: Actions;
  /** Why the last Session create or restart was refused, until the next one. */
  error: string | undefined;
} {
  const [state, setState] = useState<State>();
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
      createWorkspace: (input) => act(api.createWorkspace(input)),
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
      deleteWorkspace: (id) => act(api.deleteWorkspace(id)),
      createSession: (workspaceId) =>
        reporting(async () => {
          const change = await api.createSession(workspaceId);
          return (await whenShown(change)) ? change.value.id : undefined;
        }),
      renameSession: (sessionId, name) => act(api.renameSession(sessionId, name)),
      deleteSession: (sessionId) => act(api.deleteSession(sessionId)),
      restartSession: async (sessionId) => {
        await reporting(() => act(api.restartSession(sessionId)));
      },
    };
  }, []);

  return { state, actions, error };
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
