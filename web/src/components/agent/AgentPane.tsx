import { useEffect, useRef } from "react";
import { contextLeftPercent, currentActivity } from "@/agent/activity";
import { useAgentConversation } from "@/agent/useAgentConversation";
import type { SessionState } from "../../../../src/shared/state-protocol.ts";
import { AgentHeader } from "./AgentHeader";
import { PromptDock } from "./PromptDock";
import { StatusLine } from "./StatusLine";
import { Transcript } from "./Transcript";

/** How near the bottom the conversation must be scrolled for new text to keep it there. */
const STICK_TO_BOTTOM_PX = 80;

/**
 * A Claude Agent's Pane: the header line, the conversation in Claude TUI's shape (`Transcript`),
 * the status line and the input under it. The conversation comes from the Agent Runtime over
 * the agent WebSocket; this holds none of it that a reload would lose.
 */
export function AgentPane({
  session,
  focused,
}: {
  session: SessionState;
  focused: boolean;
}) {
  const conversation = useAgentConversation(session.id);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const { items } = conversation;

  // Follows the conversation down while the owner is at the bottom; once they scroll up to
  // read, it stays where they are.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the conversation grows
  useEffect(() => {
    const element = scroller.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [items]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentHeader {...conversation.header} />
      <div
        ref={scroller}
        role="log"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto p-3"
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          atBottom.current =
            scrollHeight - scrollTop - clientHeight <= STICK_TO_BOTTOM_PX;
        }}
      >
        <Transcript items={items} />
      </div>
      <StatusLine
        working={conversation.state === "working" && !conversation.ended}
        activity={currentActivity(items)}
        turnStartedAt={conversation.turnStartedAt}
        contextLeft={contextLeftPercent(conversation.context)}
      />
      {conversation.reconnecting && !conversation.ended && (
        <p role="status" className="shrink-0 px-3 pb-1 text-xs text-muted-foreground">
          Reconnecting…
        </p>
      )}
      {conversation.ended && (
        <p role="status" className="shrink-0 px-3 pb-1 text-xs text-muted-foreground">
          This Session has ended.
        </p>
      )}
      <PromptDock conversation={conversation} focused={focused} />
    </div>
  );
}
