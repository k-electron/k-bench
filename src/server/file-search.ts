import { execFile } from "node:child_process";
import { type Dirent, readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** How many files one search returns at most. */
export const MAX_FILE_MATCHES = 30;

/** A folder with more files than this is only searched as far as the walk got (no git). */
const WALK_LIMIT = 50_000;
/** What `git ls-files` may print: a very large repository is cut off rather than buffered. */
const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 5_000;
/** Folders no search of a non-git folder is worth the time in. */
const SKIPPED_FOLDERS = new Set([".git", "node_modules"]);

/**
 * Every file under `folder`, as `/`-separated paths relative to it, that git neither ignores
 * nor lacks: tracked ones and untracked ones that are not ignored. Undefined when `folder` is
 * not in a git repository (or git is not there).
 */
function gitFiles(folder: string): Promise<string[] | undefined> {
  // The owner's own git environment must not point it at another repository.
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]) {
    delete env[name];
  }
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: folder, env, maxBuffer: GIT_OUTPUT_LIMIT, timeout: GIT_TIMEOUT_MS },
      (error, stdout) => {
        if (error) return resolve(undefined);
        resolve(stdout.split("\0").filter((path) => path !== ""));
      },
    );
  });
}

/**
 * The files under `folder` found by walking it, for a folder that is not a git repository.
 * Symbolic links are never followed or listed, so a walk cannot leave the folder.
 */
function walkFiles(folder: string): string[] {
  const found: string[] = [];
  const queue: string[] = [""];
  while (queue.length > 0 && found.length < WALK_LIMIT) {
    const relative = queue.shift() ?? "";
    let entries: Dirent[];
    try {
      entries = readdirSync(join(folder, relative), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (SKIPPED_FOLDERS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        queue.push(path);
      } else if (entry.isFile()) {
        found.push(path);
      }
    }
  }
  return found;
}

/**
 * Whether `path` is a regular file that really lies inside `root` (the folder's real path):
 * not a file git still lists after it was deleted, and not a symbolic link, at the end or on
 * the way, that leads out.
 */
function isInside(root: string, path: string): boolean {
  try {
    const real = realpathSync(join(root, path));
    return real.startsWith(root + sep) && statSync(real).isFile();
  } catch {
    return false;
  }
}

/** Lower is better: the name starts with the query, the name contains it, the path does. */
function rank(path: string, query: string): number {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return path.toLowerCase().includes(query) ? 2 : 3;
}

const depth = (path: string) => path.split("/").length;

/**
 * Files in `folder` for the `@` picker: those whose path contains `query` (any case), best
 * first (a name that starts with it, then a name that contains it, then the path), shallower
 * and shorter before deeper and longer, at most `MAX_FILE_MATCHES`. Nothing typed lists the
 * shallowest files. Files git ignores are left out; in a folder that is not a git repository
 * everything but `.git` and `node_modules` is searched.
 *
 * The query only ever matches against the names found under `folder`; it is never joined to a
 * path, so it cannot reach anything else, and every result is checked to lie inside the
 * folder after links are resolved.
 */
export async function searchFiles(folder: string, query: string): Promise<string[]> {
  let root: string;
  try {
    root = realpathSync(folder);
  } catch {
    return [];
  }
  const files = (await gitFiles(root)) ?? walkFiles(root);
  const wanted = query.toLowerCase();
  const ranked = files
    .map((path) => ({ path, rank: rank(path, wanted) }))
    .filter((entry) => entry.rank < 3)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        depth(a.path) - depth(b.path) ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path, "en"),
    );
  const result: string[] = [];
  for (const { path } of ranked) {
    if (result.length >= MAX_FILE_MATCHES) break;
    if (isInside(root, path)) result.push(path);
  }
  return result;
}
