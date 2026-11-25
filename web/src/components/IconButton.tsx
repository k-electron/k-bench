import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small square button holding just an icon, named by `label`. */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: { label: string; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
