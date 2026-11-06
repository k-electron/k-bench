import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native single choice, styled like `Input`. Native on purpose: a phone opens its own
 * picker for it, which is easier to use than a custom list.
 */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
