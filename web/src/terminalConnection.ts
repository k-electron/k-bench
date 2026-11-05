import {
  CLOSE_SESSION_ENDED,
  type ClientMessage,
  encodeClientMessage,
  type TerminalSize,
  terminalPath,
} from "../../src/shared/terminal-protocol.ts";

/**
 * The part of a WebSocket the terminal connection uses. The browser's `WebSocket` and the
 * `ws` package's both fit.
 */
export interface TerminalSocket {
  binaryType: string;
  readonly readyState: number;
  // biome-ignore lint/suspicious/noExplicitAny: both WebSocket classes type their events differently
  onopen: ((event: any) => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: both WebSocket classes type their events differently
  onmessage: ((event: any) => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: both WebSocket classes type their events differently
  onclose: ((event: any) => void) | null;
  send(data: string): void;
  close(): void;
}

// WebSocket's `readyState` values, spelled out so nothing here needs the browser's global.
const CONNECTING = 0;
const OPEN = 1;

const DEFAULT_RETRY_FIRST_MS = 500;
const DEFAULT_RETRY_MAX_MS = 5000;

export interface TerminalConnectionOptions {
  sessionId: string;
  /** The terminal's size now; the socket opens at it, and so does every reconnect. */
  size: TerminalSize;
  /** Opens the terminal WebSocket at `path` (from `terminalPath`). Called again for every retry. */
  openSocket: (path: string) => TerminalSocket;
  /**
   * Subscribes `retry` to whatever says the network may be back (the page became visible,
   * the browser went online) and returns how to unsubscribe. Optional.
   */
  wake?: (retry: () => void) => () => void;
  /** The first retry's delay; each further one doubles it up to `retryMaxMs`. Defaults to 500. */
  retryFirstMs?: number;
  /** The longest retry delay. Defaults to 5000. */
  retryMaxMs?: number;
}

/** What a connection reports. Output arrives as the bytes the Session's terminal shows. */
export interface TerminalListener {
  output(bytes: Uint8Array): void;
  /**
   * True when the connection dropped and is retrying; false once it is back. tmux redraws
   * the whole screen on every attach, so a view clears itself when this turns false.
   */
  reconnecting(on: boolean): void;
  /** The Session was deleted or its shell exited: the connection will not retry. */
  ended(): void;
}

/**
 * The browser's connection to one Session's terminal, speaking
 * `src/shared/terminal-protocol.ts`: the counterpart of the server's `Attachments`, with no
 * React and no xterm.js.
 */
export interface TerminalConnection {
  /**
   * Sends what the terminal typed or answered. `automatic` marks input the terminal sent by
   * itself rather than for the owner. Kept until the socket opens if it is still opening;
   * dropped while a retry waits.
   */
  input(data: string, automatic?: boolean): void;
  /** The terminal changed size. Reconnects open at the newest size. */
  resize(cols: number, rows: number): void;
  /** Calls the listener's handlers for what happens from now on. Returns how to stop. */
  subscribe(listener: Partial<TerminalListener>): () => void;
  /** Disconnects for good and stops reconnecting. */
  close(): void;
}

/**
 * Opens the terminal and keeps it connected. When the socket drops it reconnects by itself
 * with backoff, reporting `reconnecting` meanwhile, and retries at once when `wake` fires
 * unless a socket is already opening. A close with `CLOSE_SESSION_ENDED` reports `ended` and
 * is never retried.
 */
export function createTerminalConnection(
  options: TerminalConnectionOptions,
): TerminalConnection {
  const {
    sessionId,
    openSocket,
    wake,
    retryFirstMs = DEFAULT_RETRY_FIRST_MS,
    retryMaxMs = DEFAULT_RETRY_MAX_MS,
  } = options;
  const listeners = new Set<Partial<TerminalListener>>();
  let size = options.size;
  let socket: TerminalSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let reconnecting = false;
  let closed = false;
  let ended = false;
  // Frames sent while the socket is still opening (a freshly opened Session) are kept, not
  // dropped, and sent once it opens.
  const queued: string[] = [];

  const setReconnecting = (on: boolean) => {
    if (reconnecting === on) return;
    reconnecting = on;
    for (const listener of [...listeners]) listener.reconnecting?.(on);
  };

  const send = (message: ClientMessage) => {
    const text = encodeClientMessage(message);
    if (socket?.readyState === OPEN) socket.send(text);
    else if (socket?.readyState === CONNECTING) queued.push(text);
  };

  const connect = () => {
    clearTimeout(retry);
    const ws = openSocket(terminalPath(sessionId, size));
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      attempts = 0;
      setReconnecting(false);
      for (const text of queued.splice(0)) ws.send(text);
    };
    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      for (const listener of [...listeners]) listener.output?.(bytes);
    };
    ws.onclose = (event) => {
      if (closed || socket !== ws) return;
      // The Session was deleted or its shell exited: the state feed shows which.
      if (event.code === CLOSE_SESSION_ENDED) {
        ended = true;
        for (const listener of [...listeners]) listener.ended?.();
        return;
      }
      setReconnecting(true);
      const delay = Math.min(retryFirstMs * 2 ** attempts, retryMaxMs);
      attempts += 1;
      retry = setTimeout(connect, delay);
    };
  };

  // A phone that slept or regained its network should not wait out the backoff.
  const stopWaking = wake?.(() => {
    const waiting =
      socket && socket.readyState !== OPEN && socket.readyState !== CONNECTING;
    if (waiting && !closed && !ended && attempts > 0) connect();
  });

  connect();

  return {
    input(data, automatic) {
      send(automatic ? { type: "input", data, automatic } : { type: "input", data });
    },
    resize(cols, rows) {
      size = { cols, rows };
      send({ type: "resize", cols, rows });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      clearTimeout(retry);
      stopWaking?.();
      listeners.clear();
      socket?.close();
    },
  };
}
