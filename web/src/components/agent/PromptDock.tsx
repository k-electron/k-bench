import type { AgentConversation } from "@/agent/useAgentConversation";
import { Composer } from "./Composer";
import { ModeLine } from "./ModeLine";
import { PermissionPrompt } from "./PermissionPrompt";

/**
 * What takes the input's place under the conversation. Normally it is the input box; while
 * Claude is waiting on an ask, the ask's panel takes over. The input stays mounted, only
 * hidden, so what was typed before the ask came is still there when it goes, and the box
 * takes the keyboard back.
 *
 * The panel is chosen by the ask: today every ask is a permission ask (`PermissionPrompt`);
 * #147 gives AskUserQuestion and plan approval their own panels here, chosen by `toolName`,
 * built from the same `AskPanel` parts. Keyed by the ask, so a panel's own state (a reply
 * half typed) is never carried over to the next ask.
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
  return (
    <>
      {ask && (
        <PermissionPrompt
          key={ask.requestId}
          ask={ask}
          cwd={conversation.header.folder}
          more={rest.length}
          offline={conversation.reconnecting}
          onAnswer={conversation.answer}
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
