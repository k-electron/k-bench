import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";

/**
 * A Workspace's monogram: the first letter of each of its first two words, or the first
 * two letters of a one-word name.
 */
export function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const [first = "", second] = words;
  if (second === undefined) return first.slice(0, 2).toUpperCase() || "?";
  return ((first[0] ?? "") + (second[0] ?? "")).toUpperCase();
}

/** The hue of a Workspace's tile, worked out from its name so it needs no setting. */
export function tileHue(name: string): number {
  let hue = 0;
  for (const c of name) hue = (hue * 31 + (c.codePointAt(0) ?? 0)) % 360;
  return hue;
}

/**
 * A Workspace's coloured letter tile, with an amber dot when `bell` and a warning mark
 * when it is Missing. The letters are decoration; the dot and the mark are labelled.
 * `sm` sits in an expanded sidebar row, `md` is a tile on its own.
 */
export function WorkspaceTile({
  workspace,
  size = "sm",
  bell = false,
  className,
}: {
  workspace: WorkspaceState;
  size?: "sm" | "md";
  /** Show the Bell dot (the sidebar shows it only on a folded Workspace). */
  bell?: boolean;
  className?: string;
}) {
  const hue = tileHue(workspace.name);
  const md = size === "md";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "grid place-items-center font-semibold tracking-tight",
          md ? "size-9 rounded-lg text-sm" : "size-5 rounded text-[10px]",
        )}
        style={{
          background: `oklch(0.42 0.09 ${hue})`,
          color: `oklch(0.95 0.04 ${hue})`,
        }}
      >
        {initials(workspace.name)}
      </span>
      {bell && (
        <span
          role="img"
          aria-label={`${workspace.name} has a session that rang the bell`}
          className={cn(
            "absolute -top-0.5 -right-0.5 rounded-full bg-amber-400 ring-2 ring-card",
            md ? "size-2.5" : "size-2",
          )}
        />
      )}
      {workspace.missing && (
        <span
          role="img"
          aria-label={`${workspace.name} is Missing`}
          className="absolute -right-1 -bottom-1 rounded-full bg-card text-destructive"
        >
          <TriangleAlertIcon className={md ? "size-3.5" : "size-3"} />
        </span>
      )}
    </span>
  );
}
