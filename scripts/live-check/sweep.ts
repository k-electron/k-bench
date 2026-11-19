// Finding what a run left working in its throwaway folder, by where it works.
import { execFileSync } from "node:child_process";

/** The processes that have the throwaway folder (or the run's temp folder) as their working folder: what the run left running, found by where it worked. */
export function processesIn(folder: string): number[] {
  try {
    const out = execFileSync("lsof", ["-a", "-d", "cwd", "-Fpn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    const found: number[] = [];
    let pid = 0;
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (
        line.startsWith("n") &&
        (line.slice(1) === folder || line.slice(1).startsWith(`${folder}/`))
      ) {
        if (pid !== process.pid) found.push(pid);
      }
    }
    return found;
  } catch {
    return [];
  }
}
