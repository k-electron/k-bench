import type { WorkspaceState } from "../../src/shared/state-protocol.ts";

/** Host folder paths for the folder picker. Paths are absolute, with no trailing slash. */

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** `path` is `folder` or inside it. */
export function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder === "/" ? "/" : `${folder}/`);
}

/** The most Workspace-holding folders Places lists. */
const MAX_WORKSPACE_PLACES = 5;

export interface Place {
  kind: "home" | "workspaces" | "computer";
  label: string;
  path: string;
}

/**
 * The picker's Places: Home (the picker root), then the folders that hold Workspaces, most
 * Workspaces first and the most recently used first among equals, then the whole Computer.
 */
export function places(workspaces: WorkspaceState[], root: string): Place[] {
  const parents = new Map<string, { count: number; newest: number }>();
  for (const workspace of workspaces) {
    const parent = dirname(workspace.folder);
    if (parent === root || parent === "/") continue;
    const seen = parents.get(parent) ?? { count: 0, newest: -Infinity };
    parents.set(parent, {
      count: seen.count + 1,
      newest: Math.max(seen.newest, workspace.createdAt),
    });
  }
  const ranked = [...parents.entries()]
    .sort(([, a], [, b]) => b.count - a.count || b.newest - a.newest)
    .slice(0, MAX_WORKSPACE_PLACES)
    .map(([path]): Place => ({ kind: "workspaces", label: basename(path), path }));
  return [
    { kind: "home", label: "Home", path: root },
    ...ranked,
    { kind: "computer", label: "Computer", path: "/" },
  ];
}

export interface Crumb {
  label: string;
  path: string;
}

/**
 * The breadcrumbs for `path`: from Home (shown as `~`) when it is inside the picker root,
 * otherwise from the top of the filesystem (`/`).
 */
export function crumbs(path: string, root: string): Crumb[] {
  const top = isWithin(path, root)
    ? { label: "~", path: root }
    : { label: "/", path: "/" };
  const all: Crumb[] = [top];
  for (const name of path.slice(top.path.length).split("/").filter(Boolean)) {
    const parent = all.at(-1)?.path ?? top.path;
    all.push({ label: name, path: parent === "/" ? `/${name}` : `${parent}/${name}` });
  }
  return all;
}
