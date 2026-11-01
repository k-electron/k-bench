import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";

describe("Workspaces and Sessions over the API", () => {
  it("creates a Workspace and a Session, and state lists the Session as running", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("project");

    const workspace = await server.createWorkspace({ name: "My project", folder });
    const session = await server.createSession(workspace.id);

    expect(workspace.id).toBeTruthy();
    expect(session.id).toBeTruthy();
    const state = await server.state();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0]).toMatchObject({
      id: workspace.id,
      name: "My project",
      folder,
    });
    expect(state.workspaces[0]?.sessions).toMatchObject([
      { id: session.id, name: "session 1", status: "running" },
    ]);
  });
});
