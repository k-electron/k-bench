import { describe, expect, it } from "vitest";
import type { State } from "../src/shared/state-protocol.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { TestServer } from "./harness/instance.ts";

function rightPaneOf(state: State, workspaceId: string) {
  return state.workspaces.find((w) => w.id === workspaceId)?.rightPane;
}

function setRightPane(
  server: TestServer,
  workspaceId: string,
  body: unknown,
): Promise<Response> {
  return server.put(`/api/workspaces/${workspaceId}/right-pane`, body);
}

describe("The right Pane", () => {
  it("shows the Worker with no tabs until the owner opens something there, and keeps what they open across a restart", async () => {
    const { instance, server, workspace } = await boot();
    const a = await server.createSession(workspace.id, "a");
    const b = await server.createSession(workspace.id, "b");
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: null,
      tabs: [],
    });

    const response = await setRightPane(server, workspace.id, {
      shown: a.id,
      tabs: [b.id, a.id],
    });

    expect(response.status).toBe(200);
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: a.id,
      tabs: [b.id, a.id],
    });
    await server.stop();
    const again = await instance.start();
    expect(rightPaneOf(await again.state(), workspace.id)).toEqual({
      shown: a.id,
      tabs: [b.id, a.id],
    });
  });

  it("answers 422 unless every tab is one of the Workspace's Other Sessions and what's shown is a tab, and changes nothing", async () => {
    const { instance, server, workspace } = await boot();
    const a = await server.createSession(workspace.id, "a");
    const b = await server.createSession(workspace.id, "b");
    const [prime, worker] = (await server.state()).workspaces[0]?.sessions ?? [];
    const elsewhere = await server.createWorkspace({
      folder: instance.makeFolder("other"),
    });
    const stranger = await server.createSession(elsewhere.id, "stranger");
    await setRightPane(server, workspace.id, { shown: a.id, tabs: [a.id] });

    for (const body of [
      { shown: b.id, tabs: [a.id] },
      { shown: null, tabs: [a.id, "nope"] },
      { shown: null, tabs: [a.id, a.id] },
      { shown: null, tabs: [prime?.id] },
      { shown: worker?.id, tabs: [worker?.id] },
      { shown: null, tabs: [stranger.id] },
      { shown: null, tabs: "a" },
      { shown: 7, tabs: [] },
      { tabs: [b.id] },
    ]) {
      const response = await setRightPane(server, workspace.id, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: a.id,
      tabs: [a.id],
    });
    const unknown = await setRightPane(server, "nope", { shown: null, tabs: [] });
    expect(unknown.status).toBe(404);
  });

  it("loses a deleted Session's tab, and shows the Worker again if that tab was shown", async () => {
    const { server, workspace } = await boot();
    const a = await server.createSession(workspace.id, "a");
    const b = await server.createSession(workspace.id, "b");
    await setRightPane(server, workspace.id, { shown: b.id, tabs: [a.id, b.id] });

    await server.deleteSession(a.id);
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: b.id,
      tabs: [b.id],
    });

    await server.deleteSession(b.id);
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: null,
      tabs: [],
    });
  });

  it("shows the Worker again, keeping the tabs, when the Workspace is opened by its name, but not on a plain open", async () => {
    const { server, workspace } = await boot();
    const a = await server.createSession(workspace.id, "a");
    await setRightPane(server, workspace.id, { shown: a.id, tabs: [a.id] });

    const plain = await server.post(`/api/workspaces/${workspace.id}/open`);
    expect(plain.status).toBe(200);
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: a.id,
      tabs: [a.id],
    });

    const byName = await server.post(`/api/workspaces/${workspace.id}/open`, {
      showWorker: true,
    });
    expect(byName.status).toBe(200);
    expect(rightPaneOf(await server.state(), workspace.id)).toEqual({
      shown: null,
      tabs: [a.id],
    });
  });
});
