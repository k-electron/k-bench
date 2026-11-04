import { useEffect, useState } from "react";

/** How much the visible height must drop (width unchanged) to count as the keyboard. */
const KEYBOARD_MIN_DROP = 100;

/** What the owner can see of the page: the visual viewport where there is one. */
function visible() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    top: viewport?.offsetTop ?? 0,
  };
}

/** Whether keyboard focus is in a terminal (xterm.js types through a hidden textarea). */
function terminalFocused(): boolean {
  return document.activeElement?.closest(".xterm") != null;
}

/**
 * Whether the phone's on-screen keyboard is up: a terminal is focused and the visible
 * height has dropped while the width stayed the same (a rotation changes the width, so it
 * is not mistaken for the keyboard). It is the same test on Android, which shrinks the page
 * for the keyboard, and on iPhone, where WebKit lays the keyboard over the page and only the
 * visual viewport shrinks. A hardware keyboard opens nothing, so nothing drops.
 *
 * While it is up, `--app-top` and `--app-height` on the root element hold the visible area
 * the app should fit (iOS also scrolls the page up to reveal the focused field).
 */
export function useKeyboardUp(enabled: boolean): boolean {
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let baseline = visible();

    const update = () => {
      const now = visible();
      const focused = terminalFocused();
      // The size the page has without a keyboard: followed while no terminal is focused
      // (so it is the size from just before the keyboard opens), and across rotations.
      if (!focused || now.width !== baseline.width) baseline = now;
      else if (now.height > baseline.height)
        baseline = { ...baseline, height: now.height };
      const keyboard = focused && baseline.height - now.height >= KEYBOARD_MIN_DROP;
      setUp(keyboard);
      if (keyboard) {
        root.style.setProperty("--app-top", `${now.top}px`);
        root.style.setProperty("--app-height", `${now.height}px`);
      } else {
        root.style.removeProperty("--app-top");
        root.style.removeProperty("--app-height");
      }
    };

    update();
    const viewport = window.visualViewport;
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.style.removeProperty("--app-top");
      root.style.removeProperty("--app-height");
      setUp(false);
    };
  }, [enabled]);

  return up;
}
