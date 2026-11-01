import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import {
  CLOSE_INTERNAL_ERROR,
  CLOSE_SESSION_ENDED,
  decodeClientMessage,
  parseTerminalPath,
  type TerminalRequest,
  type TerminalSize,
} from "../shared/terminal-protocol.ts";
import type { Attachments, EndReason } from "./attachments.ts";

/**
 * The terminal WebSocket, one per open Pane, speaking the protocol in
 * `src/shared/terminal-protocol.ts`. A thin adapter onto `Attachments`, which owns the
 * terminal's whole life.
 */
export class TerminalSockets {
  private readonly attachments: Attachments;
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(attachments: Attachments) {
    this.attachments = attachments;
  }

  /**
   * The Session and size a terminal upgrade asks for, or undefined when `request` is not a
   * terminal upgrade.
   */
  static match(request: IncomingMessage): TerminalRequest | undefined {
    return parseTerminalPath(request.url ?? "/");
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    { sessionId, size }: TerminalRequest,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) =>
      this.serve(ws, sessionId, size),
    );
  }

  private serve(ws: WebSocket, sessionId: string, size: TerminalSize) {
    // Attached before any message can arrive: what the client types the moment its socket
    // opens is held by the attachment until its tmux client is ready.
    const attachment = this.attachments.attach(sessionId, size, {
      show: (output) => {
        if (ws.readyState === ws.OPEN) ws.send(output);
      },
      end: (reason) => endSocket(ws, reason),
    });
    ws.on("message", (raw: RawData) => {
      const message = decodeClientMessage(raw.toString());
      if (message?.type === "input") {
        attachment.input(message.data, { automatic: message.automatic });
      } else if (message?.type === "resize") {
        // The attachment ignores anything that is not a valid size.
        attachment.resize(message.cols, message.rows);
      }
    });
    ws.on("close", () => attachment.detach());
    ws.on("error", () => ws.terminate());
  }

  /**
   * Drops every terminal socket still open, including one that has ended and is waiting for
   * its client to answer the close. Server stop calls it after `Attachments.stop`, so no
   * socket outlives the server.
   */
  closeAll(): void {
    for (const client of this.wss.clients) client.terminate();
  }
}

function endSocket(ws: WebSocket, reason: EndReason): void {
  if (reason === "server-stopping") ws.terminate();
  else if (reason === "failed") ws.close(CLOSE_INTERNAL_ERROR, "Could not attach");
  else ws.close(CLOSE_SESSION_ENDED, "Session ended");
}
