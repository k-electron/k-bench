import type { AgentSnapshot } from "../shared/agent-protocol.ts";

interface StreamEvent {
  type?: string;
  index?: number;
  message?: { id?: string };
  content_block?: { type?: string };
  delta?: { type?: string; text?: string };
}

/**
 * The text so far of the message now streaming in, kept so that a client that joins in the
 * middle of it (a reload, a second device) can be given it as one `snapshot` instead of
 * waiting for the next fragment. Fragments are never logged, so this is the only place the
 * text exists between the moment it streams and the complete message that replaces it.
 * Only top-level messages count: a subagent's fragments are never shown live.
 */
export class LiveText {
  private messageId: string | undefined;
  private readonly blocks = new Map<number, { type: string; text: string }>();

  /** Takes in a `stream_event` SDK message, as it is sent to the clients. */
  fragment(message: Record<string, unknown>): void {
    if (message.parent_tool_use_id != null) return;
    const event = message.event as StreamEvent | undefined;
    switch (event?.type) {
      case "message_start":
        this.clear();
        this.messageId = event.message?.id;
        break;
      case "content_block_start":
        if (this.messageId !== undefined && event.index !== undefined) {
          this.blocks.set(event.index, {
            type: event.content_block?.type ?? "",
            text: "",
          });
        }
        break;
      case "content_block_delta": {
        const block =
          event.index === undefined ? undefined : this.blocks.get(event.index);
        if (
          block &&
          event.delta?.type === "text_delta" &&
          event.delta.text !== undefined
        ) {
          block.text += event.delta.text;
        }
        break;
      }
      case "message_stop":
        this.clear();
        break;
    }
  }

  /** The turn ended: nothing is streaming, whatever the stream said. */
  turnEnded(): void {
    this.clear();
  }

  /** What is streaming now, or undefined when nothing is. */
  snapshot(): AgentSnapshot | undefined {
    if (this.messageId === undefined) return undefined;
    return {
      type: "snapshot",
      messageId: this.messageId,
      blocks: [...this.blocks]
        .sort(([a], [b]) => a - b)
        .map(([index, { type, text }]) => ({ index, type, text })),
    };
  }

  private clear(): void {
    this.messageId = undefined;
    this.blocks.clear();
  }
}
