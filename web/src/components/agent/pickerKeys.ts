import type { KeyboardEvent } from "react";

/**
 * What the keys do while a `PickerMenu` is open, shared by the `/` menu and the `@` picker:
 * Up and Down move the active row (round the ends), Tab and Enter pick it, Escape dismisses
 * the menu. Returns whether it took the key, and then has `preventDefault`ed it, so the input
 * never also steps through history, sends, or interrupts. Keys with a modifier are not its.
 */
export function handlePickerKey(
  event: KeyboardEvent,
  menu: {
    count: number;
    active: number;
    /** Enter picks only when this says so (the `/` menu lets Enter send a name typed in full). */
    enterPicks?: boolean;
    move: (to: number) => void;
    pick: () => void;
    dismiss: () => void;
  },
): boolean {
  if (menu.count === 0) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const move = (to: number) => {
    event.preventDefault();
    menu.move((to + menu.count) % menu.count);
  };
  if (event.key === "ArrowDown") move(menu.active + 1);
  else if (event.key === "ArrowUp") move(menu.active - 1);
  else if (event.key === "Tab" || (event.key === "Enter" && menu.enterPicks !== false)) {
    event.preventDefault();
    menu.pick();
  } else if (event.key === "Escape") {
    event.preventDefault();
    menu.dismiss();
  } else return false;
  return true;
}
