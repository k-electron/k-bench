import { cn } from "@/lib/utils";
import type { ToolStatus } from "../../agent/items";

const STATUS_NAME: Record<ToolStatus, string> = {
  running: "Running",
  done: "Done",
  denied: "Denied",
  interrupted: "Interrupted",
  failed: "Failed",
};

/**
 * The `⏺` of a tool call or a task: a spinner while it runs, green when it is done, red when it
 * was denied, interrupted or failed. Named by its state, for people who cannot see the colour.
 */
export function StatusMark({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return (
      <span
        role="img"
        aria-label={STATUS_NAME.running}
        className="mt-[0.3em] inline-block size-[0.8em] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={STATUS_NAME[status]}
      className={cn("shrink-0", status === "done" ? "text-green-400" : "text-red-400")}
    >
      ⏺
    </span>
  );
}
