import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PermissionReply } from "../../../../src/shared/agent-protocol.ts";
import { toolDiff, toolDisplayName, toolTarget } from "../../agent/toolDisplay";
import type { PermissionAsk } from "../../agent/transcript";
import { useIsPhone } from "../../useIsPhone";
import { AskPanel, Choice, useAnswerGate } from "./AskPanel";
import { Diff } from "./Diff";

/** The question Claude Code puts over the choices, when the ask carries no sentence of its own. */
function question(toolName: string): string {
  switch (toolName) {
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "Do you want to make this edit?";
    case "Write":
      return "Do you want to write this file?";
    default:
      return "Do you want to proceed?";
  }
}

/** What the ask is about, under the tool's name: the edit as a diff, a command in full, else the input. */
function Subject({ ask, cwd }: { ask: PermissionAsk; cwd: string | undefined }) {
  const target = toolTarget(ask.toolName, ask.input, cwd === undefined ? {} : { cwd });
  const diff = toolDiff(ask.toolName, ask.input);
  if (diff && diff.length > 0) {
    return <Diff lines={diff} label={`Diff of ${target}`} />;
  }
  const command = typeof ask.input.command === "string" ? ask.input.command : undefined;
  // A command is shown whole, however long: nobody should allow what they have not seen.
  const body = command ?? JSON.stringify(ask.input, null, 2);
  return (
    <pre className="max-h-48 overflow-auto rounded-md bg-black/50 px-3 py-2 text-xs break-words whitespace-pre-wrap">
      {body}
    </pre>
  );
}

/**
 * The docked panel for a permission ask, as Claude Code's own: the tool and what it acts on,
 * the diff of an edit (a command in full), and numbered choices. "Yes, don't ask again" is
 * there only where Claude Code offers it (it sent suggestions and did not suppress the
 * choice); "No, and tell Claude what to do differently" opens a box for the reply. It is shown
 * while the ask is open, and goes only when the ask's answered entry arrives, on every device
 * alike. Its answer is a `PermissionReply`: it says which choice, never what to save.
 *
 * `cwd` is Claude Code's working folder, to show paths relative to it. `offline`: the
 * connection is down, so an answer would be dropped; the choices wait for it to come back.
 */
export function PermissionPrompt({
  ask,
  cwd,
  more,
  offline,
  onAnswer,
}: {
  ask: PermissionAsk;
  cwd: string | undefined;
  /** How many more asks wait behind this one. */
  more: number;
  offline: boolean;
  /** Sends the answer; false when it could not be sent. */
  onAnswer: (requestId: string, reply: PermissionReply) => boolean;
}) {
  const gate = useAnswerGate(ask.requestId, offline);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const phone = useIsPhone();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (replying) field.current?.focus();
  }, [replying]);

  const send = (answer: PermissionReply) =>
    gate.answer(() => onAnswer(ask.requestId, answer));
  const sendReply = () => {
    if (reply.trim() !== "") send({ decision: "deny", message: reply });
  };
  const offersAlways = ask.suggestions.length > 0 && !ask.suppressAlwaysAllowRule;
  const target = toolTarget(ask.toolName, ask.input, cwd === undefined ? {} : { cwd });

  return (
    <AskPanel label="Permission prompt" more={more}>
      <p className="break-words">
        <strong className="text-orange-300">{toolDisplayName(ask.toolName)}</strong>
        {target !== "" && <span className="text-muted-foreground"> {target}</span>}
      </p>
      {ask.description !== undefined && (
        <p className="text-xs break-words text-muted-foreground">{ask.description}</p>
      )}
      <Subject ask={ask} cwd={cwd} />
      <p className="break-words">{ask.title ?? question(ask.toolName)}</p>
      {replying ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={field}
            aria-label="Tell Claude what to do differently"
            placeholder="Tell Claude what to do differently"
            rows={2}
            value={reply}
            disabled={gate.disabled}
            className="field-sizing-content max-h-40 min-h-16 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-1.5 font-sans text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              // Not while an input method is composing (its Enter confirms a character).
              if (event.nativeEvent.isComposing) return;
              if (!phone && event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendReply();
              }
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              disabled={gate.disabled || reply.trim() === ""}
              className="h-11 flex-1 sm:h-9"
              onClick={sendReply}
            >
              Send
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={gate.disabled}
              className="h-11 flex-1 sm:h-9"
              onClick={() => send({ decision: "deny" })}
            >
              Deny without a reply
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={gate.disabled}
              className="h-11 flex-1 sm:h-9"
              onClick={() => setReplying(false)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Choice
            number={1}
            disabled={gate.disabled}
            onClick={() => send({ decision: "allow" })}
          >
            Yes
          </Choice>
          {offersAlways && (
            <Choice
              number={2}
              disabled={gate.disabled}
              onClick={() => send({ decision: "allow", alwaysAllow: true })}
            >
              Yes, don't ask again
            </Choice>
          )}
          <Choice
            number={offersAlways ? 3 : 2}
            disabled={gate.disabled}
            onClick={() => setReplying(true)}
          >
            No, and tell Claude what to do differently
          </Choice>
        </div>
      )}
    </AskPanel>
  );
}
