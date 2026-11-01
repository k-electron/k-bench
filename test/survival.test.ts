import { describe, expect, it, vi } from "vitest";
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

describe("Stopping the server", () => {
  it("is quiet when requests and subscribers are still busy, so real errors stay visible", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const instance = createTestInstance();
      const server = await instance.start();
      const workspace = await server.createWorkspace({
        folder: instance.makeFolder("project"),
      });
      await server.createSession(workspace.id);
      const events = await server.openEvents();
      await events.waitForSnapshot(() => true);

      // Reads and mutations keep arriving, so some are mid-flight when the server stops.
      const busy: Promise<unknown>[] = [];
      const pump = setInterval(() => {
        busy.push(server.request("/api/state").catch(() => undefined));
        busy.push(server.createSession(workspace.id).catch(() => undefined));
      }, 2);
      // biome-ignore lint/style/noRestrictedGlobals: lets requests pile up so some are mid-flight at the stop; there is no outcome to wait for.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await server.stop();
      clearInterval(pump);
      await Promise.all(busy);
      // Give anything that outlived the stop (a poll tick, a late handler) time to log.
      // biome-ignore lint/style/noRestrictedGlobals: proving an absence (no late errors) has no outcome to poll for.
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(errors.mock.calls).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
