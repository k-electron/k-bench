import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { TestServer } from "./harness/instance.ts";

interface Entry {
  kind: string;
  count: number;
  lastAt: number;
  sessionId: string;
}

async function list(server: TestServer): Promise<Entry[]> {
  const response = await server.request("/api/unsupported");
  expect(response.status).toBe(200);
  return ((await response.json()) as { entries: Entry[] }).entries;
}

function report(
  server: TestServer,
  body: { kind: string; sessionId: string; occurrenceId: string; at?: number },
) {
  return server.post("/api/unsupported", body);
}

describe("the list of unsupported kinds", () => {
  it("counts each occurrence once, however many devices report it, and links the Session it last happened in", async () => {
    const { server, workspace } = await boot();
    const one = await server.createSession(workspace.id, "one");
    const two = await server.createSession(workspace.id, "two");
    expect(await list(server)).toEqual([]);

    await report(server, {
      kind: "message:mystery_kind",
      sessionId: one.id,
      occurrenceId: `${one.id}:7`,
      at: 1_000,
    });
    // The same occurrence, from a second device.
    await report(server, {
      kind: "message:mystery_kind",
      sessionId: one.id,
      occurrenceId: `${one.id}:7`,
      at: 1_000,
    });
    expect(await list(server)).toEqual([
      { kind: "message:mystery_kind", count: 1, lastAt: 1_000, sessionId: one.id },
    ]);

    // Another occurrence, in another Session, is the second; the link follows the latest.
    await report(server, {
      kind: "message:mystery_kind",
      sessionId: two.id,
      occurrenceId: `${two.id}:3`,
      at: 2_000,
    });
    // One that happened earlier but is only reported now counts, and moves nothing back.
    await report(server, {
      kind: "message:mystery_kind",
      sessionId: one.id,
      occurrenceId: `${one.id}:9`,
      at: 500,
    });
    expect(await list(server)).toEqual([
      { kind: "message:mystery_kind", count: 3, lastAt: 2_000, sessionId: two.id },
    ]);
  });

  it("lets the owner clear a kind, and brings it back, from one, on its next occurrence", async () => {
    const { server, workspace } = await boot();
    const session = await server.createSession(workspace.id);
    const occurrence = (n: number) => ({
      kind: "command:/plugin",
      sessionId: session.id,
      occurrenceId: `${session.id}:${n}`,
    });
    await report(server, occurrence(1));
    await report(server, { ...occurrence(2), kind: "declined:elicitation" });

    const cleared = await server.delete(
      `/api/unsupported/${encodeURIComponent("command:/plugin")}`,
    );
    expect(cleared.status).toBe(204);
    expect((await list(server)).map((entry) => entry.kind)).toEqual([
      "declined:elicitation",
    ]);

    // A device that was slow to report what was already counted does not bring it back.
    await report(server, occurrence(1));
    expect((await list(server)).map((entry) => entry.kind)).toEqual([
      "declined:elicitation",
    ]);

    await report(server, occurrence(3));
    const entries = await list(server);
    expect(entries.find((entry) => entry.kind === "command:/plugin")).toMatchObject({
      count: 1,
    });
  });

  it("is the same after a k-bench restart", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createSession(workspace.id);
    await report(server, {
      kind: "block:foo",
      sessionId: session.id,
      occurrenceId: `${session.id}:2`,
      at: 4_000,
    });
    await server.stop();

    const restarted = await instance.start();

    expect(await list(restarted)).toEqual([
      { kind: "block:foo", count: 1, lastAt: 4_000, sessionId: session.id },
    ]);
  });

  it("refuses a report that names no kind or no Session that exists", async () => {
    const { server, workspace } = await boot();
    const session = await server.createSession(workspace.id);

    const noKind = await report(server, {
      kind: "",
      sessionId: session.id,
      occurrenceId: "x",
    });
    const noSession = await report(server, {
      kind: "block:foo",
      sessionId: "no-such-session",
      occurrenceId: "y",
    });

    expect([noKind.status, noSession.status]).toEqual([422, 404]);
    expect(await list(server)).toEqual([]);
  });
});
