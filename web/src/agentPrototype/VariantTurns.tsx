/**
 * PROTOTYPE, throwaway. Variant C, "Turns": the conversation as one card per turn. Your
 * prompt heads the card, Claude's prose is the body, and all tool work folds into a single
 * live "activity" strip you can open. The Allow/Deny prompt is a bottom sheet that dims
 * the conversation, built for a thumb. Raw messages for a turn open in a side drawer.
 */
import {
  CheckIcon,
  ChevronDownIcon,
  CodeXmlIcon,
  PauseIcon,
  PlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Diff, Markdown, RawJson, Spinner } from "./bits";
import type { VariantProps } from "./types";
import { type Item, MODE_LABEL, MODES } from "./useDemoConversation";

interface Turn {
  prompt: Extract<Item, { kind: "user" }> | null;
  items: Item[];
}

function turns(items: Item[]): Turn[] {
  const out: Turn[] = [];
  for (const item of items) {
    if (item.kind === "user" || out.length === 0) {
      out.push({ prompt: item.kind === "user" ? item : null, items: [] });
      if (item.kind === "user") continue;
    }
    out[out.length - 1]?.items.push(item);
  }
  return out;
}

export function VariantTurns({ demo, stopped, stopReason, onRestart }: VariantProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [rawTurn, setRawTurn] = useState<Turn | null>(null);
  const all = turns(demo.items);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the conversation as it grows
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [demo.items]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-neutral-950">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-28 md:px-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {all.map((turn, i) => (
            <TurnCard
              key={turn.prompt?.id ?? `t${i}`}
              turn={turn}
              live={demo.running && i === all.length - 1}
              demo={demo}
              onRaw={() => setRawTurn(turn)}
            />
          ))}
        </div>
      </div>

      {stopped ? (
        <div className="absolute inset-x-3 bottom-3 mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-red-500/30 bg-neutral-900 px-4 py-3 shadow-xl">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">This Agent is Stopped</div>
            <div className="truncate text-muted-foreground">{stopReason}</div>
          </div>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Restart
          </button>
        </div>
      ) : (
        <PillComposer demo={demo} />
      )}

      {demo.pendingPermission && !stopped && (
        <PermissionSheet permission={demo.pendingPermission} onAnswer={demo.answer} />
      )}

      {rawTurn && (
        // biome-ignore lint/a11y/noStaticElementInteractions: prototype backdrop, click to close
        <div
          className="absolute inset-0 z-20 flex justify-end bg-black/50"
          onClick={() => setRawTurn(null)}
          onKeyDown={() => {}}
          role="presentation"
        >
          <div
            className="flex h-full w-full flex-col bg-neutral-900 md:w-[28rem]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={() => {}}
            role="dialog"
          >
            <div className="flex items-center border-b border-white/10 px-4 py-3 text-sm font-medium">
              Raw messages for this turn
              <button
                type="button"
                onClick={() => setRawTurn(null)}
                className="ml-auto"
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {[...(rawTurn.prompt ? [rawTurn.prompt] : []), ...rawTurn.items].map(
                (item) => (
                  <RawJson key={item.id} value={item.raw} />
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TurnCard({
  turn,
  live,
  demo,
  onRaw,
}: {
  turn: Turn;
  live: boolean;
  demo: VariantProps["demo"];
  onRaw: () => void;
}) {
  const [open, setOpen] = useState(false);
  const tools = turn.items.filter((i) => i.kind === "tool" || i.kind === "unknown");
  const prose = turn.items.filter(
    (i) => i.kind === "text" || i.kind === "note" || i.kind === "permission",
  );
  const result = turn.items.find((i) => i.kind === "result");
  const thinking = turn.items.find((i) => i.kind === "thinking");

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
      {turn.prompt && (
        <header className="flex items-start gap-2 border-b border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0 flex-1 font-medium">
            {turn.prompt.text}
            {turn.prompt.queued && (
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal">
                queued
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onRaw}
            aria-label="Raw view"
            className="text-muted-foreground/60 hover:text-muted-foreground"
          >
            <CodeXmlIcon className="size-4" />
          </button>
        </header>
      )}

      {(tools.length > 0 || live || thinking) && (
        <div className="border-b border-white/5">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground"
          >
            {live ? (
              <Spinner className="text-orange-400" />
            ) : (
              <CheckIcon className="size-4 text-green-400" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {live
                ? `${demo.activity ?? "Working"} · ${demo.elapsed}s`
                : `${result?.kind === "result" ? result.text : "Finished"} · ${tools.length} steps`}
            </span>
            <span className="flex gap-1">
              {tools.slice(-5).map((t) => (
                <span
                  key={t.id}
                  className={cn(
                    "size-1.5 rounded-full",
                    t.kind === "tool" && t.status === "running" && "bg-orange-400",
                    t.kind === "tool" && t.status === "done" && "bg-green-400/70",
                    t.kind === "tool" && t.status === "denied" && "bg-red-400",
                    t.kind === "unknown" && "bg-white/40",
                  )}
                />
              ))}
            </span>
            <ChevronDownIcon className={cn("size-4 transition", open && "rotate-180")} />
          </button>
          {open && (
            <ol className="space-y-2 px-4 pb-3 text-sm">
              {thinking?.kind === "thinking" && (
                <li className="text-muted-foreground italic">Thought: {thinking.text}</li>
              )}
              {tools.map((t) =>
                t.kind === "tool" ? (
                  <li key={t.id}>
                    <div className="flex gap-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {t.target}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {t.result}
                      </span>
                    </div>
                    {t.diff && <Diff lines={t.diff} className="mt-1" />}
                  </li>
                ) : (
                  <li key={t.id} className="text-xs text-muted-foreground">
                    Unrecognised: {t.kind === "unknown" ? t.label : ""}
                    <RawJson value={t.raw} className="mt-1" />
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      )}

      <div className="space-y-3 px-4 py-3 text-[15px] leading-relaxed">
        {prose.map((p) =>
          p.kind === "text" ? (
            <Markdown key={p.id} text={p.text + (p.streaming ? " ▍" : "")} />
          ) : p.kind === "note" ? (
            <div key={p.id} className="text-sm text-red-300">
              {p.text}
            </div>
          ) : p.kind === "permission" && p.answer ? (
            <div key={p.id} className="text-xs text-muted-foreground">
              Edit to <code>{p.target}</code>: {p.answer}
            </div>
          ) : null,
        )}
        {prose.length === 0 && live && (
          <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
        )}
      </div>
    </article>
  );
}

function PermissionSheet({
  permission,
  onAnswer,
}: {
  permission: NonNullable<VariantProps["demo"]["pendingPermission"]>;
  onAnswer: VariantProps["demo"]["answer"];
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="w-full max-w-xl rounded-t-3xl border-t border-orange-400/50 bg-neutral-900 p-4 pb-5 shadow-2xl md:mb-4 md:rounded-3xl md:border">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" />
        <div className="text-xs font-medium tracking-wide text-orange-300 uppercase">
          Claude needs your OK
        </div>
        <div className="mt-1 text-lg font-semibold">
          Edit <span className="font-mono text-base">{permission.target}</span>
        </div>
        <Diff lines={permission.diff} className="mt-3 max-h-48 overflow-y-auto" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onAnswer("deny")}
            className="rounded-2xl bg-white/10 py-3.5 font-medium text-red-300"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onAnswer("allow")}
            className="rounded-2xl bg-primary py-3.5 font-medium text-primary-foreground"
          >
            Allow
          </button>
        </div>
        <button
          type="button"
          onClick={() => onAnswer("always")}
          className="mt-2 w-full py-2 text-sm text-muted-foreground"
        >
          Allow, and don't ask again for edits
        </button>
      </div>
    </div>
  );
}

function PillComposer({ demo }: { demo: VariantProps["demo"] }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    demo.send(text.trim());
    setText("");
  };
  return (
    <div className="absolute inset-x-3 bottom-3">
      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex justify-center gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => demo.setMode(m)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px]",
                demo.mode === m ? "bg-white/15 text-foreground" : "text-muted-foreground",
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-3xl border border-white/10 bg-neutral-800 p-1.5 shadow-xl">
          <button
            type="button"
            aria-label="Add image"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          >
            <PlusIcon className="size-5" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={demo.running ? "Add to the queue…" : "Ask Claude…"}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[16px] outline-none placeholder:text-muted-foreground"
          />
          {demo.running && !text ? (
            <button
              type="button"
              onClick={demo.interrupt}
              aria-label="Interrupt"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-black"
            >
              <PauseIcon className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <SendIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
