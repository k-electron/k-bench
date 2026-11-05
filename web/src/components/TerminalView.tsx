import { FitAddon } from "@xterm/addon-fit";
import { type IDisposable, type IEvent, Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { createTerminalConnection } from "../terminalConnection";
import { applyArmedCtrl, registerTerminal } from "../terminalInput";
import { touchScrolls } from "../touchScroll";
import { wheelReports } from "../wheelReports";

/** The terminal WebSocket URL for a path from `terminalPath`. */
function terminalUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Calls `retry` when a phone that slept or regained its network should not wait out the
 * backoff: the page became visible, or the browser went online.
 */
function retryWhenAwake(retry: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState !== "hidden") retry();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", retry);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", retry);
  };
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

/**
 * xterm.js attached to one Session through a `TerminalConnection`, which owns the WebSocket
 * and reconnects by itself with backoff. This fits the terminal to its container, plugs its
 * input and size into the connection, writes the output, and shows "reconnecting…".
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
    const reports = wheelReports(terminal);
    const stopTouchScroll = touchScrolls(element, reports);

    const connection = createTerminalConnection({
      sessionId,
      size: { cols: terminal.cols, rows: terminal.rows },
      openSocket: (path) => new WebSocket(terminalUrl(path)),
      wake: retryWhenAwake,
    });
    const subscription = connection.subscribe({
      output: (bytes) => terminal.write(bytes),
      reconnecting: (on) => {
        setReconnecting(on);
        if (!on) terminal.reset(); // tmux is about to redraw the whole screen
      },
    });

    // An armed Ctrl is for the owner's next key, so the terminal's own answers pass it by.
    const input = onTerminalInput(terminal, (data, automatic) =>
      connection.input(automatic ? data : applyArmedCtrl(data), automatic),
    );
    const resized = terminal.onResize(({ cols, rows }) => connection.resize(cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    terminalRef.current = terminal;
    if (focusedRef.current) terminal.focus();

    return () => {
      terminalRef.current = null;
      observer.disconnect();
      input.dispose();
      resized.dispose();
      clipboard.dispose();
      stopShiftDrag();
      stopTouchScroll();
      reports.dispose();
      subscription();
      connection.close();
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full touch-none" />
      {reconnecting && (
        // Top-left: the phone's compact keys sit in the top-right while the keyboard is up.
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
