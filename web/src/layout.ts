import { useState } from "react";

const KEY = "k-bench.openSession";

function read(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which Session the Pane shows, remembered on this device so a reload reopens it.
 * The Pane layout ticket grows this into the full per-device layout.
 */
export function useOpenSession(): [string | undefined, (id: string | undefined) => void] {
  const [id, setId] = useState<string | undefined>(read);
  const set = (next: string | undefined) => {
    setId(next);
    try {
      if (next) localStorage.setItem(KEY, next);
      else localStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: the choice just doesn't survive a reload.
    }
  };
  return [id, set];
}
