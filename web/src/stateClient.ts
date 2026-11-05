import { decodeSnapshot, type State } from "../../src/shared/state-protocol.ts";

/**
 * The part of a WebSocket the state client uses. The browser's `WebSocket` and the `ws`
 * package's both fit.
 */
export interface EventsSocket {
  // biome-ignore lint/suspicious/noExplicitAny: both WebSocket classes type their events differently
  onopen: ((event: any) => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: both WebSocket classes type their events differently
  onmessage: ((event: any) => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: both WebSocket classes type their events differently
  onclose: ((event: any) => void) | null;
  close(): void;
}

export interface StateClientOptions {
  /** Opens the events WebSocket. Called again for every reconnect. */
  openSocket: () => EventsSocket;
  /** How long `whenShown` waits before giving up. Defaults to 5s. */
  showTimeoutMs?: number;
}

/**
 * The state the server reports, kept current over the events WebSocket, and a way to wait
 * for the effect of a change.
 */
export interface StateClient {
  /** The newest snapshot, if one has arrived. */
  readonly state: State | undefined;
  /** Calls `listener` with the current state if there is one, then with every new snapshot. */
  subscribe(listener: (state: State) => void): () => void;
  /**
   * Resolves once state shows `change`: true, or false if it timed out first (or the client
   * was closed). Resolves true at once if the snapshot that shows it already arrived.
   */
  whenShown(change: { revision: number }): Promise<boolean>;
  /**
   * Reconnects for a fresh snapshot, whose first message is the current truth. For a socket
   * that may be dead (the device slept), or state that is known to be wrong locally.
   */
  resync(): void;
  /** Disconnects for good and stops reconnecting. */
  close(): void;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
/**
 * How long a wait for a change to show lasts before the action finishes anyway, so a dialog
 * is never stuck while the events WebSocket is down. The change shows once it reconnects.
 */
const DEFAULT_SHOW_TIMEOUT_MS = 5_000;

/** A `whenShown` call waiting for a snapshot that shows its change. */
interface Waiter {
  revision: number;
  /** The events connection open when the change was answered. */
  connection: number;
  /** True when a snapshot showed the change, false when the wait timed out. */
  done: (shown: boolean) => void;
}

/**
 * Connects to the events WebSocket and keeps `state` current. Snapshots come in order on
 * the one socket, so the newest always wins. A change finishes showing when a snapshot at
 * the revision its request answered with arrives (see `StateFeed` on the server), or any
 * snapshot on a connection opened since, which is fresher still. The socket reconnects by
 * itself with backoff.
 */
export function createStateClient(options: StateClientOptions): StateClient {
  const { openSocket, showTimeoutMs = DEFAULT_SHOW_TIMEOUT_MS } = options;
  const listeners = new Set<(state: State) => void>();
  const waiters = new Set<Waiter>();
  let state: State | undefined;
  let socket: EventsSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = INITIAL_BACKOFF_MS;
  let closed = false;
  /** Counts connections, so a waiter knows a later one's snapshots are fresh. */
  let connection = 0;
  /** The revision of the newest snapshot on the current connection, if one has come. */
  let latest: number | undefined;

  const detach = () => {
    clearTimeout(retry);
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.close();
    socket = undefined;
  };

  const connect = () => {
    if (closed) return;
    detach();
    const current = ++connection;
    latest = undefined;
    const opened = openSocket();
    socket = opened;
    opened.onopen = () => {
      delay = INITIAL_BACKOFF_MS;
    };
    opened.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const snapshot = decodeSnapshot(event.data);
      if (!snapshot) return;
      const { revision, ...fresh } = snapshot;
      state = fresh;
      latest = revision;
      for (const listener of listeners) listener(fresh);
      for (const waiter of [...waiters]) {
        // A connection opened after the change was answered reads state after it, too.
        if (waiter.connection < current || revision >= waiter.revision) {
          waiter.done(true);
        }
      }
    };
    opened.onclose = () => {
      // A restarted server numbers its revisions from 0 again.
      latest = undefined;
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    };
  };

  connect();

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (state) listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    whenShown({ revision }) {
      if (closed) return Promise.resolve(false);
      // The snapshot may well arrive before the response that names its revision.
      if ((latest ?? -1) >= revision) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => waiter.done(false), showTimeoutMs);
        const waiter: Waiter = {
          revision,
          connection,
          done: (shown) => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolve(shown);
          },
        };
        waiters.add(waiter);
      });
    },
    resync: connect,
    close() {
      closed = true;
      detach();
      listeners.clear();
      for (const waiter of [...waiters]) waiter.done(false);
    },
  };
}
