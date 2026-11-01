import { BellIcon } from "lucide-react";

/** The mark for a Bell: a Session (or a collapsed Workspace's Session) wants attention. */
export function BellBadge({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} className="shrink-0 text-amber-500" title={label}>
      <BellIcon className="size-4 fill-current" />
    </span>
  );
}
