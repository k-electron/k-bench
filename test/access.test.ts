import { networkInterfaces } from "node:os";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { echoCommand, UpgradeRefused } from "./harness/terminal.ts";

async function bootSession() {
  const instance = createTestInstance();
  const server = await instance.start();
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  const session = await server.createSession(workspace.id);
  return { instance, server, workspace, session };
}

describe("Access guard", () => {
  it("serves HTTP requests that carry the configured login", async () => {
    const { server } = await bootSession();

    const response = await server.request("/api/state");

    expect(response.status).toBe(200);
  });

  it("refuses HTTP requests from another login with 403", async () => {
    const { server } = await bootSession();

    const response = await server.as("stranger@example.com").request("/api/state");

    expect(response.status).toBe(403);
  });

  it("refuses HTTP requests with no login header with 403", async () => {
    const { server } = await bootSession();

    const response = await server.anonymous().request("/api/state");

    expect(response.status).toBe(403);
  });

  it("refuses a login that only resembles the configured one", async () => {
    const { server } = await bootSession();

    for (const login of [
      "OWNER@example.com",
      "owner@example.co",
      "xowner@example.com",
      "owner@example.com.evil",
    ]) {
      const response = await server.as(login).request("/api/state");
      expect(response.status, login).toBe(403);
    }
  });

  it("refuses wrong logins on every method and path, including ones the app does not serve", async () => {
    const { server, workspace } = await bootSession();
    const stranger = server.as("stranger@example.com");

    const attempts: Array<[string, string]> = [
      ["POST", "/api/workspaces"],
      ["POST", `/api/workspaces/${workspace.id}/sessions`],
      ["GET", "/"],
      ["GET", "/index.html"],
      ["GET", "/assets/app.js"],
      ["GET", "/api/no-such-route"],
    ];
    for (const [method, path] of attempts) {
      const response = await stranger.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("does not run a refused mutation", async () => {
    const { instance, server } = await bootSession();

    const refused = await server
      .as("stranger@example.com")
      .post("/api/workspaces", { folder: instance.makeFolder("intruder") });

    expect(refused.status).toBe(403);
    expect((await server.state()).workspaces).toHaveLength(1);
  });

  it("opens a terminal for the configured login", async () => {
    const { server, session } = await bootSession();
    const terminal = await server.openTerminal(session.id);

    terminal.run(echoCommand("marker-a7c3e1"));

    await terminal.waitForOutput("marker-a7c3e1");
  });

  it("refuses a terminal upgrade from another login with 403", async () => {
    const { server, session } = await bootSession();

    const refused = await server
      .as("stranger@example.com")
      .openTerminal(session.id)
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(UpgradeRefused);
    expect((refused as UpgradeRefused).status).toBe(403);
  });

  it("refuses a terminal upgrade with no login header with 403", async () => {
    const { server, session } = await bootSession();

    const refused = await server
      .anonymous()
      .openTerminal(session.id)
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(UpgradeRefused);
    expect((refused as UpgradeRefused).status).toBe(403);
  });

  it("opens the events socket for the configured login", async () => {
    const { server } = await bootSession();

    expect(await server.upgradeStatus("/api/events")).toBe(101);
  });

  it("refuses wrong or missing logins on any WebSocket upgrade path, such as the events socket", async () => {
    const { server } = await bootSession();

    expect(await server.as("stranger@example.com").upgradeStatus("/api/events")).toBe(
      403,
    );
    expect(await server.anonymous().upgradeStatus("/api/events")).toBe(403);
  });

  it("refuses everyone when no login is configured", async () => {
    const instance = createTestInstance({ allowedLogin: "" });
    const server = await instance.start();

    expect((await server.request("/api/state")).status).toBe(403);
    expect((await server.anonymous().request("/api/state")).status).toBe(403);
    expect((await server.as("").request("/api/state")).status).toBe(403);
  });
});

describe("Listening address", () => {
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;

  it.skipIf(lanAddress === undefined)(
    "is unreachable on the machine's network address, only on loopback",
    async () => {
      const { server } = await bootSession();
      const port = new URL(server.baseUrl).port;
      const headers = { "Tailscale-User-Login": "owner@example.com" };

      const viaLoopback = await fetch(`http://127.0.0.1:${port}/api/state`, { headers });
      const viaNetwork = await fetch(`http://${lanAddress}:${port}/api/state`, {
        headers,
      }).catch((error: unknown) => error);

      expect(viaLoopback.status).toBe(200);
      expect(viaNetwork).toBeInstanceOf(Error);
    },
  );
});
