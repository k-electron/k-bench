import { FitAddon } from "@xterm/addon-fit";
import { type IDisposable, type IEvent, Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
  CLOSE_SESSION_ENDED,
  type ClientMessage,
  encodeClientMessage,
  type TerminalSize,
  terminalPath,
} from "../../../src/shared/terminal-protocol.ts";
import { applyArmedCtrl, registerTerminal } from "../terminalInput";

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;

/** The terminal WebSocket URL for a Session at a given size. */
function terminalUrl(sessionId: string, size: TerminalSize): string {
  const url = new URL(terminalPath(sessionId, size), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Calls `listener` with everything the terminal sends, and whether it sent it by itself
 * (answers to tmux's queries) rather than for the owner's key, paste, click or extra key.
 * xterm.js knows which, but says so only internally: its core fires `onUserInput` just
 * before `onData` for the owner's input. Should an xterm.js upgrade move that, everything
 * counts as the owner's (and the phone test of an armed Ctrl through a reconnect fails).
 */
function onTerminalInput(
  terminal: Terminal,
  listener: (data: string, automatic: boolean) => void,
): IDisposable {
  const internals = terminal as unknown as {
    _core?: { coreService?: { onUserInput?: IEvent<void> } };
  };
  const onUserInput = internals._core?.coreService?.onUserInput;
  if (!onUserInput) {
    console.warn("xterm.js no longer reports user input; treating all input as typed");
    return terminal.onData((data) => listener(data, false));
  }
  let fromOwner = false;
  const owner = onUserInput(() => {
    fromOwner = true;
  });
  const sent = terminal.onData((data) => {
    const automatic = !fromOwner;
    fromOwner = false;
    listener(data, automatic);
  });
  return {
    dispose: () => {
      owner.dispose();
      sent.dispose();
    },
  };
}

/** Decodes the payload of an OSC 52 clipboard write (`<targets>;<base64>`), or undefined. */
function clipboardText(data: string): string | undefined {
  const payload = data.slice(data.indexOf(";") + 1);
  if (payload === "?" || payload === "") return undefined; // a read request, or a clear
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * xterm.js only lets shift force a browser selection off the Mac; there it wants option.
 * Shift-drag is the documented fallback, so on a Mac the shift mouse-down is replayed as a
 * forced selection.
 */
function shiftDragSelects(element: HTMLElement): () => void {
  if (!/Mac/.test(navigator.platform)) return () => {};
  const onMouseDown = (event: MouseEvent) => {
    if (!event.shiftKey || event.altKey) return;
    event.stopImmediatePropagation();
    event.preventDefault(); // else the browser moves focus away from the terminal
    event.target?.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        detail: event.detail,
        shiftKey: true,
        altKey: true,
      }),
    );
  };
  element.addEventListener("mousedown", onMouseDown, true);
  return () => element.removeEventListener("mousedown", onMouseDown, true);
}

/** Turns a one-finger swipe into mouse-wheel events, so a phone scrolls tmux's history. */
function swipeScrolls(
  element: HTMLElement,
  target: () => HTMLElement | undefined,
): () => void {
  let lastY: number | undefined;
  const onStart = (event: TouchEvent) => {
    lastY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
  };
  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (lastY === undefined || !touch) return;
    event.preventDefault();
    // Dragging down pulls earlier lines into view, as the wheel does when rolled up.
    target()?.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        deltaY: lastY - touch.clientY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      }),
    );
    lastY = touch.clientY;
  };
  const onEnd = () => {
    lastY = undefined;
  };
  element.addEventListener("touchstart", onStart, { passive: true });
  element.addEventListener("touchmove", onMove, { passive: false });
  element.addEventListener("touchend", onEnd);
  element.addEventListener("touchcancel", onEnd);
  return () => {
    element.removeEventListener("touchstart", onStart);
    element.removeEventListener("touchmove", onMove);
    element.removeEventListener("touchend", onEnd);
    element.removeEventListener("touchcancel", onEnd);
  };
}

/**
 * xterm.js attached to one Session over the terminal WebSocket. It fits its container and
 * reports every size change to the server, speaking `src/shared/terminal-protocol.ts`.
 * When the connection drops it reconnects by itself with backoff, and tmux redraws the
 * screen on every attach.
 */
export function TerminalView({
  sessionId,
  focused,
}: {
  sessionId: string;
  /** Whether this is in the Focused Pane; it takes keyboard focus when it becomes so. */
  focused: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const terminalRef = useRef<Terminal>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  useEffect(() => {
    if (focused) terminalRef.current?.focus();
  }, [focused]);

  // The phone's extra keys go to the terminal in the Focused Pane, as if typed.
  useEffect(() => {
    if (!focused) return;
    return registerTerminal(
      (data) => terminalRef.current?.input(data, true),
      () => terminalRef.current?.blur(),
    );
  }, [focused]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const terminal = new Terminal({
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 0, // tmux keeps the history; the server redraws the screen on attach.
      macOptionClickForcesSelection: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();

    // tmux copies a mouse selection to the clipboard by sending OSC 52 to its terminal.
    const clipboard = terminal.parser.registerOscHandler(52, (data) => {
      const text = clipboardText(data);
      if (text !== undefined) void navigator.clipboard?.writeText(text).catch(() => {});
      return true;
    });
    const stopShiftDrag = shiftDragSelects(element);
    const stopSwipe = swipeScrolls(element, () => terminal.element);

    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;

    // Input typed while a socket is still connecting (a freshly opened Session) is kept,
    // not dropped, and sent once it opens.
    const queued: string[] = [];
    const send = (message: ClientMessage) => {
      const text = encodeClientMessage(message);
      if (socket?.readyState === WebSocket.OPEN) socket.send(text);
      else if (socket?.readyState === WebSocket.CONNECTING) queued.push(text);
    };

    const connect = () => {
      clearTimeout(retry);
      const ws = new WebSocket(
        terminalUrl(sessionId, { cols: terminal.cols, rows: terminal.rows }),
      );
      socket = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        attempts = 0;
        setReconnecting(false);
        terminal.reset(); // tmux is about to redraw the whole screen
        for (const text of queued.splice(0)) ws.send(text);
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
      };
      ws.onclose = (event) => {
        if (disposed || socket !== ws) return;
        // The Session was deleted or its shell exited: the state feed shows which.
        if (event.code === CLOSE_SESSION_ENDED) return;
        setReconnecting(true);
        const delay = Math.min(RETRY_FIRST_MS * 2 ** attempts, RETRY_MAX_MS);
        attempts += 1;
        retry = setTimeout(connect, delay);
      };
    };
    connect();

    // A phone that slept or regained its network should not wait out the backoff.
    const retryNow = () => {
      if (document.visibilityState === "hidden") return;
      if (socket && socket.readyState !== WebSocket.OPEN && !disposed && attempts > 0) {
        if (socket.readyState === WebSocket.CONNECTING) return;
        connect();
      }
    };
    document.addEventListener("visibilitychange", retryNow);
    window.addEventListener("online", retryNow);

    // An armed Ctrl is for the owner's next key, so the terminal's own answers pass it by.
    const input = onTerminalInput(terminal, (data, automatic) =>
      send(
        automatic
          ? { type: "input", data, automatic }
          : { type: "input", data: applyArmedCtrl(data) },
      ),
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
      disposed = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", retryNow);
      window.removeEventListener("online", retryNow);
      observer.disconnect();
      input.dispose();
      resized.dispose();
      clipboard.dispose();
      stopShiftDrag();
      stopSwipe();
      socket?.close();
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full touch-none" />
      {reconnecting && (
        <div
          role="status"
          className="absolute top-2 left-2 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-black"
        >
          reconnecting…
        </div>
      )}
    </div>
  );
}
