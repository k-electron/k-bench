import { useState } from "react";
import type { PermissionReply } from "../../../../src/shared/agent-protocol.ts";
import type { PermissionAsk } from "../../agent/transcript";
import { AskPanel, Choice, useAnswerGate } from "./AskPanel";
import { Markdown } from "./Markdown";
import { ReplyBox } from "./ReplyBox";

/**
 * The docked panel for plan approval (#147): Claude Code's `ExitPlanMode` ask, with the plan as
 * markdown (scrolling inside itself, the choices below it), to approve or to reject with
 * feedback. Approving lets Claude carry the plan out in the same turn; rejecting sends the
 * feedback, or nothing, and Claude keeps planning. Claude Code has already written the plan
 * into its own plans folder, as the terminal does: nothing here saves it.
 *
 * Gone only when the ask's answered entry arrives, on every device alike. See `PermissionPrompt`
 * for `offline`.
 */
export function PlanPrompt({
  ask,
  plan,
  more,
  offline,
  onAnswer,
}: {
  ask: PermissionAsk;
  /** The plan's markdown. */
  plan: string;
  /** How many more asks wait behind this one. */
  more: number;
  offline: boolean;
  /** Sends the answer; false when it could not be sent. */
  onAnswer: (requestId: string, reply: PermissionReply) => boolean;
}) {
  const gate = useAnswerGate(ask.requestId, offline);
  const [rejecting, setRejecting] = useState(false);
  const send = (answer: PermissionReply) =>
    gate.answer(() => onAnswer(ask.requestId, answer));

  return (
    <AskPanel label="Plan for approval" more={more}>
      <section
        aria-label="Plan"
        className="max-h-[40dvh] overflow-y-auto rounded-md bg-black/40 px-3 py-2"
      >
        <Markdown text={plan} />
      </section>
      <p className="break-words">{ask.title ?? "Claude has a plan. Ready to proceed?"}</p>
      {rejecting ? (
        <ReplyBox
          label="Tell Claude what to change in the plan"
          skipLabel="Reject without feedback"
          disabled={gate.disabled}
          onSend={(message) => send({ decision: "deny", message })}
          onSkip={() => send({ decision: "deny" })}
          onBack={() => setRejecting(false)}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <Choice
            number={1}
            disabled={gate.disabled}
            onClick={() => send({ decision: "allow" })}
          >
            Yes, proceed with the plan
          </Choice>
          <Choice number={2} disabled={gate.disabled} onClick={() => setRejecting(true)}>
            No, keep planning
          </Choice>
        </div>
      )}
    </AskPanel>
  );
}
