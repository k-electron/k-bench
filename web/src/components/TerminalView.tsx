import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { applyArmedCtrl, registerTerminal } from "../terminalInput";

/** Close codes the server uses (see `src/server/terminal.ts`). */
const SESSION_DELETED = 4404;
const SESSION_STOPPED = 4410;

/** The terminal WebSocket URL for a Session at a given size. */
function terminalUrl(sessionId: string, cols: number, rows: number): string {
  const url = new URL(`/api/sessions/${sessionId}/terminal`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return url.toString();
}

/**
 * xterm.js attached to one Session over the terminal WebSocket. It fits its container and
 * reports every size change to the server. Output arrives as binary frames; input and
 * resizes go out as JSON (see `src/server/terminal.ts`).
 */
export function TerminalView({
  sessionId,
  focused,
  onEnded,
}: {
  sessionId: string;
  /** Whether this is in the Focused Pane; it takes keyboard focus when it becomes so. */
  focused: boolean;
  /** The server closed the socket because the Session was deleted or is Stopped. */
  onEnded?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const ended = useRef(onEnded);
  ended.current = onEnded;

  useEffect(() => {
    if (focused) terminalRef.current?.focus();
  }, [focused]);

  // The phone's extra keys go to the terminal in the Focused Pane, as if typed.
  useEffect(() => {
    if (!focused) return;
    return registerTerminal((data) => terminalRef.current?.input(data, true));
  }, [focused]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const terminal = new Terminal({
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 0, // tmux keeps the history; the server redraws the screen on attach.
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();

    const socket = new WebSocket(terminalUrl(sessionId, terminal.cols, terminal.rows));
    socket.binaryType = "arraybuffer";
    // Input typed before the socket opens (a freshly opened Session) is kept, not dropped.
    const queued: string[] = [];
    const send = (message: object) => {
      const text = JSON.stringify(message);
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
      else if (socket.readyState === WebSocket.CONNECTING) queued.push(text);
    };
    socket.onopen = () => {
      for (const text of queued.splice(0)) socket.send(text);
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
    };
    socket.onclose = (event) => {
      if (event.code === SESSION_DELETED || event.code === SESSION_STOPPED) {
        ended.current?.();
      }
    };
    const input = terminal.onData((data) =>
      send({ type: "input", data: applyArmedCtrl(data) }),
    );
    const resized = terminal.onResize(({ cols, rows }) =>
      send({ type: "resize", cols, rows }),
    );
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    terminalRef.current = terminal;
    if (focusedRef.current) terminal.focus();

    return () => {
      terminalRef.current = null;
      observer.disconnect();
      input.dispose();
      resized.dispose();
      socket.onclose = null;
      socket.close();
      terminal.dispose();
    };
  }, [sessionId]);

  return <div ref={container} className="h-full w-full" />;
}
