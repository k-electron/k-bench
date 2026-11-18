import { chmodSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { LineSplitter } from "../agent/lines.ts";
import type { AgentLog } from "../agent/log.ts";
import {
  type AgentClientMessage,
  type AgentHello,
  type AgentServerMessage,
  type AgentStatus,
  decodeAgentClientMessage,
  encodeAgentServerMessage,
  type LogEntry,
} from "../shared/agent-protocol.ts";

/** One connection to the runtime's socket. */
interface Client {
  socket: Socket;
  /** Has asked for a replay and is now sent every entry and fragment as it happens. */
  synced: boolean;
}

/**
 * The runtime's socket: accepts connections, opens each with a hello (and the current
 * status), checks every message received, and sends every entry and fragment to every
 * connection that has synced. It knows nothing of Claude Code: the commands that are not
 * about the connection itself go to `onCommand`.
 */
export class ClientHub {
  private readonly clients = new Set<Client>();
  private readonly server: Server;
  private readonly socketFile: string;
  private readonly log: AgentLog;
  private readonly hello: () => AgentHello;
  private status: AgentStatus = { type: "status", state: "idle" };
  private readonly onCommand: (message: AgentClientMessage) => void;

  constructor(options: {
    socketFile: string;
    log: AgentLog;
    hello: () => AgentHello;
    /** Called with every valid message except `sync`, which the hub answers itself. */
    onCommand: (message: AgentClientMessage) => void;
  }) {
    this.socketFile = options.socketFile;
    this.log = options.log;
    this.hello = options.hello;
    this.onCommand = options.onCommand;
    this.server = createServer((socket) => this.accept(socket));
  }

  /** Starts listening, owner-only. A socket file left by a runtime that died is replaced. */
  listen(): Promise<void> {
    rmSync(this.socketFile, { force: true });
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketFile, () => {
        chmodSync(this.socketFile, 0o600);
        resolve();
      });
    });
  }

  /** Sends the entry to every connection that has synced. */
  entry(entry: LogEntry): void {
    this.broadcast({ type: "entry", entry }, true);
  }

  /** Sends a live `stream_event` to every connection that has synced. */
  partial(message: Record<string, unknown>): void {
    this.broadcast({ type: "partial", message }, true);
  }

  /** Sends the new status to every connection, and to those that connect from now on. */
  setStatus(status: AgentStatus): void {
    this.status = status;
    this.broadcast(status, false);
  }

  /** Hangs up on every connection and stops listening. */
  close(): Promise<void> {
    for (const client of this.clients) client.socket.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    const client: Client = { socket, synced: false };
    this.clients.add(client);
    socket.setEncoding("utf8");
    const lines = new LineSplitter();
    socket.on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) this.receive(client, line);
      if (lines.overflowed) socket.destroy();
    });
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => socket.destroy());
    this.send(client, this.hello());
    this.send(client, this.status);
  }

  private receive(client: Client, line: string): void {
    const message = decodeAgentClientMessage(line);
    if (!message) {
      this.send(client, {
        type: "error",
        code: "bad_message",
        message: "Not a message this runtime understands",
      });
    } else if (message.type === "sync") {
      if (client.synced) {
        this.send(client, {
          type: "error",
          code: "already_synced",
          message: "A connection syncs once",
        });
        return;
      }
      // The replay and the join happen in one turn of the event loop, so no entry falls
      // between them and none is sent twice.
      this.send(client, {
        type: "replay",
        entries: this.log.readAfter(message.afterSeq),
      });
      client.synced = true;
    } else {
      this.onCommand(message);
    }
  }

  private send(client: Client, message: AgentServerMessage): void {
    if (client.socket.writable)
      client.socket.write(`${encodeAgentServerMessage(message)}\n`);
  }

  private broadcast(message: AgentServerMessage, syncedOnly: boolean): void {
    // Encoded once: every connection gets the same bytes.
    const line = `${encodeAgentServerMessage(message)}\n`;
    for (const client of this.clients) {
      if ((client.synced || !syncedOnly) && client.socket.writable) {
        client.socket.write(line);
      }
    }
  }
}
