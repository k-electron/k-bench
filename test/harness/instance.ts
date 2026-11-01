import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceConfig } from "../../src/server/config.ts";
import { type RunningServer, startServer } from "../../src/server/server.ts";
import { TerminalClient, upgradeStatus } from "./terminal.ts";

export interface WorkspaceInfo {
  id: string;
  name: string;
  folder: string;
}
export interface SessionInfo {
  id: string;
  name: string;
}
export interface State {
  workspaces: Array<
    WorkspaceInfo & {
      position: number;
      sessions: Array<SessionInfo & { status: "running" | "stopped" }>;
    }
  >;
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

  constructor(running: RunningServer, login: string | undefined) {
    this.running = running;
    this.login = login;
    this.baseUrl = `http://127.0.0.1:${running.port}`;
  }

  /** The same server, with every request sent as `login`. */
  as(login: string): TestServer {
    return new TestServer(this.running, login);
  }

  /** The same server, with no login header at all. */
  anonymous(): TestServer {
    return new TestServer(this.running, undefined);
  }

  /** Headers every request carries. An explicit header in a request's own init wins. */
  private get loginHeaders(): Record<string, string> {
    return this.login === undefined ? {} : { [LOGIN_HEADER]: this.login };
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
  private readonly servers: TestServer[] = [];

  constructor(overrides: Partial<InstanceConfig> = {}) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "kb-test-")));
    this.config = {
      dataDir: join(this.root, "data"),
      tmuxSocket: `kb-test-${randomBytes(6).toString("hex")}`,
      port: 0,
      allowedLogin: "owner@example.com",
      pickerRoot: this.root,
      ...overrides,
    };
  }

  async start(): Promise<TestServer> {
    const server = new TestServer(
      await startServer(this.config),
      this.config.allowedLogin,
    );
    this.servers.push(server);
    return server;
  }

  /** A fresh folder (real path) that Workspaces can point at. */
  makeFolder(name: string): string {
    const folder = join(this.root, name);
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  /** Kills this instance's tmux server and removes the socket file tmux leaves behind. */
  private killTmux(): void {
    const tmux = (...args: string[]) =>
      execFileSync("tmux", ["-L", this.config.tmuxSocket, ...args], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    try {
      const socketPath = tmux("display-message", "-p", "#{socket_path}");
      tmux("kill-server");
      rmSync(socketPath, { force: true });
    } catch {
      // No tmux server on this socket: nothing to kill.
    }
  }

  /** Stops servers, kills this instance's tmux server and removes its data. */
  async dispose(): Promise<void> {
    // Never touch the Installed or Dev instance's tmux server.
    if (!this.config.tmuxSocket.startsWith("kb-test-")) {
      throw new Error(`refusing to kill tmux socket ${this.config.tmuxSocket}`);
    }
    try {
      for (const server of this.servers) await server.stop();
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
