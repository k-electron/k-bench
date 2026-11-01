import { Hono } from "hono";
import { type Service, ServiceError } from "./service.ts";

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The JSON HTTP API. */
export function createApp(service: Service): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ServiceError) {
      const status = error.kind === "not_found" ? 404 : 422;
      return c.json({ error: error.message }, status);
    }
    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/api/state", async (c) => c.json(await service.getState()));

  app.post("/api/workspaces", async (c) => {
    const body = await jsonBody(c.req.raw);
    const folder = optionalString(body.folder);
    if (!folder) throw new ServiceError("invalid", "folder is required");
    const workspace = service.createWorkspace({
      folder,
      name: optionalString(body.name),
    });
    return c.json(workspace, 201);
  });

  app.post("/api/workspaces/:id/sessions", async (c) => {
    const body = await jsonBody(c.req.raw);
    const session = await service.createSession(
      c.req.param("id"),
      optionalString(body.name),
    );
    return c.json(session, 201);
  });

  return app;
}
