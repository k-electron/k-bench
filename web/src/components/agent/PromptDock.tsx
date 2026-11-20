import type { AgentConversation } from "@/agent/useAgentConversation";
import {
  ASK_USER_QUESTION,
  askedPlan,
  askedQuestions,
  EXIT_PLAN_MODE,
} from "../../../../src/shared/agent-questions.ts";
import type { PermissionAsk } from "../../agent/transcript";
import {
  AskInterruptPrototype,
  askPrototypeVariant,
} from "./askPrototype/AskInterruptPrototype";
import { Composer } from "./Composer";
import { ModeLine } from "./ModeLine";
import { PermissionPrompt } from "./PermissionPrompt";
import { PlanPrompt } from "./PlanPrompt";
import { QuestionPrompt } from "./QuestionPrompt";

/**
 * The panel for an ask, chosen by the tool it is about: Claude's questions
 * (`AskUserQuestion`), a plan to approve (`ExitPlanMode`), or any other tool's permission. An
 * ask whose input is not what the tool sends (a newer Claude Code) is the permission panel,
 * which shows the input as it is rather than a guess at it.
 */
function AskDock({
  ask,
  more,
  conversation,
}: {
  ask: PermissionAsk;
  more: number;
  conversation: AgentConversation;
}) {
  const shared = {
    more,
    offline: conversation.reconnecting,
    onAnswer: conversation.answer,
  };
  if (ask.toolName === ASK_USER_QUESTION) {
    const questions = askedQuestions(ask.input);
    if (questions) return <QuestionPrompt ask={ask} questions={questions} {...shared} />;
  }
  if (ask.toolName === EXIT_PLAN_MODE) {
    const plan = askedPlan(ask.input);
    if (plan !== undefined) return <PlanPrompt ask={ask} plan={plan} {...shared} />;
  }
  return <PermissionPrompt ask={ask} cwd={conversation.header.folder} {...shared} />;
}

/**
 * What takes the input's place under the conversation. Normally it is the input box; while
 * Claude is waiting on an ask, the ask's panel takes over (`AskDock`). The input stays
 * mounted, only hidden, so what was typed before the ask came is still there when it goes,
 * and the box takes the keyboard back.
 *
 * The panel is keyed by the ask, so a panel's own state (a reply half typed, a question half
 * answered) is never carried over to the next ask.
 */
export function PromptDock({
  sessionId,
  conversation,
  focused,
}: {
  sessionId: string;
  conversation: AgentConversation;
  focused: boolean;
}) {
  const [ask, ...rest] = conversation.asks;
  // PROTOTYPE (#179): `?askproto=A|B|C` swaps the dock for the prototype's variants.
  if (askPrototypeVariant()) return <AskInterruptPrototype conversation={conversation} />;
  return (
    <>
      {ask && (
        <AskDock
          key={ask.requestId}
          ask={ask}
          more={rest.length}
          conversation={conversation}
        />
      )}
      <div className={ask === undefined ? "contents" : "hidden"}>
        <Composer
          key={sessionId}
          sessionId={sessionId}
          onSend={conversation.send}
          disabled={conversation.ended}
          offline={conversation.reconnecting}
          autoFocus={focused && ask === undefined}
          onShiftTab={conversation.cycleMode}
          history={conversation.history}
          working={conversation.state === "working"}
          interrupting={conversation.interrupting}
          onInterrupt={conversation.interrupt}
          commands={conversation.commands}
        />
      </div>
      {conversation.mode !== undefined && (
        <ModeLine
          mode={conversation.mode}
          onCycle={conversation.cycleMode}
          disabled={conversation.ended || conversation.reconnecting}
        />
      )}
    </>
  );
}
