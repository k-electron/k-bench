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
  options: {
    webDir?: string;
    pickerRoot?: string;
    /** Called after every request that changed something, so open clients hear about it. */
    onMutation?: () => void;
  } = {},
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

  // Any API call that is not a read and succeeded may have changed the state.
  app.use("/api/*", async (c, next) => {
    await next();
    if (c.req.method !== "GET" && c.res.status < 400) options.onMutation?.();
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

  // Declared before `/:id` routes so "order" is never taken for an id.
  app.put("/api/workspaces/order", async (c) => {
    const { ids } = await jsonBody(c.req.raw);
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new ServiceError("invalid", "ids must be a list of Workspace ids");
    }
    service.reorderWorkspaces(ids);
    return c.json({ ids });
  });

  app.patch("/api/workspaces/:id", async (c) => {
    const body = await jsonBody(c.req.raw);
    const workspace = service.updateWorkspace(c.req.param("id"), {
      name: optionalString(body.name),
      folder: optionalString(body.folder),
    });
    return c.json(workspace);
  });

  app.delete("/api/workspaces/:id", async (c) => {
    await service.deleteWorkspace(c.req.param("id"));
    return c.body(null, 204);
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
  app.post("/api/sessions/:id/restart", async (c) =>
    c.json(await service.restartSession(c.req.param("id"))),
  );

  app.post("/api/sessions/:id/seen", async (c) => {
    await service.markSeen(c.req.param("id"));
    return c.body(null, 204);
  });

  // Last, so it only answers what the API did not.
  if (options.webDir) mountStatic(app, options.webDir);

  return app;
}
