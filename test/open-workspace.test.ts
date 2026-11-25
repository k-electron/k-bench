import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionState, State } from "../src/shared/state-protocol.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { fakeClaudeArgs } from "./harness/fake-claude.ts";
import { createTestInstance, type TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

function open(server: TestServer, workspaceId: string): Promise<Response> {
  return server.post(`/api/workspaces/${workspaceId}/open`);
}

function roleSessions(state: State, workspaceId: string): SessionState[] {
  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  return workspace?.sessions.filter((session) => session.role !== null) ?? [];
}

describe("Opening a Workspace", () => {
  it("starts its Prime and Worker with their fixed Launch options, and opening twice is harmless", async () => {
    const { server, workspace } = await boot();

    const opens = await Promise.all([
      open(server, workspace.id),
      open(server, workspace.id),
    ]);

    expect(opens.map((response) => response.status)).toEqual([200, 200]);
    const [prime, worker] = roleSessions(await server.state(), workspace.id);
    expect([prime?.status, worker?.status]).toEqual(["running", "running"]);
    const primeArgs = await fakeClaudeArgs(await server.openTerminal(prime?.id ?? ""));
    const workerArgs = await fakeClaudeArgs(await server.openTerminal(worker?.id ?? ""));
    expect(primeArgs.slice(2)).toEqual(["--model", "opus", "--effort", "high"]);
    expect(workerArgs.slice(2)).toEqual([
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--advisor",
      "opus",
    ]);
  });

  it("restarts a Prime that stopped on its own, resuming its conversation", async () => {
    const { server, workspace } = await boot();
    await open(server, workspace.id);
    const [prime] = roleSessions(await server.state(), workspace.id);
    const id = prime?.id ?? "";
    const first = await server.openTerminal(id);
    const [, conversationId] = await fakeClaudeArgs(first);
    first.run("hello");
    await first.waitForOutput("claude-stub heard: hello");
    first.run("exit 0");
    await pollUntil(
      async () =>
        roleSessions(await server.state(), workspace.id)[0]?.status === "stopped",
      { description: "the Prime to be Stopped" },
    );

    expect((await open(server, workspace.id)).status).toBe(200);

    const again = await fakeClaudeArgs(await server.openTerminal(id));
    expect(again.slice(0, 2)).toEqual(["--resume", conversationId]);
  });

  it("starts nothing in a Missing Workspace, and starts both once its folder is fixed", async () => {
    const { instance, server, workspace } = await boot();
    rmSync(workspace.folder, { recursive: true });

    expect((await open(server, workspace.id)).status).toBe(200);
    const missing = await server.state();
    expect(missing.openWorkspaceId).toBe(workspace.id);
    expect(roleSessions(missing, workspace.id).map((s) => s.status)).toEqual([
      "stopped",
      "stopped",
    ]);

    const fixed = await server.patch(`/api/workspaces/${workspace.id}`, {
      folder: instance.makeFolder("moved"),
    });

    expect(fixed.status).toBe(200);
    const statuses = roleSessions(await server.state(), workspace.id).map(
      (s) => s.status,
    );
    expect(statuses).toEqual(["running", "running"]);
  });
});

describe("The Open Workspace", () => {
  it("shows up on every client, and moves to the first Workspace when it is deleted", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const ids: string[] = [];
    for (const name of ["a", "b", "c"]) {
      ids.push((await server.createWorkspace({ folder: instance.makeFolder(name) })).id);
    }
    const [first, , third] = ids;
    const otherClient = await server.openEvents();
    // None opened yet: the first by position.
    expect((await server.state()).openWorkspaceId).toBe(first);

    await open(server, third as string);
    await otherClient.waitForSnapshot((state) => state.openWorkspaceId === third);
    // Only opening a Workspace changes it.
    await server.createWorkspace({ folder: instance.makeFolder("d") });
    expect((await server.state()).openWorkspaceId).toBe(third);

    await server.delete(`/api/workspaces/${third}`);
    await otherClient.waitForSnapshot((state) => state.openWorkspaceId === first);
    // It was made open, so reordering leaves it where it is.
    const reversed = (await server.state()).workspaces.map((w) => w.id).reverse();
    await server.put("/api/workspaces/order", { ids: reversed });
    expect((await server.state()).openWorkspaceId).toBe(first);

    for (const id of reversed) await server.delete(`/api/workspaces/${id}`);
    expect((await server.state()).openWorkspaceId).toBeNull();
  });
});
