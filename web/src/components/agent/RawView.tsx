import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { entryOfSeq, rawText } from "@/agent/raw";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/useIsPhone";
import type { LogEntry } from "../../../../src/shared/agent-protocol.ts";

/** How long a finger must stay down on a message for the raw JSON (a phone's long-press). */
const LONG_PRESS_MS = 500;
/** How far the finger may drift before it is a scroll, not a press. */
const LONG_PRESS_SLOP_PX = 10;

/**
 * The raw view's state (#137): which messages show their raw JSON, and whether the whole
 * Transcript is raw. Held by the Pane, so it is the owner's choice on this device only.
 */
export interface RawView {
  /** The header's "Raw" switch: the whole Transcript as JSON. */
  all: boolean;
  setAll(on: boolean): void;
  /** Whether the message of the log entry with this `seq` shows its raw JSON. */
  isShown(seq: number): boolean;
  /** Shows the raw JSON of that message, if it is not already shown. */
  show(seq: number): void;
  /** Shows it if hidden, hides it if shown. */
  toggle(seq: number): void;
}

export function useRawView(): RawView {
  const [all, setAll] = useState(false);
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const show = useCallback(
    (seq: number) => setShown((current) => new Set(current).add(seq)),
    [],
  );
  const toggle = useCallback(
    (seq: number) =>
      setShown((current) => {
        const next = new Set(current);
        if (!next.delete(seq)) next.add(seq);
        return next;
      }),
    [],
  );
  return useMemo(
    () => ({ all, setAll, isShown: (seq) => shown.has(seq), show, toggle }),
    [all, shown, show, toggle],
  );
}

/**
 * Lets any row open its message's raw JSON without being handed the raw view. This is the
 * `onShowRaw(seq)` the Unsupported rows of #153 call: `useShowRaw()(item.seq)`.
 */
const ShowRawContext = createContext<(seq: number) => void>(() => {});
export const ShowRawProvider = ShowRawContext.Provider;
export function useShowRaw(): (seq: number) => void {
  return useContext(ShowRawContext);
}

/** The header's "Raw" switch. */
export function RawSwitch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
      />
      Raw
    </label>
  );
}

/** One piece of raw JSON. */
function RawJson({ entry, label }: { entry: LogEntry; label?: string }) {
  return (
    <figure aria-label={label}>
      <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/50 p-2 font-mono text-xs break-words whitespace-pre-wrap">
        {rawText(entry)}
      </pre>
    </figure>
  );
}

/** The whole Transcript as JSON: every log entry, in order, in place of the conversation. */
export function RawTranscript({ entries }: { entries: readonly LogEntry[] }) {
  return (
    <>
      {entries.map((entry) => (
        <RawJson key={entry.seq} entry={entry} label={`Raw message ${entry.seq}`} />
      ))}
    </>
  );
}

/**
 * Wraps one row of the conversation (the one built from the log entry `seq`) and adds its raw
 * JSON: on desktop a `</>` button, shown on hover or focus; on a phone a long-press on the row.
 * Either shows the JSON under the row, and again hides it. The JSON is the message exactly as
 * Claude Code sent it (`rawOf`).
 */
export function RawMessage({
  seq,
  entries,
  rawView,
  children,
}: {
  /** The row's entry; a row with none (text still streaming in) has no raw JSON yet. */
  seq: number | undefined;
  entries: readonly LogEntry[];
  rawView: RawView;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number }>(undefined);
  const entry = seq === undefined ? undefined : entryOfSeq(entries, seq);
  const open = seq !== undefined && rawView.isShown(seq);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") return;
    start.current = { x: event.clientX, y: event.clientY };
    cancel();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      window.getSelection()?.removeAllRanges();
      if (seq !== undefined) rawView.toggle(seq);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (timer.current === undefined || !start.current) return;
    const moved = Math.hypot(
      event.clientX - start.current.x,
      event.clientY - start.current.y,
    );
    if (moved > LONG_PRESS_SLOP_PX) cancel();
  };

  if (!entry || seq === undefined) return <div>{children}</div>;
  return (
    <div
      className={cn("group relative space-y-2", phone && "[-webkit-touch-callout:none]")}
      onPointerDown={phone ? onPointerDown : undefined}
      onPointerMove={phone ? onPointerMove : undefined}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
    >
      {children}
      {!phone && (
        <button
          type="button"
          aria-label={open ? "Hide raw message" : "Show raw message"}
          aria-expanded={open}
          onClick={() => rawView.toggle(seq)}
          className="absolute top-0 right-0 rounded px-1 font-mono text-xs text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100"
        >
          {"</>"}
        </button>
      )}
      {open && <RawJson entry={entry} label="Raw message" />}
    </div>
  );
}
