/**
 * The terminal WebSocket's wire protocol, the one definition the server, the browser and
 * the test client all use. One socket per open Pane:
 * `GET /api/sessions/:id/terminal?cols=&rows=` opens it at the client's size.
 *
 * Server to client: binary frames of terminal output.
 * Client to server: JSON text frames, one `ClientMessage` each.
 * The server closes with `CLOSE_SESSION_ENDED` when reconnecting is pointless.
 *
 * Imported by the browser too, so this file has no imports and no Node APIs.
 */

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** What opening a terminal asks for: which Session, at what size. */
export interface TerminalRequest {
  sessionId: string;
  size: TerminalSize;
}

export type ClientMessage =
  /**
   * Input for the Session's shell. `automatic` marks input the terminal sent by itself
   * (answers to tmux's queries), not because the owner typed: it never takes the window's
   * size for its device.
   */
  | { type: "input"; data: string; automatic?: boolean }
  /** The client's terminal changed size. */
  | { type: "resize"; cols: number; rows: number };

/**
 * The terminal's Session was deleted, or its shell exited: reconnecting is pointless.
 * What the owner sees about why comes from the state feed, not from this code.
 */
export const CLOSE_SESSION_ENDED = 4410;
/** The server could not attach the terminal. The client may try again. */
export const CLOSE_INTERNAL_ERROR = 1011;

const TERMINAL_PATH = /^\/api\/sessions\/([^/]+)\/terminal$/;

/** The path and query that open a Session's terminal at `size`. */
export function terminalPath(sessionId: string, size: TerminalSize): string {
  const query = new URLSearchParams({ cols: String(size.cols), rows: String(size.rows) });
  return `/api/sessions/${sessionId}/terminal?${query}`;
}

/**
 * The Session and size a request URL (path and query) opens a terminal on, or undefined
 * when it is not a terminal URL. A size that is missing or not a number comes back as NaN,
 * for the server to replace.
 */
export function parseTerminalPath(url: string): TerminalRequest | undefined {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  const sessionId = TERMINAL_PATH.exec(pathname)?.[1];
  if (sessionId === undefined) return undefined;
  return {
    sessionId,
    size: {
      cols: Number(searchParams.get("cols")),
      rows: Number(searchParams.get("rows")),
    },
  };
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/**
 * The message a client's text frame holds, or undefined when it is not one. Sizes are
 * passed on unchecked: the server ignores one that is not valid.
 */
export function decodeClientMessage(text: string): ClientMessage | undefined {
  let message: { type?: unknown; data?: unknown; automatic?: unknown } & Record<
    string,
    unknown
  >;
  try {
    message = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof message !== "object" || message === null) return undefined;
  if (message.type === "input" && typeof message.data === "string") {
    return { type: "input", data: message.data, automatic: message.automatic === true };
  }
  if (message.type === "resize") {
    return { type: "resize", cols: message.cols as number, rows: message.rows as number };
  }
  return undefined;
}
