import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import type { ITheme } from "@xterm/xterm";

/**
 * The terminal's one fixed look (ADR-0009): the Graphite colours and JetBrains Mono at 13px,
 * with the line height, letter spacing, cursor and Pane padding left as xterm.js has them,
 * and a contrast floor that brightens any text too close to its background.
 * `TerminalView` and `Pane` both read it, so the colours live in one place. The font is
 * bundled (`@fontsource`), never fetched from a CDN: k-bench is tailnet-only.
 */

/** The terminal's background; the Pane uses it too, so no seam shows around the terminal. */
export const TERMINAL_BACKGROUND = "#161616";

export const terminalTheme: ITheme = {
  background: TERMINAL_BACKGROUND,
  foreground: "#e4e4e4",
  cursor: "#e4e4e4",
  cursorAccent: TERMINAL_BACKGROUND,
  selectionBackground: "#3a3a3a",
  black: "#2a2a2a",
  red: "#ff6369",
  green: "#62c073",
  yellow: "#f3c15f",
  blue: "#52a8ff",
  magenta: "#bf7af0",
  cyan: "#4fc3c7",
  white: "#d0d0d0",
  brightBlack: "#6b6b6b",
  brightRed: "#ff8a8e",
  brightGreen: "#85d897",
  brightYellow: "#ffd88a",
  brightBlue: "#7cbcff",
  brightMagenta: "#d29ff6",
  brightCyan: "#7ad9dc",
  brightWhite: "#ffffff",
};

/** 13px keeps a phone's 32 rows and gains columns; 14px would cost two rows. */
export const TERMINAL_FONT_SIZE = 13;
const TERMINAL_FONT_NAME = '"JetBrains Mono"';
export const TERMINAL_FONT_FAMILY = `${TERMINAL_FONT_NAME}, ui-monospace, Menlo, monospace`;

/**
 * xterm.js brightens text that is too close to its background until it reaches this ratio
 * (WCAG AA), so no program can draw near-invisible text, such as Claude Code's light theme.
 * Colours already readable are drawn as they are; the palette's bright black gets a little lighter.
 */
export const TERMINAL_MINIMUM_CONTRAST_RATIO = 4.5;

/**
 * Resolves once the regular and bold faces have loaded. xterm.js measures its cells once,
 * when it opens, so a terminal opens only after this. A face that fails to load must not
 * keep the terminal from opening: it then measures the fallback font.
 */
export async function terminalFontLoaded(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 ${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_NAME}`),
      document.fonts.load(`700 ${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_NAME}`),
    ]);
  } catch {
    // Carry on with the fallback font.
  }
}
