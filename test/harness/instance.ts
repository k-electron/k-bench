import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceConfig } from "../../src/server/config.ts";
import {
  type RunningServer,
  type ServerOptions,
  startServer,
} from "../../src/server/server.ts";
import { TerminalClient } from "./terminal.ts";

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

/** A booted server, driven only through HTTP and WebSockets. */
export class TestServer {
  readonly baseUrl: string;
  private readonly running: RunningServer;

  constructor(running: RunningServer) {
    this.running = running;
    this.baseUrl = `http://127.0.0.1:${running.port}`;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(new URL(path, this.baseUrl), init);
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
    return TerminalClient.open(this.baseUrl, sessionId, size);
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

  async start(options?: ServerOptions): Promise<TestServer> {
    const server = new TestServer(await startServer(this.config, options));
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
