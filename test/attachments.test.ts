import { describe, expect, it } from "vitest";
import {
  allowTimeToMisbehave,
  bootAttachments,
  deferred,
  RecordingViewer,
} from "./harness/attachments.ts";
import { pollUntil } from "./harness/poll.ts";
import { echoCommand } from "./harness/terminal.ts";
import { tmuxClientProcessCount, tmuxSessionNames } from "./harness/tmux.ts";

const SIZE = { cols: 120, rows: 30 };

/**
 * How soon typed input must reach the shell when a different terminal starts typing. The
 * shell gets the typer's size within tmux's 250ms resize throttle, and usually well inside
 * it, while a wait that gives up on that takes over half a second, so it can never pass.
 */
const MAX_INPUT_DELAY_MS = 500;

/** Milliseconds from `type` until the shell has run the command printing `marker`. */
async function timeUntilShellRuns(
  viewer: RecordingViewer,
  marker: string,
  type: () => void | Promise<void>,
): Promise<number> {
  const start = performance.now();
  await type();
  await pollUntil(() => viewer.output.includes(marker), {
    intervalMs: 5,
    description: `output ${marker}`,
  });
  return performance.now() - start;
}

describe("Attachments", () => {
  it("shrugs off input and resizes once the Session's shell has exited", async () => {
    const { attachments, sessionId, socket } = await bootAttachments();
    const viewer = new RecordingViewer();
    const terminal = attachments.attach(sessionId, SIZE, viewer);
    terminal.input(`${echoCommand("shell-up-0e41")}\r`);
    await viewer.waitForOutput("shell-up-0e41");

    terminal.input("exit\r");
    // Keep typing and resizing through the shell's exit, so some of it lands after the
    // tmux client is gone but before the terminal has heard so.
    await pollUntil(
      () => {
        terminal.input("x");
        terminal.resize(100, 40);
        return viewer.endings.length > 0;
      },
      { intervalMs: 1, description: "the terminal to end" },
    );
    terminal.input("more\r");
    terminal.resize(90, 20);

    expect(viewer.endings).toEqual(["session-ended"]);
    expect(tmuxClientProcessCount(socket)).toBe(0);
  });

  it("sends nothing to the Session once the viewer has detached", async () => {
    const { attachments, sessionId, socket } = await bootAttachments();
    const leaving = new RecordingViewer();
    const watching = new RecordingViewer();
    const left = attachments.attach(sessionId, SIZE, leaving);
    const watcher = attachments.attach(sessionId, SIZE, watching);
    watcher.input(`PS1='$ '; ${echoCommand("shell-up-9b2d")}\r`);
    await watching.waitForOutput("shell-up-9b2d");
    // The leaving viewer typed last, so nothing holds back what it sends next.
    left.input(`${echoCommand("typed-last-63aa")}\r`);
    await leaving.waitForOutput("typed-last-63aa");

    left.detach();
    left.input(`${echoCommand("after-detach-4c7e")}\r`);
    left.resize(60, 10);
    left.detach();

    watcher.input(`${echoCommand("still-running-d81f")}\r`);
    await watching.waitForOutput("still-running-d81f");
    expect(watching.output).not.toContain("after-detach-4c7e");
    await pollUntil(() => tmuxClientProcessCount(socket) === 1, {
      description: "the detached tmux client to exit",
    });
    expect(leaving.endings).toEqual([]);
  });

  describe("when a different terminal starts typing", () => {
    /**
     * Two terminals of different sizes on one Session, the first having typed last, so the
     * second's typing has to take the window's size.
     */
    async function twoTerminals() {
      const { attachments, sessionId } = await bootAttachments();
      const firstViewer = new RecordingViewer();
      const secondViewer = new RecordingViewer();
      const first = attachments.attach(sessionId, SIZE, firstViewer);
      const second = attachments.attach(sessionId, { cols: 80, rows: 24 }, secondViewer);
      first.input(`${echoCommand("first-typed-3c1a")}\r`);
      await secondViewer.waitForOutput("first-typed-3c1a");
      return { second, secondViewer };
    }

    it("gets its input to the shell without holding it back", async () => {
      const { second, secondViewer } = await twoTerminals();

      const elapsed = await timeUntilShellRuns(secondViewer, "second-typed-7d0b", () =>
        second.input(`${echoCommand("second-typed-7d0b")}\r`),
      );

      expect(elapsed).toBeLessThan(MAX_INPUT_DELAY_MS);
    });

    it("gets its input to the shell promptly when it resizes as it types", async () => {
      const { second, secondViewer } = await twoTerminals();

      const elapsed = await timeUntilShellRuns(
        secondViewer,
        "resized-typed-52e8",
        async () => {
          second.input(`${echoCommand("resized-typed-52e8")}\r`);
          // One turn of the event loop: the module has taken the input and is checking the
          // shell's size, so the resize lands after the key arrived but before tmux has it.
          await new Promise((resolve) => setImmediate(resolve));
          second.resize(60, 20);
        },
      );

      expect(elapsed).toBeLessThan(MAX_INPUT_DELAY_MS);
    });
  });

  it("ends the viewer as failed when its Session cannot be looked up", async () => {
    let lookups = 0;
    const { attachments, sessionId, socket } = await bootAttachments({
      lookup: async () => {
        lookups += 1;
        if (lookups === 1) throw new Error("the store is unavailable");
        return true;
      },
    });
    const failing = new RecordingViewer();

    attachments.attach(sessionId, SIZE, failing).input("x");

    expect(await failing.waitForEnd()).toBe("failed");
    expect(tmuxClientProcessCount(socket)).toBe(0);
    // Only that terminal failed: the next one attaches as usual.
    const next = new RecordingViewer();
    attachments.attach(sessionId, SIZE, next).input(`${echoCommand("works-8d3e")}\r`);
    await next.waitForOutput("works-8d3e");
  });

  describe("stopping", () => {
    it("leaves no tmux client running once it resolves, and the Sessions running", async () => {
      const { attachments, sessionId, socket } = await bootAttachments();
      const first = new RecordingViewer();
      const second = new RecordingViewer();
      attachments.attach(sessionId, SIZE, first);
      attachments.attach(sessionId, SIZE, second).input(`${echoCommand("up-5f10")}\r`);
      await first.waitForOutput("up-5f10");
      expect(tmuxClientProcessCount(socket)).toBe(2);

      await attachments.stop();

      expect(tmuxClientProcessCount(socket)).toBe(0);
      expect(first.endings).toEqual(["server-stopping"]);
      expect(second.endings).toEqual(["server-stopping"]);
      expect(tmuxSessionNames(socket)).toEqual([`kb-${sessionId}`]);
    });

    it("starts no tmux client for a terminal still looking up its Session", async () => {
      const lookup = deferred<boolean>();
      const { attachments, sessionId, socket } = await bootAttachments({
        lookup: () => lookup.promise,
      });
      const viewer = new RecordingViewer();
      const terminal = attachments.attach(sessionId, SIZE, viewer);
      terminal.input(`${echoCommand("never-typed-2a9c")}\r`);

      await attachments.stop();
      lookup.resolve(true);
      await allowTimeToMisbehave();

      expect(tmuxClientProcessCount(socket)).toBe(0);
      expect(viewer.endings).toEqual(["server-stopping"]);
      expect(viewer.output).toBe("");
      terminal.input("x");
      terminal.detach();
    });

    it("drains every terminal even when a viewer throws as it is ended", async () => {
      const { attachments, sessionId, socket } = await bootAttachments();
      const throwing = new RecordingViewer();
      throwing.end = () => {
        throw new Error("the socket is broken");
      };
      const other = new RecordingViewer();
      attachments.attach(sessionId, SIZE, throwing);
      attachments.attach(sessionId, SIZE, other).input(`${echoCommand("up-7e21")}\r`);
      await other.waitForOutput("up-7e21");
      expect(tmuxClientProcessCount(socket)).toBe(2);

      await attachments.stop();

      expect(tmuxClientProcessCount(socket)).toBe(0);
      expect(other.endings).toEqual(["server-stopping"]);
    });

    it("ends a terminal opened after it at once, starting no tmux client", async () => {
      const { attachments, sessionId, socket } = await bootAttachments();
      await attachments.stop();
      const viewer = new RecordingViewer();

      attachments.attach(sessionId, SIZE, viewer).input("x");
      await allowTimeToMisbehave();

      expect(viewer.endings).toEqual(["server-stopping"]);
      expect(tmuxClientProcessCount(socket)).toBe(0);
    });
  });
});
