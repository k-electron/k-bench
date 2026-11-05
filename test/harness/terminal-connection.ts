import type { TerminalConnection } from "../../web/src/terminalConnection.ts";
import { pollUntil } from "./poll.ts";
import { stripAnsi } from "./terminal.ts";

/**
 * A browser terminal connection (`web/src/terminalConnection.ts`) with what it reported
 * collected, the way a Pane's terminal would show it: the output so far, whether it is
 * reconnecting, whether the Session ended, and how many sockets it has opened.
 */
export class TerminalConnectionProbe {
  readonly connection: TerminalConnection;
  private readonly decoder = new TextDecoder();
  private received = "";
  reconnecting = false;
  ended = false;
  /** Every `reconnecting` report, in order. */
  readonly reconnectingReports: boolean[] = [];
  /** How many sockets the connection has opened. */
  socketsOpened = 0;

  constructor(build: (countSocket: () => void) => TerminalConnection) {
    this.connection = build(() => {
      this.socketsOpened += 1;
    });
    this.connection.subscribe({
      output: (bytes) => {
        this.received += this.decoder.decode(bytes, { stream: true });
      },
      reconnecting: (on) => {
        this.reconnecting = on;
        this.reconnectingReports.push(on);
      },
      ended: () => {
        this.ended = true;
      },
    });
  }

  /** Everything received so far, escape sequences removed. */
  get output(): string {
    return stripAnsi(this.received);
  }

  /** Types `command` and presses Enter. */
  run(command: string): void {
    this.connection.input(`${command}\r`);
  }

  async waitForOutput(needle: string, options: { timeoutMs?: number } = {}) {
    await pollUntil(() => this.output.includes(needle), {
      timeoutMs: options.timeoutMs,
      description: `terminal output ${needle}; last output was:\n${this.output.slice(-1500)}`,
    });
  }
}
