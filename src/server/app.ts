import { Hono } from "hono";
import { DirectoryError, listDirectories } from "./directories.ts";
import { type Service, ServiceError } from "./service.ts";
import { mountStatic } from "./static.ts";

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
export function createApp(
  service: Service,
  options: { webDir?: string; pickerRoot?: string } = {},
): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ServiceError) {
      const status =
        error.kind === "not_found" ? 404 : error.kind === "conflict" ? 409 : 422;
      return c.json({ error: error.message }, status);
    }
    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/api/state", async (c) => c.json(await service.getState()));

  // The folder picker. Defaults to the configured root.
  app.get("/api/directories", (c) => {
    const path = c.req.query("path") || options.pickerRoot;
    if (!path) throw new ServiceError("invalid", "path is required");
    try {
      return c.json(listDirectories(path));
    } catch (error) {
      if (error instanceof DirectoryError) {
        throw new ServiceError("invalid", error.message);
      }
      throw error;
    }
  });

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

  app.patch("/api/sessions/:id", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(
      service.renameSession(c.req.param("id"), optionalString(body.name) ?? ""),
    );
  });

  app.delete("/api/sessions/:id", async (c) => {
    await service.deleteSession(c.req.param("id"));
    return c.body(null, 204);
  });

  // Last, so it only answers what the API did not.
  if (options.webDir) mountStatic(app, options.webDir);

  return app;
}
