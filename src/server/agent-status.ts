import type { Socket } from "node:net";
import { LineSplitter } from "../agent/lines.ts";
import {
  type AgentHello,
  type AgentStatus,
  decodeAgentServerMessage,
} from "../shared/agent-protocol.ts";
import type { AgentState } from "../shared/state-protocol.ts";
import type { AgentRuntimes } from "./agents.ts";

/** How long to wait before connecting again to a runtime whose connection dropped. */
const RECONNECT_MS = 500;

/** What one running Agent's runtime has said on its status connection. */
interface Heard {
  hello?: AgentHello;
  status?: AgentStatus;
}

/**
 * The server's status connections to the Claude Agents running now: one per runtime, which
 * never syncs, so it receives only `hello` and every `status` (see `docs/internals/agent.md`).
 * What the runtime last said is what `SessionState.agent` reports. It is a cache of the
 * runtime's answer, never a record: when the connection drops, or the Agent stops running,
 * what was heard is forgotten (ADR-0002, ADR-0008).
 *
 * `follow` is told which Agents run, by the state read that already asks tmux (so a new
 * Agent, one restarted, and every Agent after a k-bench restart are all picked up the same
 * way), and connects to each one new and hangs up on each that has gone.
 */
export class AgentStatuses {
  private readonly agents: AgentRuntimes;
  private readonly heard = new Map<string, Heard>();
  private readonly watching = new Map<string, { socket?: Socket }>();
  private changed: () => void = () => undefined;
  private stopped = false;

  constructor(agents: AgentRuntimes) {
    this.agents = agents;
  }

  /** Called whenever what is heard of any Agent changes (the state feed re-reads). */
  onChange(listener: () => void): void {
    this.changed = listener;
  }

  /** Watches the Agents in `running` that are not watched yet, and stops watching the rest. */
  follow(running: ReadonlySet<string>): void {
    if (this.stopped) return;
    for (const id of [...this.watching.keys()]) {
      if (running.has(id)) continue;
      this.watching.get(id)?.socket?.destroy();
      this.watching.delete(id);
      this.forget(id);
    }
    for (const id of running) {
      if (!this.watching.has(id)) void this.watch(id);
    }
  }

  /** What the Agent's runtime last said, as `SessionState.agent`; undefined if it has said nothing. */
  stateOf(sessionId: string): AgentState | undefined {
    const { hello, status } = this.heard.get(sessionId) ?? {};
    if (!status) return undefined;
    return {
      state: status.state,
      ...(status.turnStartedAt === undefined
        ? {}
        : { turnStartedAt: status.turnStartedAt }),
      ...(hello ? { claudeVersion: hello.claudeVersion } : {}),
      ...(hello ? { runtimeBuildId: hello.runtimeBuildId } : {}),
    };
  }

  /**
   * Whether the Agent's Bell is raised, as `SessionState.bell`. The runtime holds it (it alone
   * knows which pages show the Agent), so an Agent it has not said anything yet has none.
   */
  bellOf(sessionId: string): boolean {
    return this.heard.get(sessionId)?.status?.bell === true;
  }

  /** Resolves once every Agent watched has said its status, or after `timeoutMs`. */
  async settled(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.stopped) {
      const waiting = [...this.watching.keys()].some((id) => !this.heard.get(id)?.status);
      if (!waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Hangs up on every runtime. The runtimes do not notice: a connection coming and going is normal. */
  stop(): void {
    this.stopped = true;
    for (const { socket } of this.watching.values()) socket?.destroy();
    this.watching.clear();
    this.heard.clear();
  }

  /** Keeps one connection to the Agent's runtime for as long as it is followed. */
  private async watch(id: string): Promise<void> {
    const entry: { socket?: Socket } = {};
    this.watching.set(id, entry);
    const wanted = () => this.watching.get(id) === entry && !this.stopped;
    while (wanted()) {
      let socket: Socket | undefined;
      try {
        socket = await this.agents.connect(id, async () => wanted());
      } catch {
        // Nothing listens (yet): try again while the Agent is still followed.
      }
      if (socket && wanted()) {
        entry.socket = socket;
        await this.read(id, socket);
        entry.socket = undefined;
        this.forget(id);
      } else {
        socket?.destroy();
      }
      if (wanted()) await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
    }
  }

  /** Reads the connection until it closes. */
  private read(id: string, socket: Socket): Promise<void> {
    return new Promise((resolve) => {
      const lines = new LineSplitter();
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const line of lines.push(chunk)) {
          const message = decodeAgentServerMessage(line);
          if (message?.type === "hello") this.hear(id, { hello: message });
          else if (message?.type === "status") this.hear(id, { status: message });
        }
        if (lines.overflowed) socket.destroy();
      });
      socket.on("error", () => socket.destroy());
      socket.on("close", () => resolve());
    });
  }

  private hear(id: string, update: Heard): void {
    if (!this.watching.has(id)) return;
    const current = this.heard.get(id) ?? {};
    this.heard.set(id, { ...current, ...update });
    this.changed();
  }

  private forget(id: string): void {
    if (this.heard.delete(id)) this.changed();
  }
}
