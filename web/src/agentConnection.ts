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

export interface AgentConnectionOptions {
  sessionId: string;
  /** Opens the agent WebSocket at `path` (from `agentPath`). */
  openSocket: (path: string) => AgentSocket;
}

/** What a connection reports. */
export interface AgentListener {
  /** A message from the Agent Runtime, in the order it was sent. */
  message(message: AgentServerMessage): void;
  /**
   * The socket closed. `ended` is true when the Session is over (deleted or Stopped): there
   * is nothing to reconnect to. The connection does not reconnect by itself yet (ticket #134).
   */
  closed(ended: boolean): void;
}

/**
 * The browser's connection to one Claude Agent, speaking `src/shared/agent-protocol.ts`:
 * the counterpart of the server's relay and of the runtime behind it, with no React.
 * It asks for the log as soon as the socket opens (`sync` from the newest entry it has had),
 * so every message that reaches a listener after that is part of the conversation.
 */
export interface AgentConnection {
  /** Sends a command to the runtime. Kept until the socket opens if it is still opening. */
  send(message: AgentClientMessage): void;
  /** Calls the listener's handlers for what happens from now on. Returns how to stop. */
  subscribe(listener: Partial<AgentListener>): () => void;
  /** Disconnects for good. */
  close(): void;
}

export function createAgentConnection(options: AgentConnectionOptions): AgentConnection {
  const listeners = new Set<Partial<AgentListener>>();
  /** The newest log entry this connection has had. */
  let lastSeq = 0;
  let closed = false;
  // Frames sent while the socket is still opening are kept, not dropped, and sent after the sync.
  const queued: string[] = [];
  const socket = options.openSocket(agentPath(options.sessionId));

  socket.onopen = () => {
    socket.send(encodeAgentClientMessage({ type: "sync", afterSeq: lastSeq }));
    for (const text of queued.splice(0)) socket.send(text);
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const message = decodeAgentServerMessage(event.data);
    if (!message) return;
    if (message.type === "replay") {
      lastSeq = message.entries.at(-1)?.seq ?? lastSeq;
    } else if (message.type === "entry") {
      lastSeq = message.entry.seq;
    }
    for (const listener of [...listeners]) listener.message?.(message);
  };
  socket.onclose = (event) => {
    if (closed) return;
    const ended = event.code === CLOSE_AGENT_SESSION_ENDED;
    for (const listener of [...listeners]) listener.closed?.(ended);
  };

  return {
    send(message) {
      const text = encodeAgentClientMessage(message);
      if (socket.readyState === OPEN) socket.send(text);
      else if (socket.readyState === CONNECTING) queued.push(text);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
      socket.close();
    },
  };
}
