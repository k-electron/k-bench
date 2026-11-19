import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  type AgentClientMessage,
  type AgentHello,
  type AgentPage,
  type AgentServerMessage,
  type AgentSnapshot,
  type AgentStatus,
  type AgentStopped,
  agentPath,
  decodeAgentServerMessage,
  encodeAgentClientMessage,
  type LogEntry,
  openPermissionAsks,
  type PermissionAskEntry,
  type PermissionMode,
} from "../../src/shared/agent-protocol.ts";
import { pollUntil } from "./poll.ts";

/**
 * A client of a Claude Agent's WebSocket, as a browser's would be: it collects every message
 * the runtime sends, through the server's relay, and sends commands. Start with
 * `server.openAgent(sessionId)` (see test/harness/instance.ts), which waits for the hello;
 * nothing but hello and status arrives until `sync()`.
 */
export class AgentClient {
  private readonly socket: WebSocket;
  /** Every message received, in order. */
  readonly messages: AgentServerMessage[] = [];
  /** The code the socket closed with, once it has. */
  closeCode: number | undefined;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data: Buffer) => {
      const message = decodeAgentServerMessage(data.toString());
      if (message) this.messages.push(message);
    });
    socket.on("close", (code) => {
      this.closeCode = code;
    });
  }

  /** Opens `agentPath(sessionId)` on the server. Resolves when the socket is open. */
  static open(
    baseUrl: string,
    sessionId: string,
    headers: Record<string, string> = {},
  ): Promise<AgentClient> {
    const url = new URL(agentPath(sessionId), baseUrl);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers });
    const client = new AgentClient(socket);
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(client));
      socket.once("error", reject);
      // A refused upgrade or an immediate close is the test's to look at (`closeCode`).
      socket.once("close", () => resolve(client));
    });
  }

  /** The runtime's hello, once it has come. */
  get hello(): AgentHello | undefined {
    return this.messages.find((m): m is AgentHello => m.type === "hello");
  }

  /**
   * Why the Agent is Stopped, once the server has said so: it serves a Stopped Agent's log
   * from disk and ends a `sync` with this, so there is no hello and no status.
   */
  get stoppedReason(): string | undefined {
    return this.messages.find((m): m is AgentStopped => m.type === "stopped")?.reason;
  }

  /** The newest status received: what the Agent is doing, and what it has reported. */
  get status(): AgentStatus | undefined {
    return this.messages.findLast((m): m is AgentStatus => m.type === "status");
  }

  /** Every log entry received, whether in a replay or live, in the order received. */
  get entries(): LogEntry[] {
    return this.messages.flatMap((m) =>
      m.type === "replay" ? m.entries : m.type === "entry" ? [m.entry] : [],
    );
  }

  /** The text of every streamed fragment received, in order. */
  get fragments(): string[] {
    return this.messages.flatMap((m) => {
      if (m.type !== "partial") return [];
      const event = m.message.event as { type?: string; delta?: { text?: string } };
      return event?.type === "content_block_delta" && event.delta?.text !== undefined
        ? [event.delta.text]
        : [];
    });
  }

  /** Every snapshot of the text streaming at the moment of a `sync`, in order. */
  get snapshots(): AgentSnapshot[] {
    return this.messages.filter((m): m is AgentSnapshot => m.type === "snapshot");
  }

  /** The permission mode the newest `status` named: what a Pane's mode line shows. */
  get mode(): PermissionMode | undefined {
    for (const message of this.messages.toReversed()) {
      if (message.type === "status" && message.mode !== undefined) return message.mode;
    }
    return undefined;
  }

  /** The `seq` of the newest entry received: what a reconnecting client syncs from. */
  get lastSeq(): number {
    return this.entries.at(-1)?.seq ?? 0;
  }

  /** The text of every complete assistant message among the entries, in order. */
  get assistantTexts(): string[] {
    return this.entries.flatMap((entry) => {
      if (entry.kind !== "sdk" || entry.message.type !== "assistant") return [];
      const content = (entry.message.message as { content: Array<{ text?: string }> })
        .content;
      return content.flatMap((block) => (block.text === undefined ? [] : [block.text]));
    });
  }

  send(message: AgentClientMessage): void {
    this.socket.send(encodeAgentClientMessage(message));
  }

  /** Sends text as it is, valid or not, to see what the runtime makes of it. */
  sendRaw(text: string): void {
    this.socket.send(text);
  }

  /**
   * Asks for the entries after `afterSeq`, and every entry and fragment from now on, and
   * resolves once the replay has come: from then on this connection is in the live set.
   * (Fragments are never replayed: send a prompt from another connection before that and
   * this one gets the text so far as a snapshot, not the fragments one by one.) With
   * `tailTurns` (and `afterSeq` 0) only the latest turns are replayed, as a fresh page asks;
   * `replayFrom` says where they begin, and `page` fetches what is before.
   */
  async sync(afterSeq = 0, options: { tailTurns?: number } = {}): Promise<void> {
    const before = this.messages.filter((m) => m.type === "replay").length;
    this.send({
      type: "sync",
      afterSeq,
      ...(options.tailTurns === undefined ? {} : { tailTurns: options.tailTurns }),
    });
    await pollUntil(
      () => this.messages.filter((m) => m.type === "replay").length > before,
      { description: "the replay" },
    );
  }

  /** Where the first replay's contiguous range begins (1: the whole log), once it has come. */
  get replayFrom(): number | undefined {
    const replay = this.messages.find((m) => m.type === "replay");
    return replay?.type === "replay" ? replay.from : undefined;
  }

  /**
   * Asks for the `limit` turns before `beforeSeq` and resolves with the answer. Pages are not
   * among `entries`, which are what a replay and the live feed gave.
   */
  async page(beforeSeq: number, limit: number): Promise<AgentPage> {
    this.send({ type: "page", beforeSeq, limit });
    return pollUntil(
      () =>
        this.messages.find(
          (m): m is AgentPage => m.type === "page" && m.beforeSeq === beforeSeq,
        ),
      { description: `the page before ${beforeSeq}` },
    );
  }

  /** The asks open as far as this client knows: asked, and not yet answered. */
  get openAsks(): PermissionAskEntry[] {
    return openPermissionAsks(this.entries);
  }

  /** Resolves with the oldest open ask, once there is one. */
  waitForAsk(): Promise<PermissionAskEntry> {
    return pollUntil(() => this.openAsks[0], { description: "a permission ask" });
  }

  /** Asks for a permission mode, as the mode line's tap or Shift+Tab does. */
  setPermissionMode(mode: PermissionMode): void {
    this.send({ type: "set_permission_mode", mode });
  }

  /** Answers an ask as a Pane's Allow or Deny button does. */
  answer(requestId: string, decision: "allow" | "deny"): void {
    this.send({ type: "answer", requestId, decision });
  }

  /** Interrupts the turn that is running, as a Pane's Interrupt button or Esc does. */
  interrupt(): void {
    this.send({ type: "interrupt" });
  }

  /** Says whether this client's page shows the Agent in a Pane, as a browser's does. */
  view(visible: boolean): void {
    this.send({ type: "view", visible });
  }

  /** Sends a prompt, with the names of images already uploaded, and returns the ID it was sent with. */
  prompt(text: string, id: string = randomUUID(), images?: string[]): string {
    this.send({ type: "prompt", id, text, ...(images && { images }) });
    return id;
  }

  /** Resolves once a message the check accepts has been received. */
  waitForMessage<T extends AgentServerMessage>(
    check: (message: AgentServerMessage) => message is T,
    description: string,
  ): Promise<T> {
    return pollUntil(() => this.messages.find(check), { description });
  }

  /** Resolves with the first entry the check accepts, once received. */
  waitForEntry(
    check: (entry: LogEntry) => boolean,
    description: string,
  ): Promise<LogEntry> {
    return pollUntil(() => this.entries.find(check), { description });
  }

  /** Resolves with the code the socket closed with. */
  waitForClose(): Promise<number> {
    return pollUntil(() => this.closeCode, { description: "the agent socket to close" });
  }

  close(): void {
    this.socket.close();
  }
}

/** Whether an entry is the `result` that ends a turn. */
export const isResult = (entry: LogEntry): boolean =>
  entry.kind === "sdk" && entry.message.type === "result";
