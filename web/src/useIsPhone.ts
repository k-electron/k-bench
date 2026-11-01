import { useSyncExternalStore } from "react";

/** The one breakpoint between the desktop and phone layouts. */
const PHONE = "(max-width: 767px)";

/** Whether the viewport is phone-sized (single Pane, drawer sidebar, extra keys). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(PHONE);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(PHONE).matches,
  );
}
