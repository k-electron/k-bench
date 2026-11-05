import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { InstanceConfig } from "../../src/server/config.ts";
import {
  type RunningServer,
  type ServerOptions,
  startServer,
} from "../../src/server/server.ts";
import {
  EVENTS_PATH,
  type Snapshot,
  type State,
} from "../../src/shared/state-protocol.ts";
import { createStateClient, type StateClient } from "../../web/src/stateClient.ts";
import { createTerminalConnection } from "../../web/src/terminalConnection.ts";
import { EventsClient } from "./events.ts";
import { testSocketName, tmuxSocketDir } from "./socket-leaks.ts";
import { TerminalClient, upgradeStatus } from "./terminal.ts";
import { TerminalConnectionProbe } from "./terminal-connection.ts";

export type { Snapshot, State };

export interface WorkspaceInfo {
  id: string;
  name: string;
  folder: string;
}
export interface SessionInfo {
  id: string;
  name: string;
}
/** The header `tailscale serve` adds to every request it proxies. */
export const LOGIN_HEADER = "Tailscale-User-Login";

/**
 * A booted server, driven only through HTTP and WebSockets. Like `tailscale serve`, it sends
 * a login header on every request and WebSocket upgrade: the instance's configured login by
 * default. Use `as(login)` or `anonymous()` for a view that sends another login or none.
 */
export class TestServer {
  readonly baseUrl: string;
  /** The login sent with every request, or undefined to send none. */
  readonly login: string | undefined;
  private readonly running: RunningServer;
  private readonly extraHeaders: Record<string, string>;

  constructor(
    running: RunningServer,
    login: string | undefined,
    extraHeaders: Record<string, string> = {},
  ) {
    this.running = running;
    this.login = login;
    this.extraHeaders = extraHeaders;
    this.baseUrl = `http://127.0.0.1:${running.port}`;
  }

  /** The same server, with every request sent as `login`. */
  as(login: string): TestServer {
    return new TestServer(this.running, login, this.extraHeaders);
  }

  /** The same server, with no login header at all. */
  anonymous(): TestServer {
    return new TestServer(this.running, undefined, this.extraHeaders);
  }

  /**
   * The same server, with `headers` added to every request and WebSocket upgrade: a browser
   * page's `Origin`, or the `Host` a proxy such as `tailscale serve` forwards.
   */
  withHeaders(headers: Record<string, string>): TestServer {
    return new TestServer(this.running, this.login, { ...this.extraHeaders, ...headers });
  }

  /** Headers every request carries. An explicit header in a request's own init wins. */
  private get loginHeaders(): Record<string, string> {
    return {
      ...(this.login === undefined ? {} : { [LOGIN_HEADER]: this.login }),
      ...this.extraHeaders,
    };
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(this.loginHeaders);
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
    return fetch(new URL(path, this.baseUrl), { ...init, headers });
  }

  async post(path: string, body?: unknown): Promise<Response> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }

  private sendJson(method: string, path: string, body: unknown): Promise<Response> {
    return this.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  patch(path: string, body: unknown): Promise<Response> {
    return this.sendJson("PATCH", path, body);
  }

  put(path: string, body: unknown): Promise<Response> {
    return this.sendJson("PUT", path, body);
  }

  delete(path: string): Promise<Response> {
    return this.request(path, { method: "DELETE" });
  }

  async createWorkspace(input: {
    folder: string;
    name?: string;
  }): Promise<WorkspaceInfo> {
    const response = await this.post("/api/workspaces", input);
    if (response.status !== 201) {
      throw new Error(
        `create workspace failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as WorkspaceInfo;
  }

  async createSession(workspaceId: string, name?: string): Promise<SessionInfo> {
    const response = await this.post(`/api/workspaces/${workspaceId}/sessions`, { name });
    if (response.status !== 201) {
      throw new Error(
        `create session failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as SessionInfo;
  }

  /** Renames a Session. Returns the raw response so tests can check the status. */
  renameSession(sessionId: string, name: string): Promise<Response> {
    return this.request(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  /** Deletes a Session. Returns the raw response so tests can check the status. */
  deleteSession(sessionId: string): Promise<Response> {
    return this.request(`/api/sessions/${sessionId}`, { method: "DELETE" });
  }

  async state(): Promise<State> {
    const response = await this.request("/api/state");
    return (await response.json()) as State;
  }

  openTerminal(
    sessionId: string,
    size?: { cols: number; rows: number },
  ): Promise<TerminalClient> {
    return TerminalClient.open(this.baseUrl, sessionId, size, this.loginHeaders);
  }

  /** Opens the events WebSocket, which pushes a full state snapshot whenever state changes. */
  openEvents(): Promise<EventsClient<Snapshot>> {
    return EventsClient.open<Snapshot>(this.baseUrl, this.loginHeaders);
  }

  /** An events WebSocket carrying the login header, which Node's built-in one cannot send. */
  openEventsSocket(): WebSocket {
    const url = new URL(EVENTS_PATH, this.baseUrl);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers: this.loginHeaders });
    // A refused or dropped connection is the client's to handle: it reconnects.
    socket.on("error", () => {});
    return socket;
  }

  /** A terminal WebSocket (`path` from `terminalPath`) carrying the login header. */
  openTerminalSocket(path: string): WebSocket {
    const url = new URL(path, this.baseUrl);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers: this.loginHeaders });
    // A refused or dropped connection is the connection's to handle: it reconnects.
    socket.on("error", () => {});
    return socket;
  }

  /**
   * Attempts a WebSocket upgrade on `path` and returns the HTTP status that refused it, or
   * 101 if it was accepted (the socket is closed again).
   */
  upgradeStatus(path: string): Promise<number> {
    return upgradeStatus(this.baseUrl, path, this.loginHeaders);
  }

  /** Stops the server process-equivalent. tmux, and so every Session, keeps running. */
  stop(): Promise<void> {
    return this.running.stop();
  }
}

/**
 * An isolated instance: its own temp data folder and unique tmux socket. `start()` can be
 * called again after `stop()` to simulate a server restart on the same data and socket.
 */
export class TestInstance {
  readonly config: InstanceConfig;
  readonly root: string;
  /** The server most recently started. */
  private running: TestServer | undefined;
  /** Servers and modules this instance stops when it is disposed. */
  private readonly toStop: Array<{ stop(): Promise<void> }> = [];

  constructor(overrides: Partial<InstanceConfig> = {}) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "kb-test-")));
    this.config = {
      dataDir: join(this.root, "data"),
      tmuxSocket: testSocketName(),
      port: 0,
      allowedLogin: "owner@example.com",
      pickerRoot: this.root,
      ...overrides,
    };
  }

  async start(options?: ServerOptions): Promise<TestServer> {
    const server = new TestServer(
      await startServer(this.config, options),
      this.config.allowedLogin,
    );
    this.toStop.push(server);
    this.running = server;
    return server;
  }

  /**
   * A browser's state client, connected to this instance's server. After a restart it
   * reconnects to the new server, which may be on another port, as the browser reconnects to
   * the same address. Closed when the instance is disposed.
   */
  openStateClient(options: { showTimeoutMs?: number } = {}): StateClient {
    const client = createStateClient({
      ...options,
      openSocket: () => {
        if (!this.running) throw new Error("start the instance before opening a client");
        return this.running.openEventsSocket();
      },
    });
    this.toStop.push({ stop: async () => client.close() });
    return client;
  }

  /**
   * A browser's connection to a Session's terminal (`web/src/terminalConnection.ts`), over
   * a `ws` WebSocket carrying the login header. Like the state client it follows the
   * instance across `stop()` and `start()`, and is closed with the instance. Backoff
   * defaults to a few milliseconds so a test does not wait out the real delays.
   */
  openTerminalConnection(
    sessionId: string,
    options: {
      size?: { cols: number; rows: number };
      retryFirstMs?: number;
      retryMaxMs?: number;
    } = {},
  ): TerminalConnectionProbe {
    const probe = new TerminalConnectionProbe((countSocket) =>
      createTerminalConnection({
        sessionId,
        size: options.size ?? { cols: 120, rows: 30 },
        retryFirstMs: options.retryFirstMs ?? 20,
        retryMaxMs: options.retryMaxMs ?? 100,
        openSocket: (path) => {
          if (!this.running)
            throw new Error("start the instance before opening a terminal");
          countSocket();
          return this.running.openTerminalSocket(path);
        },
      }),
    );
    this.toStop.push({ stop: async () => probe.connection.close() });
    return probe;
  }

  /** Has `dispose` stop `module` too, for tests that drive a server module directly. */
  stopOnDispose(module: { stop(): Promise<void> }): void {
    this.toStop.push(module);
  }

  /** A fresh folder (real path) that Workspaces can point at. */
  makeFolder(name: string): string {
    const folder = join(this.root, name);
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  /** Kills this instance's tmux server and removes the socket file tmux leaves behind. */
  private killTmux(): void {
    try {
      execFileSync("tmux", ["-L", this.config.tmuxSocket, "kill-server"], {
        stdio: "ignore",
      });
    } catch {
      // No tmux server on this socket (a test killed it, or its last shell exited).
    }
    // tmux can leave the socket file behind even when its server is already gone, so remove
    // it by its well-known path rather than asking a server that may not exist.
    rmSync(join(tmuxSocketDir(), this.config.tmuxSocket), { force: true });
  }

  /** Stops servers, kills this instance's tmux server and removes its data. */
  async dispose(): Promise<void> {
    // Never touch the Installed or Dev instance's tmux server.
    if (!this.config.tmuxSocket.startsWith("kb-test-")) {
      throw new Error(`refusing to kill tmux socket ${this.config.tmuxSocket}`);
    }
    try {
      for (const module of this.toStop) await module.stop();
    } finally {
      this.killTmux();
      rmSync(this.root, { recursive: true, force: true });
    }
  }
}

const instances: TestInstance[] = [];

/** Creates an instance that is cleaned up automatically after the current test. */
export function createTestInstance(overrides?: Partial<InstanceConfig>): TestInstance {
  const instance = new TestInstance(overrides);
  instances.push(instance);
  return instance;
}

export async function disposeAllTestInstances(): Promise<void> {
  for (const instance of instances.splice(0)) await instance.dispose();
}
