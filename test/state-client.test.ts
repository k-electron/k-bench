import { describe, expect, it } from "vitest";
import { revisionOf, type State } from "../src/shared/state-protocol.ts";
import { createTestInstance, type TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

/** No poll, so only a change itself can produce a snapshot. */
const NO_POLL = { statePollMs: 600_000 };

function workspaceNames(state: State | undefined): string[] {
  return state?.workspaces.map((w) => w.name) ?? [];
}

/** Creates a Workspace and returns the revision its answer named, as the browser reads it. */
async function createWorkspaceAnswer(server: TestServer, folder: string, name: string) {
  const response = await server.post("/api/workspaces", { folder, name });
  expect(response.status).toBe(201);
  return revisionOf(response.headers);
}

describe("State client", () => {
  it("shows the current state on connect, and a change another client makes", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    await server.createWorkspace({ folder: instance.makeFolder("one"), name: "one" });

    const client = instance.openStateClient();
    await pollUntil(() => client.state, { description: "the first snapshot" });
    expect(workspaceNames(client.state)).toEqual(["one"]);

    await server.createWorkspace({ folder: instance.makeFolder("two"), name: "two" });
    await pollUntil(() => workspaceNames(client.state).includes("two"), {
      description: "the Workspace another client created",
    });
  });

  it("finishes waiting for a change once it shows, from a pushed snapshot", async () => {
    const instance = createTestInstance();
    const server = await instance.start(NO_POLL);
    const client = instance.openStateClient();
    await pollUntil(() => client.state, { description: "the first snapshot" });

    const revision = await createWorkspaceAnswer(
      server,
      instance.makeFolder("project"),
      "project",
    );
    const shown = await client.whenShown({ revision });

    expect(shown).toBe(true);
    expect(workspaceNames(client.state)).toEqual(["project"]);
  });

  it("reconnects by itself after the server restarts, and waits for changes by the new server's revisions", async () => {
    const instance = createTestInstance();
    const server = await instance.start(NO_POLL);
    const client = instance.openStateClient();
    await pollUntil(() => client.state, { description: "the first snapshot" });
    // Push the revisions seen so far well above where a restarted server begins.
    let seen = 0;
    for (const name of ["a", "b", "c"]) {
      seen = await createWorkspaceAnswer(server, instance.makeFolder(name), name);
    }
    expect(await client.whenShown({ revision: seen })).toBe(true);

    await server.stop();
    const restarted = await instance.start(NO_POLL);
    const revision = await createWorkspaceAnswer(
      restarted,
      instance.makeFolder("after"),
      "after",
    );
    expect(revision).toBeLessThan(seen);

    expect(await client.whenShown({ revision })).toBe(true);
    expect(workspaceNames(client.state)).toContain("after");
  });

  it("gives up waiting for a change whose answer named no revision", async () => {
    const instance = createTestInstance();
    await instance.start(NO_POLL);
    const client = instance.openStateClient({ showTimeoutMs: 200 });
    await pollUntil(() => client.state, { description: "the first snapshot" });

    const shown = await client.whenShown({ revision: revisionOf(new Headers()) });

    expect(shown).toBe(false);
  });

  it("puts the server's state back when asked to resync after a local edit", async () => {
    const instance = createTestInstance();
    const server = await instance.start(NO_POLL);
    await server.createWorkspace({ folder: instance.makeFolder("one"), name: "one" });
    await server.createWorkspace({ folder: instance.makeFolder("two"), name: "two" });
    const client = instance.openStateClient();
    // What a component shows: the newest snapshot, until an optimistic edit replaces it.
    let shown: State | undefined;
    client.subscribe((state) => {
      shown = state;
    });
    await pollUntil(() => shown, { description: "the first snapshot" });
    const serverOrder = workspaceNames(shown);
    shown = { workspaces: [...(shown?.workspaces ?? [])].reverse() };
    expect(workspaceNames(shown)).not.toEqual(serverOrder);

    client.resync();

    await pollUntil(() => workspaceNames(shown).join() === serverOrder.join(), {
      description: "the server's order",
    });
  });
});
