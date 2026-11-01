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

/** Prints `tag=COLSxROWS` as the shell sees its terminal; the typed text never contains that. */
function sizeProbe(tag: string): string {
  return `printf '%s=%sx%s\\n' ${tag} $(tput cols) $(tput lines)`;
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

  it("shrugs off nonsense resize messages and keeps serving everyone", async () => {
    const { server, session } = await bootSession();
    const bystander = await server.openTerminal(session.id);
    bystander.run(echoCommand("marker-a17c52"));
    await bystander.waitForOutput("marker-a17c52");
    const misbehaving = await server.openTerminal(session.id);

    for (const [cols, rows] of [
      [-1, 0],
      [0, 0],
      [-5, 24],
      [1e9, 1e9],
    ] as const) {
      misbehaving.resize(cols, rows);
    }
    misbehaving.type("\r");
    bystander.run(echoCommand("marker-b41e07"));

    await bystander.waitForOutput("marker-b41e07");
    // The server did not die: new connections still work, and so does the misbehaving one.
    const fresh = await server.openTerminal(session.id);
    fresh.run(echoCommand("marker-c92d18"));
    await fresh.waitForOutput("marker-c92d18");
    misbehaving.run(echoCommand("marker-d03a29"));
    await misbehaving.waitForOutput("marker-d03a29");
  });

  it("sends nothing to the shell for an empty input message", async () => {
    const { server, session } = await bootSession();
    const first = await server.openTerminal(session.id, { cols: 120, rows: 30 });
    const second = await server.openTerminal(session.id, { cols: 100, rows: 20 });
    first.run(echoCommand("shell-up-6a1b"));
    await first.waitForOutput("shell-up-6a1b");
    // cat -v shows any control byte it receives, such as a stray NUL as ^@.
    first.run("cat -v");
    first.type("ready\r");
    await first.waitForOutput(/^ready\r?\nready$/m);

    second.type("");
    second.type("after\r");

    await second.waitForOutput(/^after$/m);
    expect(second.output).not.toContain("^@");
  });

  it("ends the terminal of an unknown Session", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const terminal = await server.openTerminal("no-such-session");

    await terminal.waitForEnded();
  });

  describe("the same Session open on two devices", () => {
    it("shows both of them the output of input sent by either", async () => {
      const { server, session } = await bootSession();
      const phone = await server.openTerminal(session.id, { cols: 50, rows: 20 });
      const laptop = await server.openTerminal(session.id, { cols: 120, rows: 30 });

      // A narrow client sees only the part of a wider window around the cursor, so a long
      // prompt (a CI runner's hostname) would put the output outside the phone's view.
      phone.run(`PS1='$ '; ${echoCommand("from-the-phone-1a2b")}`);
      await phone.waitForOutput("from-the-phone-1a2b");
      await laptop.waitForOutput("from-the-phone-1a2b");

      laptop.run(echoCommand("from-the-laptop-3c4d"));
      await laptop.waitForOutput("from-the-laptop-3c4d");
      await phone.waitForOutput("from-the-laptop-3c4d");
    });

    it("gives the shell the size of whichever client sent input most recently", async () => {
      const { server, session } = await bootSession();
      const phone = await server.openTerminal(session.id, { cols: 50, rows: 20 });
      const laptop = await server.openTerminal(session.id, { cols: 120, rows: 30 });

      phone.run(sizeProbe("phone-size"));
      await phone.waitForOutput(/phone-size=50x20/);

      laptop.run(sizeProbe("laptop-size"));
      await laptop.waitForOutput(/laptop-size=120x30/);

      phone.run(sizeProbe("phone-again"));
      await phone.waitForOutput(/phone-again=50x20/);
    });

    it("keeps the Session usable for the other device when one disconnects", async () => {
      const { server, session } = await bootSession();
      const phone = await server.openTerminal(session.id, { cols: 50, rows: 20 });
      const laptop = await server.openTerminal(session.id, { cols: 120, rows: 30 });
      phone.close();

      laptop.run(echoCommand("still-here-5e6f"));

      await laptop.waitForOutput("still-here-5e6f");
    });
  });
});
