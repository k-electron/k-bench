import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { TestServer } from "./harness/instance.ts";

const ALL_DEFAULT = {
  model: "default",
  effort: "default",
  advisor: "default",
  focusView: false,
};
const OPUS_FOCUSED = { model: "opus", effort: "high", advisor: "off", focusView: true };

/** What the New Session dialog opens on: the last kind created and the last Launch options. */
async function lastUsed(server: TestServer) {
  const response = await server.request("/api/new-session/last");
  expect(response.status).toBe(200);
  return response.json();
}

describe("what the New Session dialog remembers", () => {
  it("is a shell with every Launch option Default before any Claude Session is created", async () => {
    const { server } = await boot();

    expect(await lastUsed(server)).toEqual({ kind: "shell", claude: ALL_DEFAULT });
  });

  it("is a shell, with the Launch options kept, once a shell is created after a Claude Session", async () => {
    const { server, workspace } = await boot();
    await server.createClaudeSession(workspace.id, { claude: OPUS_FOCUSED });
    expect(await lastUsed(server)).toEqual({ kind: "claude", claude: OPUS_FOCUSED });

    await server.createSession(workspace.id);

    expect(await lastUsed(server)).toEqual({ kind: "shell", claude: OPUS_FOCUSED });
  });

  it("is the Claude Session created last, and only one that was created", async () => {
    const { server, workspace } = await boot();
    await server.createClaudeSession(workspace.id, {
      name: "first",
      claude: { model: "haiku", effort: "low" },
    });
    await server.createClaudeSession(workspace.id, {
      name: "second",
      claude: OPUS_FOCUSED,
    });

    // None of these creates a Session, so none changes what is remembered.
    const taken = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      name: "second",
      claude: ALL_DEFAULT,
    });
    const invalid = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      claude: { model: "gpt-9" },
    });

    expect([taken.status, invalid.status]).toEqual([409, 422]);
    expect(await lastUsed(server)).toEqual({ kind: "claude", claude: OPUS_FOCUSED });
  });

  it("survives a k-bench restart", async () => {
    const { instance, server, workspace } = await boot();
    await server.createClaudeSession(workspace.id, { claude: OPUS_FOCUSED });
    await server.stop();

    const restarted = await instance.start();

    expect(await lastUsed(restarted)).toEqual({ kind: "claude", claude: OPUS_FOCUSED });
  });
});
