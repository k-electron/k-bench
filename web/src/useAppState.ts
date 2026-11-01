import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type AppState, api, type Change } from "./api";

/** The events WebSocket URL: the server pushes a full state snapshot on every change. */
function eventsUrl(): string {
  const url = new URL("/api/events", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const MAX_BACKOFF_MS = 10_000;
/**
 * How long an action waits for its change to show before it finishes anyway, so a dialog is
 * never stuck while the events WebSocket is down. The change shows once it reconnects.
 */
const SHOW_WAIT_MS = 5_000;

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

/** An action waiting for a snapshot that shows its change. */
interface Waiter {
  revision: number;
  /** The events connection open when the change was answered. */
  connection: number;
  /** True when a snapshot showed the change, false when the wait timed out. */
  done: (shown: boolean) => void;
}

/**
 * The Workspaces and Sessions the server reports, and the owner's actions on them.
 *
 * State only ever arrives over the events WebSocket: a full snapshot on connecting, then one
 * on every change from any device. Snapshots come in order on the one socket, so the newest
 * always wins. An action finishes when a snapshot at the revision its request answered with
 * arrives (see `StateFeed` on the server), or any snapshot on a connection opened since, which
 * is fresher still. The socket reconnects by itself with backoff, and at once when the tab
 * regains focus, since a socket that slept with the device may look open but be dead.
 */
export function useAppState(): {
  state: AppState | undefined;
  actions: Actions;
  /** Why the last Session create or restart was refused, until the next one. */
  error: string | undefined;
} {
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState<string>();
  const waiters = useRef(new Set<Waiter>());
  /** Counts events connections, so a waiter knows a later one's snapshots are fresh. */
  const connection = useRef(0);
  /** The revision of the newest snapshot on the current connection, if one has come. */
  const latest = useRef<number>(undefined);
  /** Reconnects the events WebSocket, whose first snapshot is the current truth. */
  const reconnect = useRef(() => {});

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;

    const connect = () => {
      clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      const current = ++connection.current;
      latest.current = undefined;
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        delay = 500;
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        const { revision, ...snapshot } = JSON.parse(event.data) as AppState & {
          revision: number;
        };
        setState(snapshot);
        latest.current = revision;
        for (const waiter of waiters.current) {
          // A connection opened after the change was answered reads state after it, too.
          if (waiter.connection < current || revision >= waiter.revision) {
            waiter.done(true);
          }
        }
      };
      socket.onclose = () => {
        // A restarted server numbers its revisions from 0 again.
        latest.current = undefined;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      };
    };
    connect();
    reconnect.current = connect;

    window.addEventListener("focus", connect);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("focus", connect);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  const actions = useMemo((): Actions => {
    /** Resolves once state shows `change`: true, or false if it timed out first. */
    const whenShown = ({ revision }: Change<unknown>): Promise<boolean> => {
      // The snapshot may well arrive before the response that names its revision.
      if ((latest.current ?? -1) >= revision) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => waiter.done(false), SHOW_WAIT_MS);
        const waiter: Waiter = {
          revision,
          connection: connection.current,
          done: (result) => {
            clearTimeout(timer);
            waiters.current.delete(waiter);
            resolve(result);
          },
        };
        waiters.current.add(waiter);
      });
    };
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
        // A refused order sends no snapshot: reconnect for one, putting the order right.
        return act(api.reorderWorkspaces(ids)).catch(() => reconnect.current());
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
