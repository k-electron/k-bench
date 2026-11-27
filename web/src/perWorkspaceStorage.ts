/** What the browser keeps under `key` for each Workspace, dropping what isn't a `T`. */
export function loadPerWorkspace<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): Record<string, T> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (typeof saved !== "object" || saved === null) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, value]) => isValid(value)),
    );
  } catch {
    // Storage unavailable or garbled: every Workspace starts as a new one does.
    return {};
  }
}

/** Keeps `record` under `key` in the browser's storage. */
export function savePerWorkspace(key: string, record: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage unavailable: it lasts until the page is closed.
  }
}
