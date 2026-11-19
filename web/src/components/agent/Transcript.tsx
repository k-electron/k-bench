import { memo } from "react";
import type { LogEntry } from "../../../../src/shared/agent-protocol.ts";
import type { TranscriptItem } from "../../agent/items";
import { Markdown } from "./Markdown";
import { RawMessage, type RawView, ShowRawProvider } from "./RawView";
import { ToolCall } from "./ToolCall";

/**
 * The conversation in Claude TUI's shape. The scaffolding (`>`, `⏺`, `⎿`, tool names, output)
 * is monospace; Claude's prose is in the reading font, as markdown.
 *
 * One component per kind of item, chosen in `TranscriptItemView`. To show a new kind, add its
 * item in `agent/items.ts` and its case here (see the top of `items.ts`): the `never` check
 * below fails to compile until it has one. The glyphs are `aria-hidden`: they are the
 * terminal's way of saying what the accessible names and roles say.
 */
export function Transcript({
  items,
  entries,
  rawView,
  focusView,
}: {
  items: readonly TranscriptItem[];
  /** The log's entries, for the raw JSON of the message an item comes from (#137). */
  entries: readonly LogEntry[];
  rawView: RawView;
  /** Claude Code is in Focus view: a tool call is one collapsed line. */
  focusView: boolean;
}) {
  return (
    // `break-words` is inherited: a path or output line with no space in it wraps at the edge
    // of the screen instead of widening the page.
    <ShowRawProvider value={rawView.show}>
      <div className="font-mono text-[13px] leading-relaxed break-words">
        {items.map((item) => (
          <RawMessage key={item.key} seq={item.seq} entries={entries} rawView={rawView}>
            <TranscriptItemView item={item} focusView={focusView} />
          </RawMessage>
        ))}
      </div>
    </ShowRawProvider>
  );
}

/** A glyph in the left gutter: `>`, `⏺`, `✻`. */
function Gutter({ children, className }: { children: string; className?: string }) {
  return (
    <span aria-hidden className={`shrink-0 select-none ${className ?? ""}`}>
      {children}
    </span>
  );
}

export const TranscriptItemView = memo(function TranscriptItemView({
  item,
  focusView,
}: {
  item: TranscriptItem;
  focusView: boolean;
}) {
  switch (item.kind) {
    case "prompt":
      return (
        <article
          aria-label="Your prompt"
          className="my-2 flex gap-2 rounded bg-white/[0.07] px-2 py-1"
        >
          <Gutter className="text-muted-foreground">&gt;</Gutter>
          <span className="min-w-0 break-words whitespace-pre-wrap">
            {item.text}
            {item.queued && <span className="text-muted-foreground"> (queued)</span>}
          </span>
        </article>
      );
    case "assistant":
      return (
        <article aria-label="Claude" className="my-1.5 flex gap-2">
          <Gutter className="text-white/70">⏺</Gutter>
          <Markdown text={item.text} />
        </article>
      );
    case "thinking":
      return (
        <article
          aria-label="Thinking"
          className="my-1 flex gap-2 text-muted-foreground italic"
        >
          <Gutter>✻</Gutter>
          <span>
            {item.streaming
              ? "Thinking…"
              : item.seconds === undefined
                ? "Thought"
                : `Thought for ${item.seconds}s`}
          </span>
        </article>
      );
    case "tool":
      return <ToolCall item={item} collapsed={focusView} />;
    case "interrupted":
      return (
        <div className="my-1 flex gap-2 pl-5 text-red-300">
          <Gutter>⎿</Gutter>
          <span>Interrupted</span>
        </div>
      );
    default: {
      // Every kind of item has a case above: a new kind fails to compile here until it has one.
      const missing: never = item;
      return missing;
    }
  }
});
