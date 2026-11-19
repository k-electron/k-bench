/**
 * Whether this page is being looked at: it is the foreground tab of a window that is not
 * hidden, and the device is awake. The `viewing` option of the agent connection, which is
 * how a Claude Agent's Bell knows that a Pane showing it counts as viewing it. A background
 * tab does not count, so walking away from the desk leaves the pulse for the phone.
 */
export const pageViewing = {
  visible: () => document.visibilityState === "visible",
  subscribe(onChange: () => void): () => void {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};
