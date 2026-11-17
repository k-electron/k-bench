/**
 * PROTOTYPE, throwaway. Never merged: lives only on the `prototype/agent-conversation` branch.
 *
 * Three structurally different takes on a Claude Agent conversation, shown inside a real
 * Pane in place of the terminal whenever the URL has `?agent=A|B|C`. The floating bar
 * switches variant (also ← / →), replays the scripted conversation, and toggles Stopped.
 * Nothing here talks to the server; the conversation is canned.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useDemoConversation } from "./useDemoConversation";
import { VariantThread } from "./VariantThread";
import { VariantTranscript } from "./VariantTranscript";
import { VariantTurns } from "./VariantTurns";

const VARIANTS = [
  { key: "A", name: "Thread", Component: VariantThread },
  { key: "B", name: "Transcript", Component: VariantTranscript },
  { key: "C", name: "Turns", Component: VariantTurns },
] as const;

const CHANGED = "agent-prototype-changed";

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return `${params.get("agent") ?? ""}|${params.get("stopped") ?? ""}`;
}

function setParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(CHANGED));
}

/** The variant key when the prototype is switched on by `?agent=`, else null. */
export function useAgentPrototype(): { variant: string | null; stopped: boolean } {
  const snapshot = useSyncExternalStore((listener) => {
    window.addEventListener(CHANGED, listener);
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener(CHANGED, listener);
      window.removeEventListener("popstate", listener);
    };
  }, readParams);
  const [variant, stopped] = snapshot.split("|");
  return { variant: variant || null, stopped: stopped === "1" };
}

export function AgentPrototype({ focused }: { focused: boolean }) {
  const { variant, stopped } = useAgentPrototype();
  const demo = useDemoConversation();
  const index = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === variant?.toUpperCase()),
  );
  const current = VARIANTS[index] ?? VARIANTS[0];
  const go = (step: number) =>
    setParam(
      "agent",
      VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]?.key ?? "A",
    );

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="relative h-full min-h-0">
      <current.Component
        demo={demo}
        stopped={stopped}
        stopReason="claude exited with code 1 (API Error: 529 Overloaded)"
        onRestart={() => {
          setParam("stopped", null);
          demo.replay();
        }}
      />
      {focused && (
        <div className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-1.5 py-1 text-xs font-medium text-white shadow-lg ring-2 ring-black/40">
          <button
            type="button"
            onClick={() => go(-1)}
            className="rounded-full px-2 py-0.5 hover:bg-white/20"
            aria-label="Previous variant"
          >
            ‹
          </button>
          <span className="px-1 whitespace-nowrap">
            {current.key} ({current.name})
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            className="rounded-full px-2 py-0.5 hover:bg-white/20"
            aria-label="Next variant"
          >
            ›
          </button>
          <span className="mx-1 h-4 w-px bg-white/30" />
          <button
            type="button"
            onClick={demo.replay}
            className="rounded-full px-2 py-0.5 hover:bg-white/20"
          >
            ↻ Replay
          </button>
          <button
            type="button"
            onClick={() => setParam("stopped", stopped ? null : "1")}
            className="rounded-full px-2 py-0.5 hover:bg-white/20"
            aria-pressed={stopped}
          >
            {stopped ? "■ Stopped" : "▶ Running"}
          </button>
        </div>
      )}
    </div>
  );
}
