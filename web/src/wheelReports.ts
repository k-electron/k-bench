import type { Terminal } from "@xterm/xterm";

/**
 * How many lines tmux used to scroll History per wheel report, and how many reports a
 * desktop wheel step now sends, so desktop scrolling feels as it always has.
 */
const REPORTS_PER_WHEEL_STEP = 5;

/** Below this many pixels a wheel event is likely a trackpad's, as xterm.js judges it. */
const TRACKPAD_DELTA_PX = 50;
const TRACKPAD_DAMPING = 0.3;

export interface WheelReports {
  /**
   * Sends one wheel report per line: positive scrolls down towards the live screen,
   * negative up into History, as a wheel's `deltaY` does.
   */
  scroll(lines: number): void;
  /** The height in CSS pixels of one line, which is what one report scrolls History by. */
  lineHeight(): number;
  dispose(): void;
}

/**
 * Turns line counts into mouse-wheel reports to the Session. tmux scrolls History one line
 * per report (`serverConfiguration` in `src/server/tmux.ts` binds it so); this is the only
 * place in the web app that relies on that. A full-screen program that reads the wheel
 * itself picks its own step per report.
 *
 * Each line goes through xterm.js as a synthetic one-line wheel event, so xterm.js keeps
 * owning the mouse encoding. xterm.js sends at most one report per wheel event, so a real
 * wheel step (mouse or trackpad) is taken over here and sent as several.
 */
export function wheelReports(terminal: Terminal): WheelReports {
  let sending = false;
  let partialLines = 0;

  const lineHeight = () => {
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const height = (screen?.clientHeight ?? 0) / terminal.rows;
    return height > 0 ? height : 1;
  };

  const scroll = (lines: number) => {
    const element = terminal.element;
    if (!element || lines === 0) return;
    const rect = element.getBoundingClientRect();
    const init: WheelEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: Math.sign(lines),
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    };
    sending = true;
    try {
      for (let i = 0; i < Math.abs(lines); i++) {
        element.dispatchEvent(new WheelEvent("wheel", init));
      }
    } finally {
      sending = false;
    }
  };

  /**
   * Whether xterm.js would have sent a report for this real wheel event, and which way:
   * the same sum it does, carrying part-lines between events so a trackpad's small
   * deltas add up.
   */
  const stepOf = (event: WheelEvent): number => {
    const { fastScrollSensitivity = 5, scrollSensitivity = 1 } = terminal.options;
    const modifier = event.altKey || event.ctrlKey ? fastScrollSensitivity : 1;
    let amount = event.deltaY * modifier * scrollSensitivity;
    if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return Math.sign(amount);
    amount /= lineHeight();
    if (Math.abs(event.deltaY) < TRACKPAD_DELTA_PX) amount *= TRACKPAD_DAMPING;
    partialLines += amount;
    const whole = Math.trunc(partialLines);
    partialLines -= whole;
    return Math.sign(whole);
  };

  terminal.attachCustomWheelEventHandler((event) => {
    if (sending || event.shiftKey || event.deltaY === 0) return true;
    scroll(stepOf(event) * REPORTS_PER_WHEEL_STEP);
    event.preventDefault();
    return false;
  });

  return {
    scroll,
    lineHeight,
    dispose: () => terminal.attachCustomWheelEventHandler(() => true),
  };
}
