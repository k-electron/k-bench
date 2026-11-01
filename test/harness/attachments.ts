import {
  Attachments,
  type EndReason,
  type Sessions,
  type Viewer,
} from "../../src/server/attachments.ts";
import { TmuxDriver } from "../../src/server/tmux.ts";
import { createTestInstance } from "./instance.ts";
import { pollUntil } from "./poll.ts";
import { stripAnsi } from "./terminal.ts";

/**
 * A running Session on a throwaway tmux socket, and an Attachments module over it, for
 * tests at the module's interface. The lookup says the Session is running unless the test
 * passes its own. Everything is stopped and removed after the test.
 */
export async function bootAttachments(
  options: { lookup?: (sessionId: string) => boolean | Promise<boolean> } = {},
) {
  const instance = createTestInstance();
  const socket = instance.config.tmuxSocket;
  const tmux = new TmuxDriver(socket);
  const sessionId = "session-under-test";
  await tmux.createSession(sessionId, instance.makeFolder("project"));
  const lookup = options.lookup ?? ((id: string) => id === sessionId);
  const sessions: Sessions = {
    hasRunningShell: async (id) => lookup(id),
  };
  const attachments = new Attachments(tmux, sessions);
  instance.stopOnDispose(attachments);
  return { attachments, sessionId, socket };
}

/** A viewer that records what the module shows it and how the terminal ended. */
export class RecordingViewer implements Viewer {
  private readonly decoder = new TextDecoder();
  private received = "";
  /** Every end the module reported, in order. A correct module reports at most one. */
  readonly endings: EndReason[] = [];

  show(output: Buffer): void {
    this.received += this.decoder.decode(output, { stream: true });
  }

  end(reason: EndReason): void {
    this.endings.push(reason);
  }

  /** Everything shown so far, escape sequences removed. */
  get output(): string {
    return stripAnsi(this.received);
  }

  async waitForOutput(needle: string | RegExp): Promise<void> {
    await pollUntil(
      () =>
        typeof needle === "string"
          ? this.output.includes(needle)
          : needle.test(this.output),
      { description: `output ${needle}; last output was:\n${this.output.slice(-1500)}` },
    );
  }

  async waitForEnd(): Promise<EndReason> {
    return pollUntil(() => this.endings[0], { description: "the terminal to end" });
  }
}

/** A promise the test settles by hand, to hold the module mid-await. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Waits long enough for something that should not happen to have shown itself: a tmux
 * client starting, say. Only for proving an absence; wait for outcomes with `pollUntil`.
 */
export async function allowTimeToMisbehave(): Promise<void> {
  // biome-ignore lint/style/noRestrictedGlobals: proving that nothing happens takes a wait
  await new Promise((resolve) => setTimeout(resolve, 300));
}
