import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { echoCommand } from "./harness/terminal.ts";

async function bootSession(folderName = "project") {
  const instance = createTestInstance();
  const server = await instance.start();
  const folder = instance.makeFolder(folderName);
  const workspace = await server.createWorkspace({ folder });
  const session = await server.createSession(workspace.id);
  return { instance, server, folder, workspace, session };
}

describe("Terminal WebSocket", () => {
  it("shows the output of a command typed into the Session", async () => {
    const { server, session } = await bootSession();
    const terminal = await server.openTerminal(session.id);

    terminal.run(echoCommand("marker-3f9a1c"));

    await terminal.waitForOutput("marker-3f9a1c");
  });

  it("starts the shell in the Workspace folder", async () => {
    const { server, session, folder } = await bootSession("some-project");
    const terminal = await server.openTerminal(session.id);

    terminal.run("pwd");

    await terminal.waitForOutput(folder);
  });

  it("starts a login shell with the owner's PATH", async () => {
    const { server, session } = await bootSession();
    const terminal = await server.openTerminal(session.id);

    terminal.run(`printf 'path<%s>\\n' "$PATH"`);

    await terminal.waitForOutput(/path<[^>]*\/usr\/bin[^>]*>/);
  });

  it("changes the size the shell sees when the terminal is resized", async () => {
    const { server, session } = await bootSession();
    const terminal = await server.openTerminal(session.id, { cols: 120, rows: 30 });

    terminal.resize(97, 31);
    terminal.run("stty size");

    await terminal.waitForOutput(/^31 97$/m);
  });

  it("closes the socket with a distinct code for an unknown Session", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const terminal = await server.openTerminal("no-such-session");

    expect(await terminal.waitForClose()).toBe(4404);
  });
});
