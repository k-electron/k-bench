import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/useIsPhone";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * An icon-only ghost `Button`, named by `label`, which a `Tooltip` shows on desktop. The
 * Phone layout has no tooltip: there is no hover, and one opened by focus only gets in the way.
 */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: { label: string; children: ReactNode } & ComponentProps<typeof Button>) {
  const phone = useIsPhone();
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={cn("size-7 text-muted-foreground hover:text-foreground", className)}
      {...rest}
      onFocus={(event) => {
        rest.onFocus?.(event);
        // Only keyboard focus opens the tooltip. A dialog or menu handing focus back after a
        // click would otherwise leave it open over the buttons below.
        if (!event.currentTarget.matches(":focus-visible")) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
  if (phone) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
