import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";

describe("serving the built front end", () => {
  function buildFolder(): string {
    const dir = createTestInstance().makeFolder("web");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
    writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log('app')");
    return dir;
  }

  it("serves the page, its assets, and the page again for client-side URLs", async () => {
    const instance = createTestInstance();
    const server = await instance.start({ webDir: buildFolder() });

    const page = await server.request("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("<title>shell</title>");

    const script = await server.request("/assets/app-abc123.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(await script.text()).toBe("console.log('app')");

    const deepLink = await server.request("/some/client/route");
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain("<title>shell</title>");
  });

  it("answers a missing asset or API path with 404, never the page", async () => {
    const server = await createTestInstance().start({ webDir: buildFolder() });

    expect((await server.request("/assets/missing.js")).status).toBe(404);
    expect((await server.request("/api/nope")).status).toBe(404);
  });

  it("does not serve files outside the build folder", async () => {
    const server = await createTestInstance().start({ webDir: buildFolder() });

    const response = await server.request("/..%2f..%2fdata%2fk-bench.db");
    expect(await response.text()).not.toContain("SQLite");
    expect(response.status).toBe(404);
  });
});
