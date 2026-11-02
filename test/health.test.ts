import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";

// The health check `k-bench status` asks the running server (docs/internals/packaging.md).
describe("Health check", () => {
  it("answers ok to the owner, and is as guarded as the rest of the API", async () => {
    const server = await createTestInstance().start();

    const owner = await server.request("/api/health");
    expect(owner.status).toBe(200);
    expect(await owner.json()).toEqual({ status: "ok" });

    expect((await server.anonymous().request("/api/health")).status).toBe(403);
    expect((await server.as("stranger@example.com").request("/api/health")).status).toBe(
      403,
    );
  });
});
