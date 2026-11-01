import { request as httpRequest } from "node:http";
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

/**
 * GETs `path` with node:http, which (unlike fetch) lets a test choose the Host header, as a
 * reverse proxy such as `tailscale serve` does.
 */
function getStatus(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, baseUrl), { headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once("error", reject);
    request.end();
  });
}

const EVIL = { origin: "https://evil.example" };

describe("Cross-site requests", () => {
  it("refuses a request from a page on another origin, even with the owner's login", async () => {
    const { instance, server } = await bootSession();
    const page = server.withHeaders(EVIL);

    expect((await page.request("/api/state")).status).toBe(403);
    const refused = await page.post("/api/workspaces", {
      folder: instance.makeFolder("intruder"),
    });
    expect(refused.status).toBe(403);
    expect((await server.state()).workspaces).toHaveLength(1);
  });

  it("refuses a cross-site text/plain form post and does not run it", async () => {
    const { instance, server, workspace } = await bootSession();
    const page = server.withHeaders(EVIL);

    const refused = await page.request(`/api/workspaces/${workspace.id}`, {
      method: "DELETE",
    });
    const form = await page.request("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ folder: instance.makeFolder("intruder") }),
    });

    expect(refused.status).toBe(403);
    expect(form.status).toBe(403);
    expect((await server.state()).workspaces).toHaveLength(1);
  });

  it("refuses an Origin of null (a sandboxed frame) and one that only resembles the host", async () => {
    const { server } = await bootSession();
    const host = new URL(server.baseUrl).host;

    for (const origin of ["null", `http://${host}.evil.example`, `http://x${host}`]) {
      const response = await server.withHeaders({ origin }).request("/api/state");
      expect(response.status, origin).toBe(403);
    }
  });

  it("refuses a terminal upgrade from a page on another origin", async () => {
    const { server, session } = await bootSession();

    const refused = await server
      .withHeaders(EVIL)
      .openTerminal(session.id)
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(UpgradeRefused);
    expect((refused as UpgradeRefused).status).toBe(403);
  });

  it("refuses an events upgrade from a page on another origin", async () => {
    const { server } = await bootSession();

    expect(await server.withHeaders(EVIL).upgradeStatus("/api/events")).toBe(403);
  });
});

describe("Same-site and non-browser requests", () => {
  it("serves a page whose Origin is the server's own host, over HTTP and WebSocket", async () => {
    const { server, session } = await bootSession();
    const host = new URL(server.baseUrl).host;
    const page = server.withHeaders({ origin: `http://${host}` });

    expect((await page.request("/api/state")).status).toBe(200);
    expect(await page.upgradeStatus("/api/events")).toBe(101);
    const terminal = await page.openTerminal(session.id);
    terminal.run(echoCommand("marker-5d2f9b"));
    await terminal.waitForOutput("marker-5d2f9b");
  });

  it("serves a request through a proxy that forwards the tailnet name as Host with the same Origin", async () => {
    const { server, session } = await bootSession();
    const tailnet = "bench.tail1234.ts.net";
    const proxied = { host: tailnet, origin: `https://${tailnet}` };
    const page = server.withHeaders(proxied);

    expect(
      await getStatus(server.baseUrl, "/api/state", {
        "tailscale-user-login": "owner@example.com",
        ...proxied,
      }),
    ).toBe(200);
    expect(await page.upgradeStatus("/api/events")).toBe(101);
    const terminal = await page.openTerminal(session.id);
    terminal.run(echoCommand("marker-8e41c7"));
    await terminal.waitForOutput("marker-8e41c7");
  });

  it("still refuses another origin when a proxy forwards the tailnet name as Host", async () => {
    const { server } = await bootSession();
    const proxied = { host: "bench.tail1234.ts.net", origin: "https://evil.example" };
    const page = server.withHeaders(proxied);

    expect(
      await getStatus(server.baseUrl, "/api/state", {
        "tailscale-user-login": "owner@example.com",
        ...proxied,
      }),
    ).toBe(403);
    expect(await page.upgradeStatus("/api/events")).toBe(403);
  });

  it("serves a client that sends no Origin at all", async () => {
    const { server } = await bootSession();

    expect((await server.request("/api/state")).status).toBe(200);
    expect(await server.upgradeStatus("/api/events")).toBe(101);
  });
});

describe("Request bodies", () => {
  it("refuses a JSON body that is not declared as application/json with 415", async () => {
    const { instance, server } = await bootSession();

    const response = await server.request("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ folder: instance.makeFolder("second") }),
    });

    expect(response.status).toBe(415);
    expect((await server.state()).workspaces).toHaveLength(1);
  });
});
