import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  type AgentCommand,
  type AgentContextUsage,
  type AgentHello,
  type AgentStatus,
  type LogEntry,
  nextPermissionMode,
  type PermissionMode,
  type PermissionReply,
} from "../../../src/shared/agent-protocol.ts";
import { claudeVersionWarning } from "../../../src/shared/claude-version.ts";
import { type AgentConnection, createAgentConnection } from "../agentConnection";
import { pageViewing } from "../pageViewing";
import { retryWhenAwake } from "../retryWhenAwake";
import { promptHistory } from "./prompts";
import {
  applyServerMessage,
  emptyTranscript,
  hasEarlier,
  type PermissionAsk,
  permissionAsks,
  type TranscriptItem,
  transcriptInfo,
  transcriptItems,
} from "./transcript";

/** How many turns of older history one scroll-back request asks for. */
const EARLIER_TURNS = 20;

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
  /** The log entries received, in order: what the raw view (#137) shows. */
  entries: readonly LogEntry[];
  /** The runtime's hello, once it has come: its versions. */
  hello: AgentHello | undefined;
  /** What the Agent is doing, once the runtime has said. */
  state: AgentStatus["state"] | undefined;
  /** While working: when the turn began (the runtime's clock, ms since the epoch). */
  turnStartedAt: number | undefined;
  /** How full Claude Code's context is, once it has reported. */
  context: AgentContextUsage | undefined;
  /**
   * What the header line shows: Claude Code's version (from the runtime's hello), and the
   * model and folder of the latest turn (from its `system/init`, so the model is absent before
   * the first prompt, and the folder then comes from the hello).
   */
  header: {
    version?: string;
    /** Set only when that `claude` is older than the Claude Code the Agent SDK was made for. */
    versionWarning?: string;
    model?: string;
    folder?: string;
  };
  /** Whether Claude Code is in Focus view: the Transcript shows a tool call as one line. */
  focusView: boolean;
  /**
   * The Allow/Deny asks open now, oldest first. Empty when the Session is over: nothing can
   * answer them then.
   */
  asks: PermissionAsk[];
  /** Claude Code's permission mode, once the runtime has said. The same on every device. */
  mode: PermissionMode | undefined;
  /**
   * Switches to the next permission mode in Claude TUI's order. False when it could not be
   * sent (reconnecting, or no mode known yet): the mode line stays as it is. True means sent,
   * not applied: the line changes, here and on every device, when the runtime says so.
   */
  cycleMode(): boolean;
  /** The Session is over (deleted or Stopped): nothing more will arrive or be sent. */
  ended: boolean;
  /**
   * Why the Agent is Stopped, when this is the read-only Transcript of one that is (served
   * from its log on disk): the Pane shows it with Restart where the input was. Undefined for
   * a running Agent.
   */
  stoppedReason: string | undefined;
  /**
   * Where the history held begins (undefined before the first replay). A page opens with only
   * the latest turns; `loadEarlier` brings the rest, lowering this, until `hasEarlier` is false.
   */
  earliestSeq: number | undefined;
  /** There is older history than what is held. */
  hasEarlier: boolean;
  /** A `loadEarlier` request is waiting for its answer. */
  loadingEarlier: boolean;
  /**
   * Asks for the turns before what is held. Does nothing while one is already asked for, when
   * there is nothing earlier, or while reconnecting (the request would be dropped; ask again
   * once the connection is back).
   */
  loadEarlier(): void;
  /** The connection dropped and is retrying: what is shown may be behind, and nothing can be sent. */
  reconnecting: boolean;
  /**
   * Sends a prompt as typed, with the stored names of the images attached to it. False when
   * it could not be sent (reconnecting), so the text should stay.
   */
  send(text: string, images?: string[]): boolean;
  /**
   * Answers an open ask. False when it could not be sent (reconnecting): it is dropped, never
   * queued, so an answer cannot reach Claude after the owner has lost the connection and
   * forgotten the question, and the buttons stay for another try. True means sent, not
   * applied: the ask ends, here and on every device, when its entry arrives, and an answer
   * that came second is ignored without a word.
   */
  answer(requestId: string, reply: PermissionReply): boolean;
  /**
   * Stops the turn that is running. False when nothing runs, when it could not be sent
   * (reconnecting: dropped, never queued), or when an interrupt is already on its way: a
   * second one would land on the next waiting prompt's turn, which the owner did not mean to
   * stop (holding Esc repeats).
   */
  interrupt(): boolean;
  /** An interrupt has been sent and the turn it stops has not ended yet. */
  interrupting: boolean;
  /**
   * Stops one subagent or background task (#149), by its `task_id`, and nothing else. False
   * when it could not be sent (reconnecting: dropped, never queued). True means sent: the
   * task's line changes when Claude Code says it stopped.
   */
  stopTask(taskId: string): boolean;
  /** The prompts typed in this Agent, oldest first: what Up and Down in the input step through. */
  history: string[];
  /** What the `/` menu offers (#150), as the runtime last said; empty until it has. */
  commands: readonly AgentCommand[];
}

interface Model {
  transcript: typeof emptyTranscript;
  hello: AgentHello | undefined;
  state: AgentStatus["state"] | undefined;
  mode: PermissionMode | undefined;
  turnStartedAt: number | undefined;
  context: AgentContextUsage | undefined;
  commands: readonly AgentCommand[];
  ended: boolean;
  reconnecting: boolean;
  /** The `beforeSeq` of the page request waiting for its answer, if one is. */
  requestedBefore: number | undefined;
  /** How many turns had ended when the owner last interrupted. */
  interruptedAt: number | undefined;
}

type Event =
  | { type: "message"; message: Parameters<typeof applyServerMessage>[1] }
  | { type: "reconnecting"; on: boolean }
  | { type: "requestedEarlier"; before: number }
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
  if (event.type === "reconnecting") {
    // A request in flight may be lost with the socket: ask again once it is back.
    return { ...model, reconnecting: event.on, requestedBefore: undefined };
  }
  if (event.type === "requestedEarlier")
    return { ...model, requestedBefore: event.before };
  const { message } = event;
  if (message.type === "hello") return { ...model, hello: message };
  if (message.type === "commands") return { ...model, commands: message.commands };
  if (message.type === "status") {
    return {
      ...model,
      state: message.state,
      mode: message.mode ?? model.mode,
      turnStartedAt: message.turnStartedAt,
      context: message.context,
    };
  }
  return { ...model, transcript: applyServerMessage(model.transcript, message) };
}

const NO_ASKS: PermissionAsk[] = [];
const NO_COMMANDS: readonly AgentCommand[] = [];

const initial: Model = {
  transcript: emptyTranscript,
  hello: undefined,
  state: undefined,
  mode: undefined,
  turnStartedAt: undefined,
  context: undefined,
  commands: NO_COMMANDS,
  ended: false,
  reconnecting: false,
  requestedBefore: undefined,
  interruptedAt: undefined,
};

/** Connects to a Claude Agent for as long as the component is mounted. */
export function useAgentConversation(sessionId: string): AgentConversation {
  const [model, dispatch] = useReducer(reduce, initial);
  const connection = useRef<AgentConnection>(undefined);
  const latest = useRef(model);
  latest.current = model;

  useEffect(() => {
    const opened = createAgentConnection({
      sessionId,
      openSocket: (path) => new WebSocket(agentUrl(path)),
      wake: retryWhenAwake,
      viewing: pageViewing,
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
    (text: string, images: string[] = []) =>
      connection.current?.send({
        type: "prompt",
        id: newPromptId(),
        text,
        ...(images.length > 0 && { images }),
      }) ?? false,
    [],
  );

  const answer = useCallback(
    (requestId: string, reply: PermissionReply) =>
      connection.current?.send({ type: "answer", requestId, ...reply }) ?? false,
    [],
  );

  const stopTask = useCallback(
    (taskId: string) => connection.current?.send({ type: "stop_task", taskId }) ?? false,
    [],
  );

  const loadEarlier = useCallback(() => {
    const { transcript, requestedBefore } = latest.current;
    const before = transcript.earliestSeq;
    if (before === undefined || !hasEarlier(transcript) || requestedBefore === before) {
      return;
    }
    if (
      connection.current?.send({ type: "page", beforeSeq: before, limit: EARLIER_TURNS })
    ) {
      dispatch({ type: "requestedEarlier", before });
    }
  }, []);

  // Asks for the mode after the one shown: a target, so two devices tapping at once agree.
  const mode = model.mode;
  const cycleMode = useCallback(
    () =>
      mode !== undefined &&
      (connection.current?.send({
        type: "set_permission_mode",
        mode: nextPermissionMode(mode),
      }) ??
        false),
    [mode],
  );

  const { stoppedReason } = model.transcript;
  const ended = model.ended || stoppedReason !== undefined;

  const interrupting =
    model.interruptedAt !== undefined &&
    model.interruptedAt === turnsEnded(model.transcript);

  const interrupt = useCallback(() => {
    if (ended || model.state !== "working" || interrupting) return false;
    if (!connection.current?.send({ type: "interrupt" })) return false;
    dispatch({ type: "interrupted" });
    return true;
  }, [ended, model.state, interrupting]);

  const history = useMemo(
    () => promptHistory(model.transcript.entries),
    [model.transcript],
  );

  const items = useMemo(() => transcriptItems(model.transcript), [model.transcript]);
  const allAsks = useMemo(() => permissionAsks(model.transcript), [model.transcript]);
  const info = useMemo(() => transcriptInfo(model.transcript), [model.transcript]);
  const { hello } = model;
  const folder = info.cwd ?? hello?.folder;
  const versionWarning = hello
    ? claudeVersionWarning(hello.claudeVersion, hello.sdkClaudeCodeVersion)
    : undefined;
  return {
    items,
    focusView: info.focusView,
    header: {
      ...(hello ? { version: hello.claudeVersion } : {}),
      ...(versionWarning === undefined ? {} : { versionWarning }),
      ...(info.model === undefined ? {} : { model: info.model }),
      ...(folder === undefined ? {} : { folder }),
    },
    turnStartedAt: model.turnStartedAt,
    context: model.context,
    entries: model.transcript.entries,
    // A Stopped Agent has no open asks, whatever its log says: nothing can answer them.
    asks: ended ? NO_ASKS : allAsks,
    hello,
    state: model.state,
    mode,
    cycleMode,
    ended,
    stoppedReason,
    reconnecting: model.reconnecting,
    earliestSeq: model.transcript.earliestSeq,
    hasEarlier: hasEarlier(model.transcript),
    loadingEarlier:
      model.requestedBefore !== undefined &&
      model.requestedBefore === model.transcript.earliestSeq,
    loadEarlier,
    send,
    answer,
    interrupt,
    interrupting,
    stopTask,
    history,
    commands: model.commands,
  };
}
