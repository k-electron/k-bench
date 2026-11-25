import { useState } from "react";

/** Where the browser keeps whether the sidebar is collapsed, which stays on this device. */
const KEY = "k-bench.sidebar-collapsed";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // Storage unavailable: the sidebar starts expanded.
    return false;
  }
}

function save(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(KEY, "true");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the choice lasts until the page is closed.
  }
}

/**
 * Whether the desktop sidebar is collapsed to a column of tiles, remembered per device so
 * each screen keeps its own choice. It starts expanded.
 */
export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(load);
  return [
    collapsed,
    (value) => {
      setCollapsed(value);
      save(value);
    },
  ];
}
