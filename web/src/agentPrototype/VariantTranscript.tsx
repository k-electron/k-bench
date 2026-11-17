/**
 * PROTOTYPE, throwaway. Variant B, "Transcript": close to Claude TUI, but rendered. A dense,
 * monospace-leaning log with gutter markers, tool calls always expanded underneath, and the
 * Allow/Deny prompt docked where the input box was (like the TUI's prompt takes over input).
 * One switch in the header flips the whole transcript to raw JSON.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Diff, Markdown, RawJson } from "./bits";
import type { VariantProps } from "./types";
import { type Item, MODE_LABEL } from "./useDemoConversation";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function VariantTranscript({
  demo,
  stopped,
  stopReason,
  onRestart,
}: VariantProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 90);
    return () => clearInterval(t);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the conversation as it grows
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [demo.items, raw]);

  const pending = demo.pendingPermission;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0c] font-mono text-[13px]">
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="text-orange-400">✻</span>
        <span className="truncate">claude 2.1.330 · opus · ~/repos/k-bench</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={raw}
            onChange={(e) => setRaw(e.target.checked)}
          />
          raw
        </label>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 leading-relaxed"
      >
        {raw
          ? demo.items.map((item) => (
              <RawJson key={item.id} value={item.raw} className="mb-2" />
            ))
          : demo.items.map((item) => <Line key={item.id} item={item} tick={tick} />)}
        {demo.running && !pending && !stopped && (
          <div className="mt-2 text-orange-400">
            {SPIN[tick % SPIN.length]} {demo.activity ?? "Working"}…{" "}
            <span className="text-muted-foreground">
              ({demo.elapsed}s · tap ■ to interrupt)
            </span>
          </div>
        )}
      </div>
      {stopped ? (
        <div className="border-t border-red-500/40 px-3 py-2.5">
          <div className="text-red-300">⏹ Stopped: {stopReason}</div>
          <button
            type="button"
            onClick={onRestart}
            className="mt-2 rounded border border-white/20 px-3 py-1 hover:bg-white/5"
          >
            ↻ Restart
          </button>
        </div>
      ) : pending ? (
        <div className="border-t-2 border-orange-400/70 bg-orange-400/5 px-3 py-2.5">
          <div className="mb-1.5">
            <span className="text-orange-300">Edit file</span>{" "}
            <span className="text-muted-foreground">{pending.target}</span>
          </div>
          <Diff lines={pending.diff} className="max-h-40 overflow-y-auto" />
          <div className="mt-2">Do you want to make this edit?</div>
          <div className="mt-1.5 flex flex-col gap-1">
            {(
              [
                ["allow", "1. Yes"],
                ["always", "2. Yes, allow all edits during this session"],
                ["deny", "3. No, and tell Claude what to do differently"],
              ] as const
            ).map(([a, label]) => (
              <button
                key={a}
                type="button"
                onClick={() => demo.answer(a)}
                className="rounded px-2 py-1.5 text-left hover:bg-white/10 active:bg-white/15"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Prompt demo={demo} />
      )}
    </div>
  );
}

function Line({ item, tick }: { item: Item; tick: number }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="my-2 rounded bg-white/[0.06] px-2 py-1">
          <span className="text-muted-foreground">&gt; </span>
          {item.text}
          {item.queued && (
            <span className="ml-2 text-xs text-muted-foreground">(queued)</span>
          )}
        </div>
      );
    case "thinking":
      return (
        <div className="my-1 text-muted-foreground italic">
          ✻ Thinking… <span className="not-italic">({item.seconds}s)</span>
        </div>
      );
    case "text":
      return (
        <div className="my-1.5 flex gap-2">
          <span className="text-white/70">⏺</span>
          <Markdown
            text={item.text + (item.streaming ? " ▌" : "")}
            className="min-w-0 flex-1 font-sans text-[14px]"
          />
        </div>
      );
    case "tool":
      return (
        <div className="my-1.5">
          <div className="flex gap-2">
            <span
              className={cn(
                item.status === "running" && "text-orange-400",
                item.status === "done" && "text-green-400",
                item.status === "denied" && "text-red-400",
              )}
            >
              {item.status === "running" ? SPIN[tick % SPIN.length] : "⏺"}
            </span>
            <span>
              <strong>{item.name}</strong>
              <span className="text-muted-foreground">({item.target})</span>
            </span>
          </div>
          {item.result && (
            <div className="pl-5 text-muted-foreground">
              ⎿ {item.result}
              {item.output && item.output.length > 0 && (
                <div className="pl-3">
                  {item.output.map((l) => (
                    <div key={l}>{l || " "}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {item.diff && <Diff lines={item.diff} className="mt-1 ml-5" />}
        </div>
      );
    case "permission":
      return item.answer ? (
        <div className="my-1 pl-5 text-xs text-muted-foreground">
          ⎿ permission: {item.answer}
        </div>
      ) : null;
    case "unknown":
      return (
        <div className="my-1.5 text-muted-foreground">
          <span>? {item.label}</span>
          <RawJson value={item.raw} className="mt-1 ml-5" />
        </div>
      );
    case "note":
      return <div className="my-1 text-red-300">⎿ {item.text}</div>;
    case "result":
      return <div className="my-2 text-xs text-muted-foreground">✓ {item.text}</div>;
  }
}

function Prompt({ demo }: { demo: VariantProps["demo"] }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    demo.send(text.trim());
    setText("");
  };
  return (
    <div className="border-t border-white/10 px-3 py-2">
      <div className="flex items-start gap-2 rounded border border-white/15 px-2 py-1.5">
        <span className="text-muted-foreground">&gt;</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") demo.interrupt();
            if (e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              demo.cycleMode();
            }
          }}
          rows={1}
          className="min-h-6 flex-1 resize-none bg-transparent font-sans text-[16px] outline-none"
        />
        {demo.running && (
          <button
            type="button"
            onClick={demo.interrupt}
            aria-label="Interrupt"
            className="px-1 text-red-300"
          >
            ■
          </button>
        )}
        <button type="button" onClick={submit} aria-label="Send" className="px-1">
          ⏎
        </button>
      </div>
      <button
        type="button"
        onClick={demo.cycleMode}
        className="mt-1 text-xs text-muted-foreground"
      >
        {demo.mode === "default"
          ? "? for shortcuts"
          : `⏵⏵ ${MODE_LABEL[demo.mode].toLowerCase()} on`}{" "}
        <span className="opacity-60">(tap or shift+tab to cycle)</span>
      </button>
    </div>
  );
}
