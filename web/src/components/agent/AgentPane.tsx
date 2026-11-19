import { useLayoutEffect, useMemo, useRef } from "react";
import { contextLeftPercent, currentActivity } from "@/agent/activity";
import { useAgentConversation } from "@/agent/useAgentConversation";
import type { SessionState } from "../../../../src/shared/state-protocol.ts";
import { AgentHeader } from "./AgentHeader";
import { PromptDock } from "./PromptDock";
import { RawSwitch, RawTranscript, useRawView } from "./RawView";
import { StatusLine } from "./StatusLine";
import { StopTaskProvider } from "./TaskLine";
import { Transcript } from "./Transcript";
import { useScrollBack } from "./useScrollBack";

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
  const { items, entries } = conversation;
  const rawView = useRawView();
  const { stopTask: stop, reconnecting, ended } = conversation;
  // One value until the connection changes, so streaming text does not redraw every task line.
  const stopTask = useMemo(
    () => ({ stop, disabled: reconnecting || ended }),
    [stop, reconnecting, ended],
  );
  const sentinel = useScrollBack({
    scroller,
    earliestSeq: conversation.earliestSeq,
    canLoad:
      conversation.hasEarlier &&
      !conversation.loadingEarlier &&
      !conversation.reconnecting,
    loadEarlier: conversation.loadEarlier,
  });

  // Follows the conversation down while the owner is at the bottom; once they scroll up to
  // read, it stays where they are. Before the paint, so the latest turns are what a page
  // shows from its first frame, not the top of the history.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the conversation grows
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [items, rawView.all]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentHeader
        {...conversation.header}
        trailing={<RawSwitch on={rawView.all} onChange={rawView.setAll} />}
      />
      <div
        ref={scroller}
        role="log"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto p-3 [overflow-anchor:none]"
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          atBottom.current =
            scrollHeight - scrollTop - clientHeight <= STICK_TO_BOTTOM_PX;
        }}
      >
        <div ref={sentinel} aria-hidden="true" className="h-px" />
        {rawView.all ? (
          <RawTranscript entries={entries} />
        ) : (
          <StopTaskProvider value={stopTask}>
            <Transcript items={items} entries={entries} rawView={rawView} />
          </StopTaskProvider>
        )}
      </div>
      {conversation.loadingEarlier && (
        <p role="status" className="shrink-0 px-3 pb-1 text-xs text-muted-foreground">
          Loading earlier messages…
        </p>
      )}
      <StatusLine
        working={conversation.state !== "idle" && conversation.state !== undefined}
        waiting={conversation.state === "waiting"}
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
      <PromptDock sessionId={session.id} conversation={conversation} focused={focused} />
    </div>
  );
}
