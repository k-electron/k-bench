import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { echoCommand } from "./harness/terminal.ts";
import { killTmuxServer } from "./harness/tmux.ts";

/** Two Workspaces; the first one's folder is then removed from under it. */
async function bootWithVanishedFolder() {
  const instance = createTestInstance();
  const server = await instance.start();
  const brokenFolder = instance.makeFolder("broken");
  const broken = await server.createWorkspace({ folder: brokenFolder });
  const healthy = await server.createWorkspace({
    folder: instance.makeFolder("healthy"),
  });
  const running = await server.createSession(broken.id);
  const stopped = await server.createSession(broken.id);
  const healthyStopped = await server.createSession(healthy.id);
  const terminal = await server.openTerminal(stopped.id);
  terminal.run("exit");
  await terminal.waitForClose();
  rmSync(brokenFolder, { recursive: true });
  return {
    instance,
    server,
    brokenFolder,
    broken,
    healthy,
    running,
    stopped,
    healthyStopped,
  };
}

describe("Missing Workspaces", () => {
  it("reports a Workspace whose folder vanished as Missing, and every other one normally", async () => {
    const { server, broken, healthy, running, healthyStopped } =
      await bootWithVanishedFolder();

    const { workspaces } = await server.state();

    expect(workspaces.map((w) => [w.name, w.missing])).toEqual([
      ["broken", true],
      ["healthy", false],
    ]);
    expect(workspaces.find((w) => w.id === broken.id)?.sessions).toMatchObject([
      { id: running.id, status: "running" },
      { status: "stopped" },
    ]);
    expect(workspaces.find((w) => w.id === healthy.id)?.sessions).toMatchObject([
      { id: healthyStopped.id, status: "running" },
    ]);
  });

  it("refuses to create or restart a Session there with 422, while another Workspace still works", async () => {
    const { server, brokenFolder, broken, healthy, stopped } =
      await bootWithVanishedFolder();

    const created = await server.post(`/api/workspaces/${broken.id}/sessions`);
    const restarted = await server.post(`/api/sessions/${stopped.id}/restart`);

    expect(created.status).toBe(422);
    expect(restarted.status).toBe(422);
    expect(((await created.json()) as { error: string }).error).toContain(brokenFolder);
    expect(((await restarted.json()) as { error: string }).error).toContain(brokenFolder);
    const other = await server.createSession(healthy.id);
    const terminal = await server.openTerminal(other.id);
    terminal.run(echoCommand("healthy-still-ok-4e71"));
    await terminal.waitForOutput("healthy-still-ok-4e71");
  });

  it("lets a Session that was running when the folder vanished keep taking input and producing output", async () => {
    const { server, running } = await bootWithVanishedFolder();

    const terminal = await server.openTerminal(running.id);
    terminal.run(echoCommand("carried-on-83c2"));

    await terminal.waitForOutput("carried-on-83c2");
  });

  it("clears Missing when the folder is changed to one that exists, and new Sessions start there", async () => {
    const { instance, server, broken, stopped } = await bootWithVanishedFolder();
    const restored = instance.makeFolder("restored");

    const response = await server.patch(`/api/workspaces/${broken.id}`, {
      folder: restored,
    });

    expect(response.status).toBe(200);
    const [first] = (await server.state()).workspaces;
    expect(first).toMatchObject({ id: broken.id, folder: restored, missing: false });
    const fresh = await server.createSession(broken.id);
    const terminal = await server.openTerminal(fresh.id);
    terminal.run("pwd");
    await terminal.waitForOutput(restored);
    expect((await server.post(`/api/sessions/${stopped.id}/restart`)).status).toBe(200);
  });

  it("clears Missing when the folder comes back at its old path", async () => {
    const { instance, server, brokenFolder } = await bootWithVanishedFolder();

    instance.makeFolder("broken");

    const [first] = (await server.state()).workspaces;
    expect(first).toMatchObject({ folder: brokenFolder, missing: false });
  });

  it("still marks the Workspace Missing, with Sessions Stopped, after the tmux server dies too", async () => {
    const { instance, server, broken } = await bootWithVanishedFolder();

    killTmuxServer(instance.config.tmuxSocket);

    const state = await server.state();
    const workspace = state.workspaces.find((w) => w.id === broken.id);
    expect(workspace?.missing).toBe(true);
    expect(workspace?.sessions.map((s) => s.status)).toEqual(["stopped", "stopped"]);
  });
});
