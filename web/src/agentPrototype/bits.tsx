/** PROTOTYPE, throwaway: small renderers the three variants share (markdown, diff, raw JSON). */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Just enough markdown for the demo: paragraphs, bullets, fenced code, `code`, **bold**, *em*. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let n = 0; // block order never changes within one render
  const parts = text.split(/```\w*\n?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push(
        <pre
          key={`c${n++}`}
          className="overflow-x-auto rounded-md bg-black/60 p-3 font-mono text-[12.5px] leading-relaxed"
        >
          {part.replace(/\n$/, "")}
        </pre>,
      );
      return;
    }
    part
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .forEach((para) => {
        const lines = para.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          blocks.push(
            <ul key={`u${n++}`} className="list-disc space-y-1 pl-5">
              {lines.map((l) => (
                <li key={l}>{inline(l.slice(2))}</li>
              ))}
            </ul>,
          );
        } else {
          blocks.push(<p key={`p${n++}`}>{inline(para)}</p>);
        }
      });
  });
  return <div className={cn("space-y-3", className)}>{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/).map((piece, i) => {
    const key = `${i}${piece}`;
    if (piece.startsWith("`"))
      return (
        <code
          key={key}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]"
        >
          {piece.slice(1, -1)}
        </code>
      );
    if (piece.startsWith("**")) return <strong key={key}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("*")) return <em key={key}>{piece.slice(1, -1)}</em>;
    return piece;
  });
}

export function Diff({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-md bg-black/60 py-2 font-mono text-[12px] leading-relaxed",
        className,
      )}
    >
      {lines.map((line) => (
        <div
          key={line}
          className={cn(
            "px-3 whitespace-pre",
            line.startsWith("+") && "bg-green-500/15 text-green-300",
            line.startsWith("-") && "bg-red-500/15 text-red-300",
            line.startsWith("@@") && "text-muted-foreground",
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

export function RawJson({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-md border border-dashed border-white/15 bg-black/50 p-2 font-mono text-[11px] leading-snug text-muted-foreground",
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
