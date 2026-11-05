import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { echoCommand } from "./harness/terminal.ts";

async function bootSession() {
  const instance = createTestInstance();
  const server = await instance.start();
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  const session = await server.createSession(workspace.id);
  return { instance, server, session };
}

describe("Terminal connection", () => {
  it("delivers input sent the moment it is opened, before the socket is open, to the shell", async () => {
    const { instance, session } = await bootSession();
    const terminal = instance.openTerminalConnection(session.id);

    terminal.run(echoCommand("early-7c1e90"));

    await terminal.waitForOutput("early-7c1e90");
  });

  it("reconnects by itself after the server restarts, reports it, and the shell hears the owner again", async () => {
    const { instance, server, session } = await bootSession();
    const terminal = instance.openTerminalConnection(session.id);
    terminal.run(echoCommand("before-4a8d02"));
    await terminal.waitForOutput("before-4a8d02");

    await server.stop();
    await pollUntil(() => terminal.reconnecting, {
      description: "the reconnecting report",
    });
    await instance.start();
    await pollUntil(() => !terminal.reconnecting, {
      description: "the connection to be back",
    });
    terminal.run(echoCommand("after-b61f35"));

    await terminal.waitForOutput("after-b61f35");
  });

  it("reports that the Session ended when it is deleted, and never connects again", async () => {
    const { instance, server, session } = await bootSession();
    const terminal = instance.openTerminalConnection(session.id);
    terminal.run(echoCommand("alive-93d7e0"));
    await terminal.waitForOutput("alive-93d7e0");

    expect((await server.deleteSession(session.id)).status).toBe(204);
    await pollUntil(() => terminal.ended, { description: "the ended report" });
    const opened = terminal.socketsOpened;
    // biome-ignore lint/style/noRestrictedGlobals: proving that nothing happens takes a wait, several times the backoff
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(terminal.socketsOpened).toBe(opened);
    expect(terminal.reconnecting).toBe(false);
  });

  it("drops input sent while a retry waits, so it does not reach the shell after the reconnect", async () => {
    const { instance, server, session } = await bootSession();
    // Long enough that the input below is sent well before the first retry starts.
    const terminal = instance.openTerminalConnection(session.id, {
      retryFirstMs: 300,
      retryMaxMs: 300,
    });
    terminal.run(echoCommand("first-0e5c8a"));
    await terminal.waitForOutput("first-0e5c8a");

    await server.stop();
    await pollUntil(() => terminal.reconnecting, {
      description: "the reconnecting report",
    });
    terminal.run(echoCommand("dropped-d24b71"));
    await instance.start();
    await pollUntil(() => !terminal.reconnecting, {
      description: "the connection to be back",
    });
    terminal.run(echoCommand("after-5f3a96"));

    // The shell runs what it hears in order, so by now it would have run the dropped one.
    await terminal.waitForOutput("after-5f3a96");
    expect(terminal.output).not.toContain("dropped-d24b71");
  });

  it("reconnects at once when the page wakes, without waiting out the backoff", async () => {
    const { instance, server, session } = await bootSession();
    let wake: () => void = () => {};
    // A retry delay no test would wait out: only waking can bring the connection back.
    const terminal = instance.openTerminalConnection(session.id, {
      retryFirstMs: 600_000,
      retryMaxMs: 600_000,
      wake: (retry) => {
        wake = retry;
        return () => {};
      },
    });
    terminal.run(echoCommand("awake-1b9e44"));
    await terminal.waitForOutput("awake-1b9e44");

    await server.stop();
    await pollUntil(() => terminal.reconnecting, {
      description: "the reconnecting report",
    });
    await instance.start();
    wake();
    await pollUntil(() => !terminal.reconnecting, {
      description: "the connection to be back",
    });
    terminal.run(echoCommand("again-c70d25"));

    await terminal.waitForOutput("again-c70d25");
  });
});
