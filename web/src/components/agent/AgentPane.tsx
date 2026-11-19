import { useEffect, useRef } from "react";
import { useAgentConversation } from "@/agent/useAgentConversation";
import { cn } from "@/lib/utils";
import type { SessionState } from "../../../../src/shared/state-protocol.ts";
import { PromptDock } from "./PromptDock";
import {
  RawMessage,
  RawSwitch,
  RawTranscript,
  ShowRawProvider,
  useRawView,
} from "./RawView";

/** How near the bottom the conversation must be scrolled for new text to keep it there. */
const STICK_TO_BOTTOM_PX = 80;

/**
 * A Claude Agent's Pane: the conversation, as plain text for now (ticket #136 gives it Claude
 * Code's shape), and the input under it. The conversation comes from the Agent Runtime over
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
  const { items, entries } = conversation;
  const rawView = useRawView();

  // Follows the conversation down while the owner is at the bottom; once they scroll up to
  // read, it stays where they are.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the conversation grows
  useEffect(() => {
    const element = scroller.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [items, rawView.all]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b px-3 py-1">
        <RawSwitch on={rawView.all} onChange={rawView.setAll} />
      </div>
      <div
        ref={scroller}
        role="log"
        aria-label="Conversation"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm"
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          atBottom.current =
            scrollHeight - scrollTop - clientHeight <= STICK_TO_BOTTOM_PX;
        }}
      >
        {rawView.all ? (
          <RawTranscript entries={entries} />
        ) : (
          <ShowRawProvider value={rawView.show}>
            {items.map((item) => (
              <RawMessage
                key={item.key}
                seq={item.seq}
                entries={entries}
                rawView={rawView}
              >
                <p
                  className={cn(
                    "break-words whitespace-pre-wrap",
                    item.kind === "prompt" && "rounded-md bg-muted px-3 py-2",
                  )}
                >
                  {item.text}
                </p>
              </RawMessage>
            ))}
          </ShowRawProvider>
        )}
      </div>
      {conversation.state === "working" && (
        <p role="status" className="shrink-0 px-3 pb-1 text-xs text-muted-foreground">
          Claude is working…
        </p>
      )}
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
