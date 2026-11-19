/**
 * The path an Agent Runtime's socket is reached by. A unix socket path may be at most 103
 * characters on macOS (`sun_path` is 104 with its NUL), and a bit under 255 on the newest
 * releases, so `<dataDir>/agents/<id>/agent.sock` is not safe: the data folder can be as
 * long as the owner's login name or `K_BENCH_DATA_DIR` makes it. So the socket is bound, and
 * connected to, through a short link to the Agent's folder:
 *
 *   /tmp/kb-<uid>/<16 hex of the SHA-256 of the folder's path>  ->  <dataDir>/agents/<id>
 *
 * The socket file itself is `agent.sock` in the Agent's real folder, so it is deleted with
 * the Session and survives the link. The OS follows the link, but the length limit applies to
 * the string given to `listen` and `connect`, which is about 40 characters whatever the data
 * folder is. The path is the same every time for an Agent, so a k-bench that restarts finds
 * the runtime that kept running (ADR-0007).
 *
 * `/tmp` is shared, so `/tmp/kb-<uid>` is made `0700` and checked on every use: not a link,
 * a folder, the owner's, closed to everyone else. A folder another user made there first is
 * refused, never used. macOS clears `/tmp` of files not used for three days; a link lost to
 * that does no harm to a live runtime, because the server makes it again before every
 * connection, and the socket is not in `/tmp`.
 *
 * Server side only: the runtime is given the finished path (`--socket-file`).
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

const SOCKET_NAME = "agent.sock";

/** Thrown, in plain words, when the short folder cannot be used safely. */
export class AgentSocketPathError extends Error {}

/** The short, owner-only folder holding every link: `/tmp/kb-<uid>`. Fixed, not `$TMPDIR`, which is long. */
export function agentLinksRoot(): string {
  return join("/tmp", `kb-${process.getuid?.() ?? 0}`);
}

/** The link's name for an Agent folder: a hash, so it is short and tells nothing. */
function linkName(folder: string): string {
  return createHash("sha256").update(resolve(folder)).digest("hex").slice(0, 16);
}

/** Makes `/tmp/kb-<uid>` if it is not there, and throws if it is there but not safe. */
function ensureLinksRoot(): string {
  const root = agentLinksRoot();
  try {
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = lstatSync(root);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
    throw new AgentSocketPathError(
      `${root} exists but is not a folder of yours, so the Agent's socket cannot go there. Remove it and try again`,
    );
  }
  if ((stat.mode & 0o077) !== 0) chmodSync(root, 0o700);
  return root;
}

/**
 * The short path to the Agent's socket, with the link it goes through in place, when the
 * Agent's folder exists (for one that does not, nothing could be listening, and a link
 * would be left behind). Throws `AgentSocketPathError` if `/tmp/kb-<uid>` is not safe.
 */
export function agentSocketFile(folder: string): string {
  const root = ensureLinksRoot();
  const link = join(root, linkName(folder));
  if (isFolder(folder)) makeLink(link, resolve(folder));
  return join(link, SOCKET_NAME);
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Points `link` at `target`, atomically, and not at all when it already does. */
function makeLink(link: string, target: string): void {
  try {
    if (readlinkSync(link) === target) return;
  } catch {
    // Not there, or not a link: made below.
  }
  const temporary = `${link}.${process.pid}`;
  rmSync(temporary, { force: true });
  symlinkSync(target, temporary);
  renameSync(temporary, link);
}

/** Removes the Agent's link, for the Agent's folder being deleted. */
export function removeAgentSocketLink(folder: string): void {
  rmSync(join(agentLinksRoot(), linkName(folder)), { force: true });
}

/**
 * Removes every link whose folder is gone, whichever instance of k-bench made it: left by a
 * folder deleted while the server was down, or by a test's data folder. One removed that
 * was wanted is made again the next time its Agent is used.
 */
export function removeDanglingAgentLinks(): void {
  const root = agentLinksRoot();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    const link = join(root, name);
    try {
      if (lstatSync(link).isSymbolicLink() && !isFolder(link))
        rmSync(link, { force: true });
    } catch {
      // Gone already.
    }
  }
}
