import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the built front end from `webDir`. Any GET that is not the API and does not name a
 * file falls back to `index.html`, so the single-page app owns every other URL.
 */
export function mountStatic(app: Hono, webDir: string): void {
  const root = resolve(webDir);
  app.get("*", async (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    if (pathname.startsWith("/api/")) return c.notFound();
    const requested = resolve(join(root, normalize(pathname)));
    const insideRoot = requested === root || requested.startsWith(root + sep);
    const hasExtension = extname(pathname) !== "";
    const file = insideRoot && (await isFile(requested)) ? requested : undefined;
    if (!file && hasExtension) return c.notFound();
    const path = file ?? join(root, "index.html");
    if (!(await isFile(path))) return c.notFound();
    const type = getMimeType(path) ?? "application/octet-stream";
    return c.body(await readFile(path), 200, {
      "content-type": type,
      // Built assets are content-hashed; the HTML shell must always be revalidated.
      "cache-control": file?.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
  });
}
