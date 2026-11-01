import type { IncomingMessage } from "node:http";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Service } from "./service.ts";
import type { TerminalAttachment, TmuxDriver } from "./tmux.ts";

/** Close codes the client uses to decide whether to reconnect. */
export const CLOSE_SESSION_DELETED = 4404;
export const CLOSE_SESSION_STOPPED = 4410;

const TERMINAL_PATH = /^\/api\/sessions\/([^/]+)\/terminal$/;

function parseSize(url: URL): { cols: number; rows: number } {
  const clamp = (value: string | null, fallback: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 1000 ? n : fallback;
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
export class TerminalSockets {
  private readonly service: Service;
  private readonly tmux: TmuxDriver;
  private readonly wss = new WebSocketServer({ noServer: true });

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
    const attached = this.attach(ws, sessionId, size);
    ws.on("message", (raw: RawData) => {
      let message: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      void attached.then((attachment) => {
        if (!attachment) return;
        if (message.type === "input" && typeof message.data === "string") {
          attachment.write(message.data);
        } else if (
          message.type === "resize" &&
          Number.isInteger(message.cols) &&
          Number.isInteger(message.rows)
        ) {
          attachment.resize(message.cols as number, message.rows as number);
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
    if (target === "unknown") {
      ws.close(CLOSE_SESSION_DELETED, "Session deleted");
      return undefined;
    }
    if (target === "stopped") {
      ws.close(CLOSE_SESSION_STOPPED, "Session stopped");
      return undefined;
    }
    const attachment = this.tmux.attach(sessionId, size);
    attachment.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    attachment.onExit(() => {
      if (ws.readyState === ws.OPEN) ws.close(CLOSE_SESSION_STOPPED, "Session stopped");
    });
    return attachment;
  }

  /** Closes every open terminal; attached tmux clients detach and Sessions keep running. */
  closeAll(): void {
    for (const client of this.wss.clients) client.terminate();
  }
}
