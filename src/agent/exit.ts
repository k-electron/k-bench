/**
 * The record of why an Agent Runtime ended, `exit.json` in the Agent's folder. tmux ends a
 * Session's pane, and with it the Session, the moment the runtime exits, so this file is the
 * only place the reason survives. The runtime writes it, with a reason in plain words, on
 * every exit it controls; the launcher fills the gap for one it does not (killed, crashed)
 * with an exit status and no reason.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { agentExitFile } from "./paths.ts";

export interface ExitRecord {
  /** Plain words for the owner. Absent when only the launcher saw the runtime end. */
  reason?: string;
  /** The runtime's exit status, when the launcher recorded it. */
  code?: number;
  /** The signal that ended the runtime, when the launcher could tell. */
  signal?: number | null;
  /** When it ended (ISO 8601). */
  at: string;
}

/** Writes the record whole (through a temporary name, so it is never read half written). */
export function writeExitRecord(folder: string, record: Omit<ExitRecord, "at">): void {
  const file = agentExitFile(folder);
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...record, at: new Date().toISOString() }));
  renameSync(temporary, file);
}

/** The record, or undefined when there is none (the runtime is running, or never ran). */
export function readExitRecord(folder: string): ExitRecord | undefined {
  try {
    return JSON.parse(readFileSync(agentExitFile(folder), "utf8")) as ExitRecord;
  } catch {
    return undefined;
  }
}
