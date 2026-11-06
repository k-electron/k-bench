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

async function lastUsed(server: TestServer) {
  const response = await server.request("/api/claude/launch-options");
  expect(response.status).toBe(200);
  return response.json();
}

describe("the last-used Launch options", () => {
  it("are all Default with Focus view off before any Claude Session is created", async () => {
    const { server, workspace } = await boot();
    await server.createSession(workspace.id);

    expect(await lastUsed(server)).toEqual(ALL_DEFAULT);
  });

  it("are the options of the Claude Session created last, and only of one that was created", async () => {
    const { server, workspace } = await boot();
    await server.createClaudeSession(workspace.id, {
      name: "first",
      claude: { model: "haiku", effort: "low" },
    });
    await server.createClaudeSession(workspace.id, {
      name: "second",
      claude: OPUS_FOCUSED,
    });

    // None of these creates a Claude Session, so none changes what is remembered.
    await server.createSession(workspace.id);
    const taken = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      name: "second",
      claude: ALL_DEFAULT,
    });
    const invalid = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      claude: { model: "gpt-9" },
    });

    expect([taken.status, invalid.status]).toEqual([409, 422]);
    expect(await lastUsed(server)).toEqual(OPUS_FOCUSED);
  });

  it("survive a k-bench restart", async () => {
    const { instance, server, workspace } = await boot();
    await server.createClaudeSession(workspace.id, { claude: OPUS_FOCUSED });
    await server.stop();

    const restarted = await instance.start();

    expect(await lastUsed(restarted)).toEqual(OPUS_FOCUSED);
  });
});
