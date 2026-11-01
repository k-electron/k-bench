import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { echoCommand } from "./harness/terminal.ts";

describe("Survival across a server restart", () => {
  it("keeps a running Session, and its screen, when the server is stopped and booted again", async () => {
    const instance = createTestInstance();
    const first = await instance.start();
    const folder = instance.makeFolder("project");
    const workspace = await first.createWorkspace({ folder });
    const session = await first.createSession(workspace.id);

    const before = await first.openTerminal(session.id);
    before.run(`${echoCommand("before-restart-91d2")}; sleep 600`);
    await before.waitForOutput("before-restart-91d2");

    await first.stop();
    const second = await instance.start();

    const state = await second.state();
    expect(state.workspaces).toMatchObject([
      { id: workspace.id, sessions: [{ id: session.id, status: "running" }] },
    ]);

    const after = await second.openTerminal(session.id);
    await after.waitForOutput("before-restart-91d2");

    // The same shell is still there: interrupt the sleep and it runs the next command.
    after.type("\x03");
    after.run(echoCommand("still-alive-5b7e"));
    await after.waitForOutput("still-alive-5b7e");
  });
});
