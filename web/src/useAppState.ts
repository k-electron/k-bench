import { useCallback, useEffect, useState } from "react";
import { type AppState, api } from "./api";

/**
 * The Workspaces and Sessions the server reports. Refetched on demand and when the tab
 * regains focus; later tickets replace this with the events WebSocket.
 */
export function useAppState(): {
  state: AppState | undefined;
  refresh: () => Promise<void>;
  /** Shows the new Workspace order at once, then saves it (and re-reads the truth). */
  reorderWorkspaces: (ids: string[]) => Promise<void>;
} {
  const [state, setState] = useState<AppState>();

  const refresh = useCallback(async () => {
    setState(await api.getState());
  }, []);

  const reorderWorkspaces = useCallback(
    async (ids: string[]) => {
      setState(
        (current) =>
          current && {
            ...current,
            workspaces: ids.flatMap(
              (id) => current.workspaces.find((w) => w.id === id) ?? [],
            ),
          },
      );
      try {
        await api.reorderWorkspaces(ids);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { state, refresh, reorderWorkspaces };
}
