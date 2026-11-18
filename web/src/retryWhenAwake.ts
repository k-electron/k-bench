/**
 * Calls `retry` when a phone that slept or regained its network should not wait out the
 * backoff: the page became visible, or the browser went online. The `wake` option of the
 * terminal and agent connections.
 */
export function retryWhenAwake(retry: () => void): () => void {
  const retryIfVisible = () => {
    if (document.visibilityState !== "hidden") retry();
  };
  document.addEventListener("visibilitychange", retryIfVisible);
  window.addEventListener("online", retryIfVisible);
  return () => {
    document.removeEventListener("visibilitychange", retryIfVisible);
    window.removeEventListener("online", retryIfVisible);
  };
}
