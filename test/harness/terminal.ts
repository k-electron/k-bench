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
  ): Promise<TerminalClient> {
    const url = new URL(`/api/sessions/${sessionId}/terminal`, baseUrl);
    url.protocol = "ws:";
    url.searchParams.set("cols", String(size.cols));
    url.searchParams.set("rows", String(size.rows));
    const socket = new WebSocket(url);
    const client = new TerminalClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
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
