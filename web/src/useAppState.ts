import { useCallback, useEffect, useRef, useState } from "react";
import { type AppState, api } from "./api";

/** The events WebSocket URL: the server pushes a full state snapshot on every change. */
function eventsUrl(): string {
  const url = new URL("/api/events", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const MAX_BACKOFF_MS = 10_000;

/**
 * The Workspaces and Sessions the server reports, kept live by the events WebSocket: every
 * change from any device arrives as a snapshot. The socket reconnects by itself with backoff,
 * and each (re)connection also refetches over HTTP, as does a tab regaining focus, so a
 * missed update is repaired. `refresh()` fetches on demand.
 */
export function useAppState(): {
  state: AppState | undefined;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<AppState>();
  // Bumped by every snapshot, so a slower HTTP fetch never overwrites a fresher snapshot.
  const snapshots = useRef(0);

  const refresh = useCallback(async () => {
    const seen = snapshots.current;
    const fetched = await api.getState();
    if (snapshots.current === seen) setState(fetched);
  }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        delay = 500;
        void refresh().catch(() => undefined);
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        snapshots.current++;
        setState(JSON.parse(event.data) as AppState);
      };
      socket.onclose = () => {
        if (disposed) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      };
    };
    connect();

    void refresh().catch(() => undefined);
    const onFocus = () => void refresh().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      clearTimeout(retry);
      window.removeEventListener("focus", onFocus);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [refresh]);

  return { state, refresh };
}
