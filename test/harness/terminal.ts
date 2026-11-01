import { WebSocket } from "ws";
import { pollUntil } from "./poll.ts";

const ANSI =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9]|[=>78])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * Builds a shell command that prints `marker`, where the marker does not appear in the
 * command text itself. Waiting for the marker therefore proves the shell ran the command,
 * not merely that the terminal echoed our keystrokes back.
 */
export function echoCommand(marker: string): string {
  const mid = Math.ceil(marker.length / 2);
  return `printf '%s%s\\n' '${marker.slice(0, mid)}' '${marker.slice(mid)}'`;
}

function wsUrl(baseUrl: string, path: string): URL {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url;
}

/** Thrown when the server answers a WebSocket upgrade with an ordinary HTTP response. */
export class UpgradeRefused extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`WebSocket upgrade refused with HTTP ${status}`);
    this.status = status;
  }
}

/** Tries an upgrade on `path`; resolves with the refusing HTTP status, or 101 if accepted. */
export function upgradeStatus(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(baseUrl, path), { headers });
    socket.once("open", () => {
      socket.close();
      resolve(101);
    });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", reject);
  });
}

/** A client of the terminal WebSocket: sends input/resizes and collects output. */
export class TerminalClient {
  private readonly socket: WebSocket;
  private readonly decoder = new TextDecoder();
  private received = "";
  closeCode: number | undefined;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data: Buffer) => {
      this.received += this.decoder.decode(data, { stream: true });
    });
    socket.on("close", (code) => {
      this.closeCode = code;
    });
  }

  static async open(
    baseUrl: string,
    sessionId: string,
    size: { cols: number; rows: number } = { cols: 120, rows: 30 },
    headers: Record<string, string> = {},
  ): Promise<TerminalClient> {
    const url = wsUrl(baseUrl, `/api/sessions/${sessionId}/terminal`);
    url.searchParams.set("cols", String(size.cols));
    url.searchParams.set("rows", String(size.rows));
    const socket = new WebSocket(url, { headers });
    const client = new TerminalClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        reject(new UpgradeRefused(response.statusCode ?? 0));
      });
      socket.once("error", reject);
    });
    return client;
  }

  /** Everything received so far, escape sequences removed. */
  get output(): string {
    return stripAnsi(this.received);
  }

  /** Types `text` into the terminal. Include "\r" to press Enter. */
  type(text: string): void {
    this.socket.send(JSON.stringify({ type: "input", data: text }));
  }

  /** Runs a command line: types it and presses Enter. */
  run(command: string): void {
    this.type(`${command}\r`);
  }

  resize(cols: number, rows: number): void {
    this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  /** Waits until the output contains `needle` (a string or a pattern). */
  async waitForOutput(
    needle: string | RegExp,
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    const matches = () =>
      typeof needle === "string"
        ? this.output.includes(needle)
        : needle.test(this.output);
    await pollUntil(matches, {
      timeoutMs: options.timeoutMs,
      description: `terminal output ${needle}; last output was:\n${this.output.slice(-1500)}`,
    });
  }

  async waitForClose(): Promise<number> {
    return pollUntil(() => this.closeCode, { description: "terminal socket to close" });
  }

  close(): void {
    this.socket.close();
  }
}
