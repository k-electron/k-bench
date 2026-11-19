import {
  type AgentClientMessage,
  type AgentServerMessage,
  agentPath,
  CLOSE_AGENT_SESSION_ENDED,
  decodeAgentServerMessage,
  encodeAgentClientMessage,
} from "../../src/shared/agent-protocol.ts";

/**
 * The part of a WebSocket the agent connection uses. The browser's `WebSocket` and the `ws`
 * package's both fit.
 */
export interface AgentSocket {
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
/** How many of the latest turns a page that holds nothing asks for: the rest comes by scrolling up. */
const DEFAULT_TAIL_TURNS = 5;

export interface AgentConnectionOptions {
  sessionId: string;
  /** Opens the agent WebSocket at `path` (from `agentPath`). Called again for every retry. */
  openSocket: (path: string) => AgentSocket;
  /**
   * Subscribes `retry` to whatever says the network may be back (the page became visible,
   * the browser went online) and returns how to unsubscribe. Optional.
   */
  wake?: (retry: () => void) => () => void;
  /** The first retry's delay; each further one doubles it up to `retryMaxMs`. Defaults to 500. */
  retryFirstMs?: number;
  /** The longest retry delay. Defaults to 5000. */
  retryMaxMs?: number;
  /** How many of the latest turns to open with, when nothing is held yet. Defaults to 5. */
  tailTurns?: number;
}

/** What a connection reports. */
export interface AgentListener {
  /**
   * A message from the Agent Runtime, in the order it was sent. After every reconnect the
   * first messages are a hello, a status and the replay of what was missed.
   */
  message(message: AgentServerMessage): void;
  /**
   * True when the connection dropped and is retrying; false once it is back. Nothing sent
   * while it is true reaches the Agent.
   */
  reconnecting(on: boolean): void;
  /** The Session is over (deleted or Stopped): the connection will not retry. */
  ended(): void;
}

/**
 * The browser's connection to one Claude Agent, speaking `src/shared/agent-protocol.ts`:
 * the counterpart of the server's relay and of the runtime behind it, with no React.
 * Every socket it opens starts by asking for the log after the newest entry it has had
 * (`sync`), so across any number of drops a listener gets every entry exactly once, then
 * what is live.
 */
export interface AgentConnection {
  /**
   * Sends a command to the runtime. Kept until the socket opens if it is still opening for
   * the first time; dropped while reconnecting, so a prompt is never sent late, after the
   * owner has stopped expecting it. Returns whether it was sent or kept.
   */
  send(message: AgentClientMessage): boolean;
  /** Calls the listener's handlers for what happens from now on. Returns how to stop. */
  subscribe(listener: Partial<AgentListener>): () => void;
  /** Disconnects for good and stops reconnecting. */
  close(): void;
}

/**
 * Opens the Agent's socket and keeps it connected. When the socket drops it reconnects by
 * itself with backoff, reporting `reconnecting` meanwhile, and retries at once when `wake`
 * fires unless a socket is already opening. A close with `CLOSE_AGENT_SESSION_ENDED`
 * reports `ended` and is never retried. The Agent itself never notices: closing a tab, a
 * device sleeping and the server restarting only end this connection.
 */
export function createAgentConnection(options: AgentConnectionOptions): AgentConnection {
  const {
    sessionId,
    openSocket,
    wake,
    retryFirstMs = DEFAULT_RETRY_FIRST_MS,
    retryMaxMs = DEFAULT_RETRY_MAX_MS,
    tailTurns = DEFAULT_TAIL_TURNS,
  } = options;
  const listeners = new Set<Partial<AgentListener>>();
  /**
   * The newest log entry this connection has had: every socket syncs from it. A `page` answer
   * is older than this, so it never moves it.
   */
  let lastSeq = 0;
  let socket: AgentSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let reconnecting = false;
  let closed = false;
  let ended = false;
  // Frames sent while the first socket is still opening are kept, not dropped, and sent after
  // the sync.
  const queued: string[] = [];

  const setReconnecting = (on: boolean) => {
    if (reconnecting === on) return;
    reconnecting = on;
    for (const listener of [...listeners]) listener.reconnecting?.(on);
  };

  const connect = () => {
    clearTimeout(retry);
    const ws = openSocket(agentPath(sessionId));
    socket = ws;
    ws.onopen = () => {
      attempts = 0;
      // The sync goes first: whatever is sent after it is in order after the replay. A
      // connection that holds nothing opens with the latest turns (older ones come by `page`);
      // one that holds entries asks for everything after them, so it never has a gap.
      ws.send(
        encodeAgentClientMessage(
          lastSeq === 0
            ? { type: "sync", afterSeq: 0, tailTurns }
            : { type: "sync", afterSeq: lastSeq },
        ),
      );
      for (const text of queued.splice(0)) ws.send(text);
      setReconnecting(false);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string" || socket !== ws) return;
      const message = decodeAgentServerMessage(event.data);
      if (!message) return;
      if (message.type === "replay") {
        lastSeq = message.entries.at(-1)?.seq ?? lastSeq;
      } else if (message.type === "entry") {
        lastSeq = message.entry.seq;
      }
      for (const listener of [...listeners]) listener.message?.(message);
    };
    ws.onclose = (event) => {
      if (closed || socket !== ws) return;
      // The Session was deleted or Stopped: the state feed shows which.
      if (event.code === CLOSE_AGENT_SESSION_ENDED) {
        ended = true;
        for (const listener of [...listeners]) listener.ended?.();
        return;
      }
      queued.length = 0;
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
    send(message) {
      if (reconnecting || ended) return false;
      const text = encodeAgentClientMessage(message);
      if (socket?.readyState === OPEN) socket.send(text);
      else if (socket?.readyState === CONNECTING) queued.push(text);
      else return false;
      return true;
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
