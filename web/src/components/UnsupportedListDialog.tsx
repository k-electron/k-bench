import { useCallback, useEffect, useState } from "react";
import type { State } from "../../../src/shared/state-protocol.ts";
import { api, type UnsupportedListEntry } from "../api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/**
 * The running list of unsupported kinds (#154): everything k-bench has seen a Claude Agent meet
 * that it can't show or answer, across every Session, with how often and where it last
 * happened. It is the owner's signal for where the product should grow. The server keeps it,
 * so it is the same on every device; this reads it when opened and again when the tab regains
 * focus.
 */
export function UnsupportedListDialog({
  state,
  onOpenSession,
  onClose,
}: {
  state: State | undefined;
  /** Opens a Session (and closes this dialog). */
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<UnsupportedListEntry[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api.unsupportedList().then(
      (list) => {
        setEntries(list);
        setError(undefined);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const clear = async (kind: string) => {
    try {
      await api.clearUnsupported(kind);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sessions = new Map(
    (state?.workspaces ?? []).flatMap((workspace) =>
      workspace.sessions.map((session) => [session.id, session.name] as const),
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Unsupported</DialogTitle>
          <DialogDescription>
            What a Claude Agent has met that k-bench can't show or answer, in any Session.
            Clear one once you've dealt with it; it comes back if it happens again.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {entries?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing unsupported yet.</p>
        )}
        {entries && entries.length > 0 && (
          <ul
            aria-label="Unsupported kinds"
            className="grid max-h-[60vh] gap-2 overflow-y-auto"
          >
            {entries.map((entry) => {
              const sessionName = sessions.get(entry.sessionId);
              return (
                <li
                  key={entry.kind}
                  className="flex items-center gap-3 rounded border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm break-all">{entry.kind}</p>
                    <p className="text-xs text-muted-foreground">
                      <span>
                        {entry.count} {entry.count === 1 ? "time" : "times"}
                      </span>
                      {" · last "}
                      <time dateTime={new Date(entry.lastAt).toISOString()}>
                        {new Date(entry.lastAt).toLocaleString()}
                      </time>
                      {" · "}
                      {sessionName === undefined ? (
                        <span>Session deleted</span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Open ${sessionName}`}
                          className="underline hover:text-foreground"
                          onClick={() => onOpenSession(entry.sessionId)}
                        >
                          {sessionName}
                        </button>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Clear ${entry.kind}`}
                    onClick={() => void clear(entry.kind)}
                  >
                    Clear
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
