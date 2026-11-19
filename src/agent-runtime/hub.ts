import { chmodSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { LineSplitter } from "../agent/lines.ts";
import type { AgentLog } from "../agent/log.ts";
import {
  type AgentClientMessage,
  type AgentCommand,
  type AgentHello,
  type AgentServerMessage,
  type AgentSnapshot,
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
  /** Its page shows the Agent in a Pane (the last `view` it sent said so). */
  visible: boolean;
}

/**
 * The runtime's socket: accepts connections, opens each with a hello (and the current
 * status), checks every message received, and sends every entry and fragment to every
 * connection that has synced, and keeps which connections have a page showing the Agent
 * (`view`). It knows nothing of Claude Code: the commands that are not
 * about the connection itself go to `onCommand`.
 */
export class ClientHub {
  private readonly clients = new Set<Client>();
  private readonly server: Server;
  private readonly socketFile: string;
  private readonly log: AgentLog;
  private readonly hello: () => AgentHello;
  private readonly snapshot: () => AgentSnapshot | undefined;
  private status: AgentStatus = { type: "status", state: "idle" };
  private commands: readonly AgentCommand[] = [];
  private readonly onCommand: (message: AgentClientMessage) => void;
  private readonly onViewed: () => void;

  constructor(options: {
    socketFile: string;
    log: AgentLog;
    hello: () => AgentHello;
    /** The text so far of the message streaming now, for a connection that joins mid-message. */
    snapshot: () => AgentSnapshot | undefined;
    /** Called with every valid message except `sync`, `page` and `view`, which the hub answers itself. */
    onCommand: (message: AgentClientMessage) => void;
    /** Called when a connection says its page now shows the Agent. */
    onViewed: () => void;
  }) {
    this.socketFile = options.socketFile;
    this.log = options.log;
    this.hello = options.hello;
    this.snapshot = options.snapshot;
    this.onCommand = options.onCommand;
    this.onViewed = options.onViewed;
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

  /**
   * Sends the `/` menu's commands to every connection that has synced, and to each one as it
   * syncs. Not to one that never syncs (the server's status connection): it has no menu.
   */
  setCommands(commands: readonly AgentCommand[]): void {
    this.commands = commands;
    this.broadcast({ type: "commands", commands: [...commands] }, true);
  }

  /** How many connections have a page showing the Agent now. */
  get viewers(): number {
    let count = 0;
    for (const client of this.clients) if (client.visible) count += 1;
    return count;
  }

  /** Hangs up on every connection and stops listening. */
  close(): Promise<void> {
    for (const client of this.clients) client.socket.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    const client: Client = { socket, synced: false, visible: false };
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
      // The replay, the snapshot of the text streaming now and the join happen in one turn
      // of the event loop, so no entry or fragment falls between them and none is sent twice.
      if (message.tailTurns !== undefined && message.afterSeq === 0) {
        this.send(client, { type: "replay", ...this.log.readTail(message.tailTurns) });
      } else {
        this.send(client, {
          type: "replay",
          from: message.afterSeq + 1,
          entries: this.log.readAfter(message.afterSeq),
        });
      }
      const live = this.snapshot();
      if (live) this.send(client, live);
      if (this.commands.length > 0) {
        this.send(client, { type: "commands", commands: [...this.commands] });
      }
      client.synced = true;
    } else if (message.type === "page") {
      // Entries before `beforeSeq` never change: no need to be synced, or to be quick about it.
      this.send(client, {
        type: "page",
        beforeSeq: message.beforeSeq,
        ...this.log.readPage(message.beforeSeq, message.limit),
      });
    } else if (message.type === "view") {
      client.visible = message.visible;
      if (message.visible) this.onViewed();
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
