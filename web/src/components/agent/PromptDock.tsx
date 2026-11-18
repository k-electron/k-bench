import type { AgentConversation } from "@/agent/useAgentConversation";
import { Composer } from "./Composer";
import { PermissionPrompt } from "./PermissionPrompt";

/**
 * What takes the input's place under the conversation. Normally it is the input box; while
 * Claude is waiting on an ask, the ask's card takes over (ticket #135: a bare Allow/Deny;
 * #146 and #147 give it Claude Code's panels). The input stays mounted, only hidden, so what
 * was typed before the ask came is still there when it goes, and the box takes the keyboard
 * back.
 */
export function PromptDock({
  conversation,
  focused,
}: {
  conversation: AgentConversation;
  focused: boolean;
}) {
  const [ask, ...rest] = conversation.asks;
  return (
    <>
      {ask && (
        <PermissionPrompt
          ask={ask}
          more={rest.length}
          offline={conversation.reconnecting}
          onAnswer={conversation.answer}
        />
      )}
      <div className={ask === undefined ? "contents" : "hidden"}>
        <Composer
          onSend={conversation.send}
          disabled={conversation.ended}
          offline={conversation.reconnecting}
          autoFocus={focused && ask === undefined}
        />
      </div>
    </>
  );
}
