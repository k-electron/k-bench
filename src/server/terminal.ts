import type { IncomingMessage } from "node:http";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Service } from "./service.ts";
import type { TerminalAttachment, TmuxDriver } from "./tmux.ts";

/** Close codes the client uses to decide whether to reconnect. */
export const CLOSE_SESSION_DELETED = 4404;
export const CLOSE_SESSION_STOPPED = 4410;
const CLOSE_INTERNAL_ERROR = 1011;

const TERMINAL_PATH = /^\/api\/sessions\/([^/]+)\/terminal$/;

/** A terminal dimension a pty can take: a whole number from 1 to 999. */
function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) < 1000;
}

function parseSize(url: URL): { cols: number; rows: number } {
  const clamp = (value: string | null, fallback: number) => {
    const n = Number(value);
    return isDimension(n) ? n : fallback;
  };
  return {
    cols: clamp(url.searchParams.get("cols"), 80),
    rows: clamp(url.searchParams.get("rows"), 24),
  };
}

/**
 * The terminal WebSocket, one per open Pane: `GET /api/sessions/:id/terminal?cols=&rows=`.
 *
 * Server to client: binary frames of terminal output.
 * Client to server: JSON text frames, `{type:"input",data}` or `{type:"resize",cols,rows}`.
 */
/** How long a stop waits for detached tmux clients to exit before giving up on them. */
const CLIENT_EXIT_TIMEOUT_MS = 3_000;

export class TerminalSockets {
  private readonly service: Service;
  private readonly tmux: TmuxDriver;
  private readonly wss = new WebSocketServer({ noServer: true });
  /** Attaches still deciding whether to start, so `closeAll` can wait them out. */
  private readonly pendingAttaches = new Set<Promise<unknown>>();
  /** Every started tmux client, with a promise that settles when its process has exited. */
  private readonly liveAttachments = new Map<TerminalAttachment, Promise<void>>();

  constructor(service: Service, tmux: TmuxDriver) {
    this.service = service;
    this.tmux = tmux;
  }

  /** Returns the Session id when `request` is a terminal upgrade, otherwise undefined. */
  static match(request: IncomingMessage): string | undefined {
    const url = new URL(request.url ?? "/", "http://localhost");
    return TERMINAL_PATH.exec(url.pathname)?.[1];
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
    sessionId: string,
  ): void {
    const size = parseSize(new URL(request.url ?? "/", "http://localhost"));
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.serve(ws, sessionId, size);
    });
  }

  private async serve(
    ws: WebSocket,
    sessionId: string,
    size: { cols: number; rows: number },
  ): Promise<void> {
    // Listeners go on before any await: a client may type the moment its socket opens,
    // and those messages must wait for the attachment instead of being dropped.
    // A failure to attach (tmux or the pty cannot start) ends this socket, not the server.
    const attached = this.attach(ws, sessionId, size).catch((error: unknown) => {
      console.error(`terminal for Session ${sessionId} failed to attach`, error);
      ws.close(CLOSE_INTERNAL_ERROR, "Could not attach");
      return undefined;
    });
    this.pendingAttaches.add(attached);
    void attached.finally(() => this.pendingAttaches.delete(attached));
    ws.on("message", (raw: RawData) => {
      let message: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      void attached.then((attachment) => {
        if (!attachment) return;
        try {
          if (message.type === "input" && typeof message.data === "string") {
            attachment.write(message.data);
          } else if (
            message.type === "resize" &&
            isDimension(message.cols) &&
            isDimension(message.rows)
          ) {
            attachment.resize(message.cols, message.rows);
          }
        } catch (error) {
          // The pty is gone or refused; its exit is reported separately.
          console.error(`terminal for Session ${sessionId} rejected a message`, error);
        }
      });
    });
    ws.on("close", () => {
      void attached.then((attachment) => attachment?.detach());
    });
  }

  private async attach(
    ws: WebSocket,
    sessionId: string,
    size: { cols: number; rows: number },
  ): Promise<TerminalAttachment | undefined> {
    const target = await this.service.terminalTarget(sessionId);
    // The client left, or the server is stopping, while the Session was being looked up:
    // starting a tmux client now would outlive the socket (and, on stop, the server).
    if (ws.readyState !== ws.OPEN) return undefined;
    if (target === "unknown") {
      ws.close(CLOSE_SESSION_DELETED, "Session deleted");
      return undefined;
    }
    if (target === "stopped") {
      ws.close(CLOSE_SESSION_STOPPED, "Session stopped");
      return undefined;
    }
    const attachment = this.tmux.attach(sessionId, size);
    this.liveAttachments.set(
      attachment,
      new Promise<void>((exited) =>
        attachment.onExit(() => {
          this.liveAttachments.delete(attachment);
          exited();
        }),
      ),
    );
    // Opening the terminal is viewing the Session. Cleared after attaching, so a bell that
    // rings from here on finds a client attached and is not recorded as unseen.
    void this.service.markSeen(sessionId).catch(() => undefined);
    attachment.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    // The shell ended, or the Session was deleted (which kills its shell): say which.
    attachment.onExit(async () => {
      if (ws.readyState !== ws.OPEN) return; // The client left; nothing to tell it.
      const now = await this.service.terminalTarget(sessionId).catch(() => "stopped");
      if (ws.readyState !== ws.OPEN) return;
      if (now === "unknown") ws.close(CLOSE_SESSION_DELETED, "Session deleted");
      else ws.close(CLOSE_SESSION_STOPPED, "Session stopped");
    });
    return attachment;
  }

  /**
   * Closes every open terminal; attached tmux clients detach and Sessions keep running.
   * Resolves once no tmux client this server started is still running or about to start.
   * A tmux client that is still connecting can start a fresh tmux server (attach-session
   * may), so anything that kills tmux after a stop must not race one.
   */
  async closeAll(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    await Promise.allSettled([...this.pendingAttaches]);
    const exits = [...this.liveAttachments].map(([attachment, exited]) => {
      attachment.detach();
      return exited;
    });
    await Promise.race([
      Promise.allSettled(exits),
      new Promise((giveUp) => setTimeout(giveUp, CLIENT_EXIT_TIMEOUT_MS)),
    ]);
  }
}
