/**
 * A Radix `onCloseAutoFocus` handler: hand focus back to the trigger only if nothing else
 * has taken it. A menu or dialog animates out before it hands focus back, and by then the
 * action it ran may have focused something on purpose, such as a restarted Session's terminal.
 */
export function returnFocusUnlessTaken(event: Event): void {
  const active = document.activeElement;
  if (active && active !== document.body) event.preventDefault();
}
