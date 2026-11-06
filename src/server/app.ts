import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { LaunchOptions } from "../shared/launch-options.ts";
import { REVISION_HEADER } from "../shared/state-protocol.ts";
import { parseLaunchOptions } from "./claude.ts";
import { DirectoryError, listDirectories } from "./directories.ts";
import { type Service, ServiceError } from "./service.ts";
import { mountStatic } from "./static.ts";

/**
 * The JSON object in a request body ({} when there is none). A body must be declared
 * `application/json`: a page on another site cannot send that without a preflight the
 * server never grants, so it is a second line behind the Origin check.
 */
async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text === "") return {};
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    throw new HTTPException(415, { message: "Send the body as application/json" });
  }
  try {
    const body = JSON.parse(text);
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
    /**
     * Called after every request that changed something, so open clients hear about it.
     * Returns the state revision from which the change shows; the response carries it in
     * the `State-Revision` header, so the client that made the change can wait for it.
     */
    onMutation?: () => number;
  } = {},
): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
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
    if (c.req.method === "GET" || c.res.status >= 400) return;
    const revision = options.onMutation?.();
    if (revision !== undefined) c.res.headers.set(REVISION_HEADER, String(revision));
  });

  // `k-bench status` asks this. It is behind the access guard like everything else, so the
  // caller must send the owner's login.
  app.get("/api/health", (c) => c.json({ status: "ok" }));

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
    // `claude` makes it a Claude Session; its Launch options are checked before anything starts.
    let launchOptions: LaunchOptions | undefined;
    if (body.claude !== undefined) {
      const parsed = parseLaunchOptions(body.claude);
      if ("error" in parsed) throw new ServiceError("invalid", parsed.error);
      launchOptions = parsed.options;
    }
    const session = await service.createSession(
      c.req.param("id"),
      optionalString(body.name),
      launchOptions,
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

  // Last, so it only answers what the API did not.
  if (options.webDir) mountStatic(app, options.webDir);

  return app;
}
