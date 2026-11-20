// PROTOTYPE (throwaway, branch prototype/ask-interrupt): three takes on "How does the Owner
// interrupt or redirect while an ask is open?" (#179), mounted in a real Claude Agent's Pane in
// place of the PromptDock when the URL has `?askproto=A|B|C`. Stub asks; nothing is sent.
import { ChevronLeft, ChevronRight, StopCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toolDisplayName, toolTarget } from "../../../agent/toolDisplay";
import type { AgentConversation } from "../../../agent/useAgentConversation";
import { Composer } from "../Composer";
import { PermissionPrompt } from "../PermissionPrompt";
import { type DemoAsk, type DemoAsks, useDemoAsks } from "./demo";

const VARIANTS = [
  ["A", "Both at once"],
  ["B", "The queue"],
  ["C", "Set it aside"],
] as const;
type Key = (typeof VARIANTS)[number][0];

export function askPrototypeVariant(): Key | undefined {
  const v = new URLSearchParams(window.location.search).get("askproto");
  return VARIANTS.some(([k]) => k === v) ? (v as Key) : undefined;
}

export function AskInterruptPrototype({
  conversation,
}: {
  conversation: AgentConversation;
}) {
  const [variant, setVariant] = useState<Key>(() => askPrototypeVariant() ?? "A");
  const demo = useDemoAsks();
  const go = (step: number) => {
    const i = VARIANTS.findIndex(([k]) => k === variant);
    const next = (VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length] ??
      VARIANTS[0])[0];
    const url = new URL(window.location.href);
    url.searchParams.set("askproto", next);
    window.history.replaceState(null, "", url);
    setVariant(next);
    demo.reset();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const props = { demo, conversation };
  return (
    <>
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}
      <div className="fixed top-2 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 flex-col gap-1 rounded-lg bg-fuchsia-950/95 p-2 font-sans text-xs text-white shadow-xl ring-1 ring-fuchsia-400">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
            <ChevronLeft className="size-4" />
          </button>
          <span>
            PROTOTYPE {variant} ({VARIANTS.find(([k]) => k === variant)?.[1]})
          </span>
          <button type="button" onClick={() => demo.reset()} className="underline">
            reset
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next variant">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <ol className="font-mono text-[11px] text-fuchsia-100">
          {demo.log.length === 0 ? (
            <li>would send: nothing yet</li>
          ) : (
            demo.log.map((line) => <li key={line}>→ {line}</li>)
          )}
        </ol>
      </div>
    </>
  );
}

interface Props {
  demo: DemoAsks;
  conversation: AgentConversation;
}

/** Who is asking, over the panel: the gap the permission ticket settles, shown here for context. */
function From({ ask }: { ask: DemoAsk }) {
  return (
    <p className="px-3 pt-2 text-xs text-orange-300/80">
      {ask.from === "Claude" ? "Claude asks" : `${ask.from} asks`}
      {ask.background && " · background"}
    </p>
  );
}

/** The real permission panel, answering into the demo. */
function Panel({ ask, demo, more }: { ask: DemoAsk; demo: DemoAsks; more: number }) {
  return (
    <PermissionPrompt
      ask={ask}
      cwd={undefined}
      more={more}
      offline={false}
      onAnswer={(id, reply) => {
        if (reply.decision === "allow") demo.allow(id, reply.alwaysAllow);
        else demo.deny(id, reply.message);
        return true;
      }}
    />
  );
}

/** The real input box, sending into the demo. */
function DemoComposer({
  demo,
  conversation,
  how,
  placeholderNote,
}: Props & { how: "queued" | "now"; placeholderNote?: string }) {
  return (
    <div>
      {placeholderNote && (
        <p className="px-3 pt-1 text-[11px] text-muted-foreground">{placeholderNote}</p>
      )}
      <Composer
        sessionId="askproto-draft"
        onSend={(text) => {
          demo.prompt(text, how);
          return true;
        }}
        disabled={false}
        offline={false}
        autoFocus={false}
        history={[]}
        working={demo.working}
        interrupting={false}
        onInterrupt={() => {
          demo.interrupt();
          return true;
        }}
        commands={conversation.commands}
      />
    </div>
  );
}

function Done({ demo }: { demo: DemoAsks }) {
  return (
    <p className="border-t border-white/10 px-3 py-2 text-xs text-muted-foreground">
      No asks open.{" "}
      <button type="button" className="underline" onClick={demo.reset}>
        Bring them back
      </button>
    </p>
  );
}

/**
 * A: both at once. The ask's panel sits over a slim input box that never goes away: Interrupt
 * (and Esc) work while the ask is open, and what is typed is sent as an ordinary prompt.
 * Several asks page through with arrows.
 */
function VariantA({ demo, conversation }: Props) {
  const [at, setAt] = useState(0);
  const ask = demo.asks[Math.min(at, demo.asks.length - 1)];
  return (
    <div className="flex flex-col">
      {ask ? (
        <>
          <div className="flex items-center justify-between border-t-2 border-orange-400/70 bg-orange-400/5 px-3 pt-2 text-xs">
            <From ask={ask} />
            {demo.asks.length > 1 && (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Previous ask"
                  onClick={() => setAt((at - 1 + demo.asks.length) % demo.asks.length)}
                >
                  <ChevronLeft className="size-4" />
                </button>
                {Math.min(at, demo.asks.length - 1) + 1} of {demo.asks.length}
                <button
                  type="button"
                  aria-label="Next ask"
                  onClick={() => setAt((at + 1) % demo.asks.length)}
                >
                  <ChevronRight className="size-4" />
                </button>
              </span>
            )}
          </div>
          <Panel ask={ask} demo={demo} more={0} />
        </>
      ) : (
        <Done demo={demo} />
      )}
      <DemoComposer
        demo={demo}
        conversation={conversation}
        how="queued"
        placeholderNote={
          ask ? "Typing here sends a prompt; ■ (or Esc) interrupts." : undefined
        }
      />
    </div>
  );
}

/**
 * B: the queue. Every open ask is one line with its own Allow and Deny; a line opens to the
 * full panel. Over them, the two ways out of the whole queue: Stop (an interrupt) and
 * "Deny all and tell Claude…". No input box until the queue is empty.
 */
function VariantB({ demo, conversation }: Props) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [saying, setSaying] = useState<string | undefined>(undefined);
  if (demo.asks.length === 0) {
    return (
      <>
        <Done demo={demo} />
        <DemoComposer demo={demo} conversation={conversation} how="queued" />
      </>
    );
  }
  return (
    <section className="flex max-h-[75dvh] flex-col gap-2 overflow-y-auto border-t-2 border-orange-400/70 bg-orange-400/5 p-3 font-mono text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-orange-300">{demo.asks.length} waiting for you</strong>
        <span className="flex-1" />
        <Button size="sm" variant="destructive" onClick={demo.interrupt}>
          <StopCircle className="size-4" /> Stop Claude
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSaying("")}>
          Deny all and tell Claude…
        </Button>
      </div>
      {saying !== undefined && (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-16 rounded border border-white/20 bg-black/40 p-2 text-sm"
            placeholder="What should Claude do instead?"
            value={saying}
            onChange={(e) => setSaying(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                demo.denyAll(saying);
                setSaying(undefined);
              }}
            >
              Deny all and send
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSaying(undefined)}>
              Back
            </Button>
          </div>
        </div>
      )}
      <ul className="flex flex-col divide-y divide-white/10">
        {demo.asks.map((ask) => (
          <li key={ask.requestId} className="py-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() =>
                  setOpen(open === ask.requestId ? undefined : ask.requestId)
                }
              >
                <span className="text-orange-300">{toolDisplayName(ask.toolName)}</span>{" "}
                <span className="text-muted-foreground">
                  {toolTarget(ask.toolName, ask.input, {})}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {ask.from}
                  {ask.background && " · background"}
                </span>
              </button>
              <Button size="sm" onClick={() => demo.allow(ask.requestId)}>
                Allow
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => demo.deny(ask.requestId)}
              >
                Deny
              </Button>
            </div>
            {open === ask.requestId && (
              <div className="mt-2">
                <Panel ask={ask} demo={demo} more={0} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * C: set it aside. The ask's panel is as today, with "Set aside": it shrinks to a pill over the
 * full input box, which sends with priority "now" (Claude redirects at once) and has
 * Interrupt. Tapping the pill brings the asks back.
 */
function VariantC({ demo, conversation }: Props) {
  const [aside, setAside] = useState(false);
  const [ask, ...rest] = demo.asks;
  if (ask && !aside) {
    return (
      <div>
        <div className="flex items-center justify-between border-t-2 border-orange-400/70 bg-orange-400/5 pr-3">
          <From ask={ask} />
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setAside(true)}
          >
            Set aside to type or stop
          </button>
        </div>
        <Panel ask={ask} demo={demo} more={rest.length} />
      </div>
    );
  }
  return (
    <div>
      {ask && (
        <button
          type="button"
          onClick={() => setAside(false)}
          className={cn(
            "mx-3 mt-2 flex items-center gap-2 rounded-full bg-orange-400/20 px-3 py-1 text-xs text-orange-200 ring-1 ring-orange-400/60",
          )}
        >
          <span className="size-2 animate-pulse rounded-full bg-orange-400" />
          {demo.asks.length} {demo.asks.length === 1 ? "ask" : "asks"} waiting · Show
        </button>
      )}
      {!ask && <Done demo={demo} />}
      <DemoComposer
        demo={demo}
        conversation={conversation}
        how="now"
        placeholderNote={
          ask ? "Sends now: Claude redirects at once. ■ interrupts." : undefined
        }
      />
    </div>
  );
}
