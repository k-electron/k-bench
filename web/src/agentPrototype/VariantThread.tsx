/**
 * PROTOTYPE, throwaway. Variant A, "Thread": a messaging-style thread. Your prompts are
 * bubbles, Claude's prose runs full width, each tool call is a one-line chip that expands,
 * the Allow/Deny card sits inline where it happened, and every message has its own raw view.
 */
import {
  BrainIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  FileTextIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  SquareIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Diff, Markdown, RawJson, Spinner } from "./bits";
import type { VariantProps } from "./types";
import { type Item, MODE_LABEL } from "./useDemoConversation";

const TOOL_ICON: Record<string, ReactNode> = {
  Grep: <SearchIcon className="size-3.5" />,
  Read: <FileTextIcon className="size-3.5" />,
  Edit: <PencilIcon className="size-3.5" />,
  Bash: <TerminalSquareIcon className="size-3.5" />,
};

export function VariantThread({ demo, stopped, stopReason, onRestart }: VariantProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [rawFor, setRawFor] = useState<Set<number>>(new Set());
  const toggleRaw = (id: number) =>
    setRawFor((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the conversation as it grows
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [demo.items]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 text-[15px] leading-relaxed">
          {demo.items.map((item) => (
            <Message
              key={item.id}
              item={item}
              raw={rawFor.has(item.id)}
              onToggleRaw={() => toggleRaw(item.id)}
              onAnswer={demo.answer}
            />
          ))}
          {demo.running && !stopped && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="text-orange-400" />
              {demo.activity ?? "Working"} · {demo.elapsed}s
            </div>
          )}
        </div>
      </div>
      {stopped ? (
        <StoppedBar reason={stopReason} onRestart={onRestart} />
      ) : (
        <Composer demo={demo} />
      )}
    </div>
  );
}

function Message({
  item,
  raw,
  onToggleRaw,
  onAnswer,
}: {
  item: Item;
  raw: boolean;
  onToggleRaw: () => void;
  onAnswer: VariantProps["demo"]["answer"];
}) {
  const [open, setOpen] = useState(false);
  const rawButton = (
    <button
      type="button"
      onClick={onToggleRaw}
      aria-label="Raw view"
      className={cn(
        "rounded p-1 text-muted-foreground/50 hover:bg-white/5 hover:text-muted-foreground md:opacity-0 md:group-hover:opacity-100",
        raw && "text-orange-400 md:opacity-100",
      )}
    >
      <CodeXmlIcon className="size-3.5" />
    </button>
  );
  const body = (() => {
    switch (item.kind) {
      case "user":
        return (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2">
              {item.text}
              {item.queued && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Queued · sent when this turn ends
                </div>
              )}
            </div>
          </div>
        );
      case "thinking":
        return (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex w-full flex-col items-start text-left text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <BrainIcon className="size-3.5" /> Thought for {item.seconds}s
              <ChevronRightIcon
                className={cn("size-3.5 transition", open && "rotate-90")}
              />
            </span>
            {open && (
              <span className="mt-1 border-l-2 border-white/10 pl-3 italic">
                {item.text}
              </span>
            )}
          </button>
        );
      case "text":
        return (
          <div>
            <Markdown text={item.text} />
            {item.streaming && (
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-orange-400 align-middle" />
            )}
          </div>
        );
      case "tool":
        return (
          <div className="text-sm">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-card px-3 py-1",
                item.status === "denied" && "border-red-500/30 text-red-300",
              )}
            >
              {item.status === "running" ? (
                <Spinner className="size-3.5" />
              ) : (
                TOOL_ICON[item.name]
              )}
              <span className="font-medium">{item.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {item.target}
              </span>
              {item.result && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  · {item.result}
                </span>
              )}
              {(item.diff || item.output) && (
                <ChevronRightIcon
                  className={cn("size-3.5 shrink-0 transition", open && "rotate-90")}
                />
              )}
            </button>
            {open && item.diff && <Diff lines={item.diff} className="mt-2" />}
            {open && item.output && (
              <pre className="mt-2 overflow-x-auto rounded-md bg-black/60 p-3 font-mono text-xs">
                {item.output.join("\n")}
              </pre>
            )}
          </div>
        );
      case "permission":
        return (
          <div
            className={cn(
              "rounded-xl border p-3",
              item.answer === undefined
                ? "border-orange-400/60 bg-orange-400/5"
                : "border-white/10 bg-card",
            )}
          >
            <div className="mb-2 text-sm">
              Claude wants to <strong>edit</strong>{" "}
              <code className="font-mono text-xs">{item.target}</code>
            </div>
            <Diff lines={item.diff} />
            {item.answer === undefined ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => onAnswer("allow")}
                  className="rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
                >
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer("always")}
                  className="rounded-lg bg-secondary px-3 py-2.5 text-sm"
                >
                  Allow, don't ask again
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer("deny")}
                  className="rounded-lg bg-secondary px-3 py-2.5 text-sm text-red-300"
                >
                  Deny
                </button>
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">
                {
                  {
                    allow: "Allowed",
                    always: "Allowed, won't ask again for edits this session",
                    deny: "Denied",
                    interrupted: "Not answered: interrupted",
                  }[item.answer]
                }
              </div>
            )}
          </div>
        );
      case "unknown":
        return (
          <div className="rounded-lg border border-dashed border-white/15 p-2 text-xs text-muted-foreground">
            Unrecognised message <code className="font-mono">{item.label}</code>
            <RawJson value={item.raw} className="mt-2 border-none p-0" />
          </div>
        );
      case "note":
        return (
          <div className="text-center text-xs text-muted-foreground">— {item.text} —</div>
        );
      case "result":
        return (
          <div className="text-center text-xs text-muted-foreground">{item.text}</div>
        );
    }
  })();
  return (
    <div className="group relative">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{body}</div>
        {item.kind !== "unknown" && rawButton}
      </div>
      {raw && <RawJson value={item.raw} className="mt-2" />}
    </div>
  );
}

function Composer({ demo }: { demo: VariantProps["demo"] }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    demo.send(text.trim());
    setText("");
  };
  return (
    <div className="border-t border-white/10 bg-card/50 p-2 md:p-3">
      <div className="mx-auto max-w-3xl">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={demo.running ? "Queue a message…" : "Message Claude…"}
          className="w-full resize-none rounded-lg bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={demo.cycleMode}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              demo.mode === "default"
                ? "border-white/15 text-muted-foreground"
                : "border-orange-400/50 text-orange-300",
            )}
          >
            {MODE_LABEL[demo.mode]}
          </button>
          <div className="flex-1" />
          {demo.running && (
            <button
              type="button"
              onClick={demo.interrupt}
              aria-label="Interrupt"
              className="flex size-9 items-center justify-center rounded-full bg-secondary"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            aria-label="Send"
            disabled={!text.trim()}
            className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-30"
          >
            <SendIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StoppedBar({ reason, onRestart }: { reason: string; onRestart: () => void }) {
  return (
    <div className="flex items-center gap-3 border-t border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">
        <strong>Stopped:</strong> <span className="text-muted-foreground">{reason}</span>
      </span>
      <button
        type="button"
        onClick={onRestart}
        className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground"
      >
        Restart
      </button>
    </div>
  );
}
