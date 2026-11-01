import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { StateFeed } from "./state-feed.ts";

const EVENTS_PATH = "/api/events";

/**
 * The events WebSocket, one per browser tab: `GET /api/events`. The server sends the current
 * state as a JSON text frame on connect, then a fresh full snapshot whenever state changes.
 * Snapshots rather than diffs, so a client can never drift. Clients send nothing.
 */
export class EventSockets {
  private readonly feed: StateFeed;
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(feed: StateFeed) {
    this.feed = feed;
  }

  static match(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://localhost").pathname === EVENTS_PATH;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      const unsubscribe = this.feed.subscribe((snapshot) => {
        if (ws.readyState === ws.OPEN) ws.send(snapshot);
      });
      ws.on("close", unsubscribe);
      ws.on("error", () => ws.terminate());
    });
  }

  closeAll(): void {
    for (const client of this.wss.clients) client.terminate();
  }
}
