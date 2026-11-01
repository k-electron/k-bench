import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface DirectoryListing {
  /** The folder listed. */
  path: string;
  /** Its parent folder, absent at the top of the filesystem. */
  parent?: string;
  /** Its subfolders by name, hidden ones left out. */
  directories: Array<{ name: string; path: string }>;
}

/** A path that cannot be listed: not absolute, missing, or not a folder. */
export class DirectoryError extends Error {}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The subfolders of `path`, for the folder picker. Symlinks to folders count as folders. */
export function listDirectories(path: string): DirectoryListing {
  if (!isAbsolute(path)) throw new DirectoryError(`Path must be absolute: ${path}`);
  const folder = resolve(path);
  if (!isDirectory(folder)) throw new DirectoryError(`Folder does not exist: ${folder}`);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    throw new DirectoryError(`Cannot read folder: ${folder}`);
  }
  const directories = names
    .filter((name) => !name.startsWith(".") && isDirectory(join(folder, name)))
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map((name) => ({ name, path: join(folder, name) }));
  const parent = dirname(folder);
  return { path: folder, ...(parent === folder ? {} : { parent }), directories };
}
