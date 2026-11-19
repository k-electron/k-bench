import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { LineSplitter } from "../agent/lines.ts";
import { answerPage, answerSync } from "../agent/replay.ts";
import {
  type AgentServerMessage,
  CLOSE_AGENT_SESSION_ENDED,
  decodeAgentClientMessage,
  encodeAgentServerMessage,
  parseAgentPath,
} from "../shared/agent-protocol.ts";
import { CLOSE_INTERNAL_ERROR } from "../shared/terminal-protocol.ts";
import type { AgentRuntimes } from "./agents.ts";

/** The longest message a browser may send (a prompt is capped well below this). */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** How long, after the runtime's connection dropped, its Session may take to show as ended. */
const ENDED_WAIT_MS = 2_000;

/** What the relay asks of the rest of the server. */
export interface AgentSessions {
  /** A known Session that is a Claude Agent and is running. */
  hasRunningAgent(sessionId: string): Promise<boolean>;
  /** A known Session that is a Claude Agent, running or Stopped. */
  isAgent(sessionId: string): boolean;
}

/**
 * The agent WebSocket, one per open Claude Agent Pane (`GET /api/sessions/:id/agent`),
 * speaking `src/shared/agent-protocol.ts`. It opens one connection to the Agent Runtime's
 * unix socket for each browser socket and forwards whole JSON messages both ways without
 * reading them (ADR-0008): the runtime does the checking, and the browser the rendering.
 * It closes the socket with 4410 only when the Session has ended; when this server stops it
 * drops the socket without that code, so the browser reconnects.
 */
export class AgentSockets {
  private readonly agents: AgentRuntimes;
  private readonly sessions: AgentSessions;
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });
  private readonly upstreams = new Set<Socket>();
  private stopping = false;

  constructor(agents: AgentRuntimes, sessions: AgentSessions) {
    this.agents = agents;
    this.sessions = sessions;
  }

  /** The Session an agent upgrade asks for, or undefined when `request` is not one. */
  static match(request: IncomingMessage): string | undefined {
    return parseAgentPath(request.url ?? "/");
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    sessionId: string,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => void this.serve(ws, sessionId));
  }

  private async serve(ws: WebSocket, sessionId: string): Promise<void> {
    // Whatever the browser sends before the runtime is reached is kept, in order.
    const early: string[] = [];
    let upstream: Socket | undefined;
    // Set when the Agent turns out to be Stopped: answers a message from the log on disk.
    let stopped: ((text: string) => void) | undefined;
    ws.on("message", (raw: RawData, isBinary: boolean) => {
      if (isBinary) return;
      const text = raw.toString();
      if (upstream) upstream.write(`${text}\n`);
      else if (stopped) stopped(text);
      else early.push(text);
    });
    const serveStoppedOrEnd = () => {
      if (!this.sessions.isAgent(sessionId)) {
        return ws.close(CLOSE_AGENT_SESSION_ENDED, "Session ended");
      }
      const answer = this.stoppedAnswers(ws, sessionId);
      stopped = answer;
      for (const text of early.splice(0)) answer(text);
    };
    ws.on("error", () => ws.terminate());
    // `ws` closing for any reason hangs up on the runtime, which then forgets this client.
    ws.on("close", () => upstream?.destroy());

    try {
      // Not running: a Stopped Agent is served from its log, anything else has ended.
      if (!(await this.sessions.hasRunningAgent(sessionId))) {
        return serveStoppedOrEnd();
      }
      // A runtime that was just started is not listening yet: this waits for it.
      upstream = await this.agents.connect(sessionId, () =>
        this.sessions.hasRunningAgent(sessionId),
      );
    } catch {
      return ws.close(CLOSE_INTERNAL_ERROR, "The Agent did not answer");
    }
    // It stopped while this waited for it.
    if (!upstream) return serveStoppedOrEnd();
    if (ws.readyState !== ws.OPEN) {
      upstream.destroy();
      return;
    }
    const runtime = upstream;
    this.upstreams.add(runtime);
    runtime.setEncoding("utf8");
    runtime.on("error", () => runtime.destroy());

    const lines = new LineSplitter();
    runtime.on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) {
        if (ws.readyState === ws.OPEN) ws.send(line);
      }
      if (lines.overflowed) runtime.destroy();
    });
    runtime.on("close", () => {
      this.upstreams.delete(runtime);
      if (!this.stopping) void this.runtimeGone(ws, sessionId);
    });
    for (const text of early.splice(0)) runtime.write(`${text}\n`);
  }

  /**
   * Serves a Stopped Agent read-only from its log on disk, with the same replay code the
   * runtime uses (`answerSync`, `answerPage`): returns what answers each message the browser
   * sends. A `sync` is answered with its `replay` and then `stopped` with the reason; a
   * `page` with its `page`; every other message (a prompt, an answer, `view`) is ignored, as
   * nothing is there to hear it. Reads the files afresh for each, so nothing is held open.
   */
  private stoppedAnswers(ws: WebSocket, sessionId: string): (text: string) => void {
    const send = (message: AgentServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(encodeAgentServerMessage(message));
    };
    return (text) => {
      const message = decodeAgentClientMessage(text);
      try {
        if (message?.type === "sync") {
          send(answerSync(this.agents.readLog(sessionId), message));
          send({ type: "stopped", reason: this.agents.stoppedReason(sessionId) });
        } else if (message?.type === "page") {
          send(answerPage(this.agents.readLog(sessionId), message));
        }
      } catch {
        // The Agent's folder went with its Session: this socket is about to be dropped.
        ws.close(CLOSE_AGENT_SESSION_ENDED, "Session ended");
      }
    };
  }

  /**
   * The runtime hung up. If its Session ended with it (it was told to shut down, or died, and
   * tmux ended the Session) the browser is told so, for good; tmux ends the Session a moment
   * after the runtime exits, so that is waited for. Otherwise the browser may try again.
   */
  private async runtimeGone(ws: WebSocket, sessionId: string): Promise<void> {
    const deadline = Date.now() + ENDED_WAIT_MS;
    let running = true;
    try {
      running = await this.sessions.hasRunningAgent(sessionId);
      while (running && Date.now() < deadline && !this.stopping) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        running = await this.sessions.hasRunningAgent(sessionId);
      }
    } catch {
      // The server is stopping and its database is closed: the browser reconnects to the next one.
      return;
    }
    if (ws.readyState !== ws.OPEN || this.stopping) return;
    if (running) ws.close(CLOSE_INTERNAL_ERROR, "The Agent hung up");
    else ws.close(CLOSE_AGENT_SESSION_ENDED, "Session ended");
  }

  /** Drops every agent socket, and the runtime connections behind them. Server stop calls it. */
  closeAll(): void {
    this.stopping = true;
    for (const upstream of this.upstreams) upstream.destroy();
    for (const client of this.wss.clients) client.terminate();
  }
}
