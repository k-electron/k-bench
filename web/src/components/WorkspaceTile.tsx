import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { Avatar, AvatarFallback } from "./ui/avatar";

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
 * A Workspace's coloured letter tile, a shadcn `Avatar`, with an amber dot for `marker` (with
 * a pulsing ring for Waiting, solid for a Bell) and a warning mark when it is Missing. The
 * letters are decoration; the dot and the mark are labelled. `sm` sits in an expanded
 * sidebar row, `md` is a tile on its own.
 */
export function WorkspaceTile({
  workspace,
  size = "sm",
  marker = null,
  className,
}: {
  workspace: WorkspaceState;
  size?: "sm" | "md";
  /**
   * The dot for its Sessions (`workspaceMarker`); the sidebar shows it only on a folded
   * Workspace.
   */
  marker?: "waiting" | "bell" | null;
  className?: string;
}) {
  const hue = tileHue(workspace.name);
  const md = size === "md";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar
        aria-hidden="true"
        className={md ? "size-8 rounded-lg" : "size-5 rounded-md"}
      >
        <AvatarFallback
          className={cn(
            "rounded-[inherit] font-semibold tracking-tight",
            md ? "text-xs" : "text-[9px]",
          )}
          style={{
            background: `oklch(0.36 0.07 ${hue})`,
            color: `oklch(0.92 0.06 ${hue})`,
          }}
        >
          {initials(workspace.name)}
        </AvatarFallback>
      </Avatar>
      {marker && (
        <span
          role="img"
          aria-label={
            marker === "waiting"
              ? `${workspace.name} has a session waiting for you`
              : `${workspace.name} has a session that rang the bell`
          }
          className={cn(
            "absolute -top-0.5 -right-0.5 grid place-items-center",
            md ? "size-2.5" : "size-2",
          )}
        >
          {marker === "waiting" && (
            <span className="absolute size-full animate-ping rounded-full bg-status-waiting/70" />
          )}
          <span
            className={cn(
              "relative size-full rounded-full ring-2 ring-sidebar",
              marker === "waiting" ? "bg-status-waiting" : "bg-status-bell",
            )}
          />
        </span>
      )}
      {workspace.missing && (
        <span
          role="img"
          aria-label={`${workspace.name} is Missing`}
          className="absolute -right-1 -bottom-1 rounded-full bg-sidebar text-destructive"
        >
          <TriangleAlertIcon className={md ? "size-3.5" : "size-3"} />
        </span>
      )}
    </span>
  );
}
