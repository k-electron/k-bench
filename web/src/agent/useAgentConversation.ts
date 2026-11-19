import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { AgentHello, AgentStatus } from "../../../src/shared/agent-protocol.ts";
import { type AgentConnection, createAgentConnection } from "../agentConnection";
import { retryWhenAwake } from "../retryWhenAwake";
import { promptHistory } from "./prompts";
import {
  applyServerMessage,
  emptyTranscript,
  type PermissionAsk,
  permissionAsks,
  type TranscriptItem,
  transcriptItems,
} from "./transcript";

/** The agent WebSocket URL for a path from `agentPath`. */
function agentUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** A UUID for a prompt. `crypto.randomUUID` needs a secure context, which plain http on a LAN is not. */
function newPromptId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What a Claude Agent's Pane shows and does. */
export interface AgentConversation {
  /** The conversation so far, in order. */
  items: TranscriptItem[];
  /** The runtime's hello, once it has come: its versions. */
  hello: AgentHello | undefined;
  /** What the Agent is doing, once the runtime has said. */
  state: AgentStatus["state"] | undefined;
  /**
   * The Allow/Deny asks open now, oldest first. Empty when the Session is over: nothing can
   * answer them then.
   */
  asks: PermissionAsk[];
  /** The Session is over (deleted or Stopped): nothing more will arrive or be sent. */
  ended: boolean;
  /** The connection dropped and is retrying: what is shown may be behind, and nothing can be sent. */
  reconnecting: boolean;
  /** Sends a prompt as typed. False when it could not be sent (reconnecting), so the text should stay. */
  send(text: string): boolean;
  /**
   * Answers an open ask. False when it could not be sent (reconnecting): it is dropped, never
   * queued, so an answer cannot reach Claude after the owner has lost the connection and
   * forgotten the question, and the buttons stay for another try. True means sent, not
   * applied: the ask ends, here and on every device, when its entry arrives, and an answer
   * that came second is ignored without a word.
   */
  answer(requestId: string, decision: "allow" | "deny"): boolean;
  /**
   * Stops the turn that is running. False when nothing runs, when it could not be sent
   * (reconnecting: dropped, never queued), or when an interrupt is already on its way: a
   * second one would land on the next waiting prompt's turn, which the owner did not mean to
   * stop (holding Esc repeats).
   */
  interrupt(): boolean;
  /** An interrupt has been sent and the turn it stops has not ended yet. */
  interrupting: boolean;
  /** The prompts typed in this Agent, oldest first: what Up and Down in the input step through. */
  history: string[];
}

interface Model {
  transcript: typeof emptyTranscript;
  hello: AgentHello | undefined;
  state: AgentStatus["state"] | undefined;
  ended: boolean;
  reconnecting: boolean;
  /** How many turns had ended when the owner last interrupted. */
  interruptedAt: number | undefined;
}

type Event =
  | { type: "message"; message: Parameters<typeof applyServerMessage>[1] }
  | { type: "reconnecting"; on: boolean }
  | { type: "ended" }
  | { type: "interrupted" };

/** How many turns the log shows ended (each ends with a `result`). */
function turnsEnded(transcript: Model["transcript"]): number {
  return transcript.entries.filter(
    (entry) => entry.kind === "sdk" && entry.message.type === "result",
  ).length;
}

function reduce(model: Model, event: Event): Model {
  if (event.type === "interrupted") {
    return { ...model, interruptedAt: turnsEnded(model.transcript) };
  }
  if (event.type === "ended") return { ...model, ended: true, reconnecting: false };
  if (event.type === "reconnecting") return { ...model, reconnecting: event.on };
  const { message } = event;
  if (message.type === "hello") return { ...model, hello: message };
  if (message.type === "status") return { ...model, state: message.state };
  return { ...model, transcript: applyServerMessage(model.transcript, message) };
}

const NO_ASKS: PermissionAsk[] = [];

const initial: Model = {
  transcript: emptyTranscript,
  hello: undefined,
  state: undefined,
  ended: false,
  reconnecting: false,
  interruptedAt: undefined,
};

/** Connects to a Claude Agent for as long as the component is mounted. */
export function useAgentConversation(sessionId: string): AgentConversation {
  const [model, dispatch] = useReducer(reduce, initial);
  const connection = useRef<AgentConnection>(undefined);

  useEffect(() => {
    const opened = createAgentConnection({
      sessionId,
      openSocket: (path) => new WebSocket(agentUrl(path)),
      wake: retryWhenAwake,
    });
    connection.current = opened;
    const stop = opened.subscribe({
      message: (message) => dispatch({ type: "message", message }),
      reconnecting: (on) => dispatch({ type: "reconnecting", on }),
      ended: () => dispatch({ type: "ended" }),
    });
    return () => {
      stop();
      opened.close();
      connection.current = undefined;
    };
  }, [sessionId]);

  const send = useCallback(
    (text: string) =>
      connection.current?.send({ type: "prompt", id: newPromptId(), text }) ?? false,
    [],
  );

  const answer = useCallback(
    (requestId: string, decision: "allow" | "deny") =>
      connection.current?.send({ type: "answer", requestId, decision }) ?? false,
    [],
  );

  const interrupting =
    model.interruptedAt !== undefined &&
    model.interruptedAt === turnsEnded(model.transcript);

  const interrupt = useCallback(() => {
    if (model.ended || model.state !== "working" || interrupting) return false;
    if (!connection.current?.send({ type: "interrupt" })) return false;
    dispatch({ type: "interrupted" });
    return true;
  }, [model.ended, model.state, interrupting]);

  const history = useMemo(
    () => promptHistory(model.transcript.entries),
    [model.transcript],
  );
  const items = useMemo(() => transcriptItems(model.transcript), [model.transcript]);
  const allAsks = useMemo(() => permissionAsks(model.transcript), [model.transcript]);
  return {
    items,
    asks: model.ended ? NO_ASKS : allAsks,
    hello: model.hello,
    state: model.state,
    ended: model.ended,
    reconnecting: model.reconnecting,
    send,
    answer,
    interrupt,
    interrupting,
    history,
  };
}
