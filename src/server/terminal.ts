import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Attachments, EndReason } from "./attachments.ts";
import type { Size } from "./tmux.ts";

/**
 * The terminal's Session was deleted, or its shell exited: reconnecting is pointless.
 * What the owner sees about why comes from the state feed, not from this code.
 */
export const CLOSE_SESSION_ENDED = 4410;
const CLOSE_INTERNAL_ERROR = 1011;

const TERMINAL_PATH = /^\/api\/sessions\/([^/]+)\/terminal$/;

/**
 * The terminal WebSocket, one per open Pane: `GET /api/sessions/:id/terminal?cols=&rows=`.
 * A thin adapter onto `Attachments`, which owns the terminal's whole life.
 *
 * Server to client: binary frames of terminal output.
 * Client to server: JSON text frames, `{type:"input",data}` or `{type:"resize",cols,rows}`.
 */
export class TerminalSockets {
  private readonly attachments: Attachments;
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(attachments: Attachments) {
    this.attachments = attachments;
  }

  /** Returns the Session id when `request` is a terminal upgrade, otherwise undefined. */
  static match(request: IncomingMessage): string | undefined {
    const url = new URL(request.url ?? "/", "http://localhost");
    return TERMINAL_PATH.exec(url.pathname)?.[1];
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    sessionId: string,
  ): void {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const size = { cols: Number(query.get("cols")), rows: Number(query.get("rows")) };
    this.wss.handleUpgrade(request, socket, head, (ws) =>
      this.serve(ws, sessionId, size),
    );
  }

  private serve(ws: WebSocket, sessionId: string, size: Size) {
    // Attached before any message can arrive: what the client types the moment its socket
    // opens is held by the attachment until its tmux client is ready.
    const attachment = this.attachments.attach(sessionId, size, {
      show: (output) => {
        if (ws.readyState === ws.OPEN) ws.send(output);
      },
      end: (reason) => endSocket(ws, reason),
    });
    ws.on("message", (raw: RawData) => {
      let message: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "input" && typeof message.data === "string") {
        attachment.input(message.data);
      } else if (message.type === "resize") {
        // The attachment ignores anything that is not a valid size.
        attachment.resize(message.cols as number, message.rows as number);
      }
    });
    ws.on("close", () => attachment.detach());
  }
}

function endSocket(ws: WebSocket, reason: EndReason): void {
  if (reason === "server-stopping") ws.terminate();
  else if (reason === "failed") ws.close(CLOSE_INTERNAL_ERROR, "Could not attach");
  else ws.close(CLOSE_SESSION_ENDED, "Session ended");
}
