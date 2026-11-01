import { useCallback, useEffect, useState } from "react";
import { type AppState, api } from "./api";

/**
 * The Workspaces and Sessions the server reports. Refetched on demand and when the tab
 * regains focus; later tickets replace this with the events WebSocket.
 */
export function useAppState(): {
  state: AppState | undefined;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<AppState>();

  const refresh = useCallback(async () => {
    setState(await api.getState());
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { state, refresh };
}
