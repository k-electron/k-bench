// A stand-in for Claude Code when the Agent SDK drives it over stdio (the real `claude` run
// as `claude --input-format stream-json ...`). `fake-claude.sh` hands over to this file for
// those runs; the Claude TUI stand-in is the rest of that script. Plain JavaScript with no
// imports beyond Node's, because it runs under the `node` linked beside it, outside Vitest.
//
// What it says comes from messages recorded from a real Claude Code (fixtures/messages.json,
// docs/internals/test-seams.md): each message it sends is a recorded one with the values the
// test chose filled in. A test steers it through files beside this one, which `FakeClaude` in
// fake-claude.ts writes and reads:
//   config.json    what the fake is (account, version, plugins, commands, ...)
//   script/        turns the test has scripted, taken in order by prompts; `auto` turns
//                  start by themselves, as /loop's do; `release-<name>` ends a `hold`
//   received.jsonl everything the fake was started with and received, one JSON per line
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const scriptDir = join(root, "script");
const conversations = join(root, "conversations");
const fixture = JSON.parse(readFileSync(join(root, "fixtures", "messages.json"), "utf8"));
mkdirSync(conversations, { recursive: true });

// ---- What it receives, and the environment it keeps -------------------------------------

/** The few variables the SDK sets that tests assert on. Never the whole environment. */
const ENV_KEPT = [
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
  "CLAUDE_CODE_SDK_READS_SESSION_STATE",
  "CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS",
  "CLAUDE_CODE_DISABLE_ADVISOR_TOOL",
];
const received = (entry) =>
  appendFileSync(join(root, "received.jsonl"), `${JSON.stringify(entry)}\n`);

function readConfig() {
  try {
    return JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const argv = process.argv.slice(2);
/** `--name=value` or `--name value`. */
function flag(name) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}`) return argv[i + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return undefined;
}
const hasFlag = (name) =>
  argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

received({
  kind: "start",
  pid: process.pid,
  cwd: process.cwd(),
  argv,
  env: Object.fromEntries(ENV_KEPT.map((name) => [name, process.env[name]])),
});

// Like Claude Code: a conversation is saved once a message has been sent into it.
// `--resume=<id>` of one never saved, and `--session-id=<id>` of one saved, each fail.
const resumeId = flag("resume");
const freshId = flag("session-id");
if (resumeId && !existsSync(join(conversations, resumeId))) {
  fail(`No conversation found with session ID: ${resumeId}`, 1);
}
if (freshId && existsSync(join(conversations, freshId))) {
  fail(`Session ID ${freshId} is already in use.`, 1);
}
let sessionId = resumeId ?? freshId ?? randomUUID();

function fail(text, code) {
  process.stderr.write(`${text}\n`, () => process.exit(code));
}

function quit(code) {
  process.stdout.write("", () => process.exit(code));
}

// ---- Sending ----------------------------------------------------------------------------

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

/** A recorded message with this session's ids and the values `changes` sets. */
function make(template, changes = {}) {
  const message = structuredClone(template);
  for (const key of ["user_message_uuid", "user_message_uuids", "timestamp"]) {
    delete message[key];
  }
  if ("session_id" in message || message.type !== "control_request") {
    message.session_id = sessionId;
  }
  if (message.type !== "control_request") message.uuid = randomUUID();
  return Object.assign(message, changes);
}

const system = (subtype, fields = {}) =>
  send({ type: "system", subtype, ...fields, session_id: sessionId, uuid: randomUUID() });

const stateEvents = () =>
  Boolean(
    process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS ||
      process.env.CLAUDE_CODE_SDK_READS_SESSION_STATE,
  );
const sessionState = (state) => {
  if (stateEvents()) send(make(fixture.sessionState, { state }));
};

// ---- Waiting (no timers a test could mistake for a sleep: polling is the harness's way) --

function until(check, everyMs = 20) {
  return new Promise((resolve) => {
    const done = (value) => {
      clearInterval(timer);
      resolve(value);
    };
    const timer = setInterval(() => {
      const value = check();
      if (value) done(value);
    }, everyMs);
    const value = check();
    if (value) done(value);
  });
}

// ---- Turns ------------------------------------------------------------------------------

class Interrupted extends Error {}

const prompts = [];
let busy = false;
let interrupted = false;
let firstTurn = true;
let permissionMode = flag("permission-mode") ?? "default";
let model = flag("model");
/** What the SDK answered to the permission asks, by request id. */
const answers = new Map();
const mark = () => {
  if (interrupted) throw new Interrupted();
};

function takeScript(auto) {
  if (!existsSync(scriptDir)) return undefined;
  for (const name of readdirSync(scriptDir).sort()) {
    if (!name.endsWith(".json") || name.startsWith("release-")) continue;
    const file = join(scriptDir, name);
    let turn;
    try {
      turn = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // being written
    }
    if (Boolean(turn.auto) !== auto) continue;
    rmSync(file, { force: true });
    return turn;
  }
  return undefined;
}

function viewMode() {
  try {
    return JSON.parse(flag("settings") ?? "{}").viewMode ?? "default";
  } catch {
    return "default";
  }
}

function startOfTurn() {
  system("status", { status: "requesting" });
  if (firstTurn) send(make(fixture.rateLimit));
  firstTurn = false;
}

function sendInit(config) {
  send(
    make(fixture.init, {
      cwd: process.cwd(),
      original_cwd: process.cwd(),
      claude_code_version: config.version ?? fixture.init.claude_code_version,
      model: config.model ?? model ?? fixture.init.model,
      permissionMode,
      plugins: config.plugins ?? [],
      slash_commands: (
        config.commands ?? fixture.initializeReply.response.response.commands
      ).map((c) => c.name),
      terminal_slash_commands: config.terminalSlashCommands ?? [],
      view_mode: viewMode(),
      ...(config.initFields ?? {}),
    }),
  );
}

/** What one turn is sending, so steps can add to the reply Claude is streaming. */
function newTurn(prompt) {
  return {
    prompt,
    messageId: undefined,
    blocks: [],
    stamped: false,
    resultFields: {},
  };
}

function openMessage(turn) {
  if (turn.messageId) return;
  turn.messageId = `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  turn.blocks = [];
  const start = make(fixture.messageStart);
  start.event.message.id = turn.messageId;
  start.api_message_id = turn.messageId;
  stamp(turn, start);
  send(start);
}

function stamp(turn, message) {
  const uuid = turn.prompt?.uuid;
  if (uuid && !turn.stamped) {
    message.user_message_uuid = uuid;
    message.user_message_uuids = [uuid];
  }
}

/** The assistant frame for the block just streamed: one frame per block, as Claude Code does. */
function assistantFrame(turn, template, block) {
  const frame = make(template);
  frame.message.id = turn.messageId;
  frame.message.content = [block];
  stamp(turn, frame);
  turn.stamped = true;
  send(frame);
}

function closeMessage(turn, stopReason) {
  if (!turn.messageId) return;
  const delta = make(fixture.messageDelta);
  delta.event.delta.stop_reason = stopReason;
  send(delta);
  send(make(fixture.messageStop));
  turn.messageId = undefined;
}

async function streamText(turn, fragments) {
  openMessage(turn);
  const index = turn.blocks.length;
  const open = { type: "text", text: "" };
  turn.blocks.push(open);
  turn.open = open;
  const begin = make(fixture.textStart);
  begin.event.index = index;
  send(begin);
  for (const part of fragments) {
    mark();
    if (typeof part === "object") {
      await waitForRelease(part.hold);
      continue;
    }
    open.text += part;
    const delta = make(fixture.textDelta);
    delta.event.index = index;
    delta.event.delta.text = part;
    send(delta);
  }
  mark();
  assistantFrame(turn, fixture.assistantText, { type: "text", text: open.text });
  const stop = make(fixture.blockStop);
  stop.event.index = index;
  send(stop);
  turn.open = undefined;
}

function streamThinking(turn) {
  openMessage(turn);
  const index = turn.blocks.length;
  turn.blocks.push({ type: "thinking" });
  const begin = make(fixture.thinkingStart);
  begin.event.index = index;
  send(begin);
  const delta = make(fixture.thinkingDelta);
  delta.event.index = index;
  send(delta);
  assistantFrame(turn, fixture.assistantThinking, {
    type: "thinking",
    thinking: "",
    signature: "ZmFrZS1zaWduYXR1cmU=",
  });
  const stop = make(fixture.blockStop);
  stop.event.index = index;
  send(stop);
}

function waitForRelease(name) {
  const file = join(scriptDir, `release-${name}`);
  return until(() => interrupted || existsSync(file)).then(() => {
    mark();
    rmSync(file, { force: true });
  });
}

async function runTool(turn, step) {
  const {
    name,
    input = {},
    id = `toolu_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
  } = step.tool;
  openMessage(turn);
  const index = turn.blocks.length;
  turn.blocks.push({ type: "tool_use" });
  const begin = make(fixture.toolStart);
  begin.event.index = index;
  begin.event.content_block.id = id;
  begin.event.content_block.name = name;
  send(begin);
  const json = JSON.stringify(input);
  for (const part of [
    json.slice(0, Math.ceil(json.length / 2)),
    json.slice(Math.ceil(json.length / 2)),
  ]) {
    const delta = make(fixture.toolDelta);
    delta.event.index = index;
    delta.event.delta.partial_json = part;
    send(delta);
  }
  assistantFrame(turn, fixture.assistantToolUse, {
    type: "tool_use",
    id,
    name,
    input,
    caller: { type: "direct" },
  });
  const stop = make(fixture.blockStop);
  stop.event.index = index;
  send(stop);
  closeMessage(turn, "tool_use");

  let allowed = true;
  let answer;
  if (step.ask) {
    const options = step.ask === true ? {} : step.ask;
    sessionState("requires_action");
    const requestId = randomUUID();
    const request = make(fixture.canUseTool, { request_id: requestId });
    request.request = {
      ...request.request,
      tool_name: name,
      display_name: name,
      input,
      description: options.description ?? name,
      permission_suggestions: options.suggestions ?? [],
      tool_use_id: id,
      ...(options.extra ?? {}),
    };
    send(request);
    await until(() => interrupted || answers.has(requestId));
    mark();
    const response = answers.get(requestId);
    answers.delete(requestId);
    sessionState("running");
    answer = response?.response;
    allowed = answer?.behavior === "allow";
    // Claude Code echoes the decision back before the tool's result.
    send({ type: "control_response", response });
  }
  const failed = !allowed || step.isError === true;
  const content = !allowed
    ? (answer?.message ?? "The user doesn't want to proceed.")
    : (step.result ??
      (answer?.updatedInput?.answers
        ? `Your questions have been answered: ${JSON.stringify(answer.updatedInput.answers)}`
        : "ok"));
  const result = make(failed ? fixture.toolResultDenied : fixture.toolResultAnswered);
  result.message.content = [
    {
      type: "tool_result",
      tool_use_id: id,
      content,
      ...(failed ? { is_error: true } : {}),
    },
  ];
  delete result.tool_result_meta;
  result.tool_use_result = step.toolUseResult ?? (failed ? `Error: ${content}` : content);
  send(result);
  system("status", { status: "requesting" });
}

async function runStep(turn, step) {
  mark();
  if (step.text !== undefined) {
    const fragments = Array.isArray(step.text)
      ? step.text
      : (step.text.match(/\S+\s*/g) ?? [""]);
    await streamText(turn, fragments);
  } else if (step.thinking) {
    streamThinking(turn);
  } else if (step.tool) {
    await runTool(turn, step);
  } else if (step.hold) {
    await waitForRelease(step.hold);
  } else if (step.raw) {
    send({ session_id: sessionId, uuid: randomUUID(), ...step.raw });
  } else if (step.system) {
    const { subtype, ...fields } = step.system;
    system(subtype, fields);
  } else if (step.reset) {
    reset(turn);
  } else if (step.result) {
    Object.assign(turn.resultFields, step.result);
  } else if (step.exit !== undefined) {
    if (step.stderr) process.stderr.write(`${step.stderr}\n`);
    process.stderr.write("", () => quit(step.exit));
    await new Promise(() => {});
  } else {
    throw new Error(`unknown script step: ${JSON.stringify(step)}`);
  }
}

/** `/clear`: the conversation resets, and the next init carries a new session id. */
function reset(turn) {
  turn.messageId = undefined;
  send(make(fixture.conversationReset, { new_conversation_id: randomUUID() }));
  send(make(fixture.backgroundTasksChanged));
  sessionId = randomUUID();
  sendInit(readConfig());
  turn.cleared = true;
}

function saveConversation() {
  writeFileSync(join(conversations, sessionId), "");
}

async function runTurn(prompt, scripted) {
  const config = readConfig();
  const turn = newTurn(prompt);
  sessionState("running");
  if (prompt?.uuid) {
    send({
      type: "command_lifecycle",
      command_uuid: prompt.uuid,
      state: "started",
      session_id: sessionId,
      uuid: randomUUID(),
    });
  }
  const text = promptText(prompt);
  const clearing = isClear(prompt);
  if (!clearing) {
    sendInit(config);
    startOfTurn();
    if (prompt) saveConversation();
  }
  if (prompt?.uuid && hasFlag("replay-user-messages") && !clearing) {
    send(make(fixture.userEcho, { uuid: prompt.uuid, message: prompt.message }));
  }
  let result = { ...fixture.resultSuccess };
  try {
    if (clearing) {
      reset(turn);
      send(make(fixture.clearEcho, { uuid: prompt.uuid }));
      result = { ...fixture.resultClear };
    } else {
      const steps = scripted?.steps ?? [{ text: `fake claude heard: ${text}` }];
      for (const step of steps) await runStep(turn, step);
      mark();
      closeMessage(turn, "end_turn");
    }
  } catch (error) {
    if (!(error instanceof Interrupted)) throw error;
    result = { ...fixture.resultInterrupted };
    if (turn.open) {
      const aborted = make(fixture.assistantAborted);
      aborted.message.content = [{ type: "text", text: turn.open.text }];
      if (turn.messageId) aborted.message.id = turn.messageId;
      send(aborted);
    }
    send(make(fixture.userInterrupted));
    if (turn.messageId) closeMessage(turn, null);
  }
  send(
    make(result, {
      session_id: sessionId,
      result: text ? `fake claude heard: ${text}` : "",
      ...turn.resultFields,
    }),
  );
  if (prompt?.uuid) {
    send({
      type: "command_lifecycle",
      command_uuid: prompt.uuid,
      state: "completed",
      session_id: sessionId,
      uuid: randomUUID(),
    });
  }
}

const isClear = (prompt) => Boolean(prompt) && /^\/clear\b/.test(promptText(prompt));

function promptText(prompt) {
  const content = prompt?.message?.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const prompt = prompts.shift();
      if (prompt) {
        interrupted = false;
        // Claude Code handles /clear itself, with no turn: it takes no script.
        await runTurn(prompt, isClear(prompt) ? undefined : takeScript(false));
      } else {
        const auto = takeScript(true);
        if (!auto) break;
        interrupted = false;
        await runTurn(undefined, auto);
      }
      if (prompts.length === 0) sessionState("idle");
    }
  } finally {
    busy = false;
  }
}

// ---- Control requests -------------------------------------------------------------------

function respond(requestId, response) {
  send({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response },
  });
}

const ANSWERED_WITH_NOTHING = new Set([
  "set_max_thinking_tokens",
  "background_tasks",
  "stop_task",
  "rewind_files",
  "apply_flag_settings",
  "mcp_status",
  "cancel_async_message",
]);

function onControlRequest(message) {
  const request = message.request;
  const config = readConfig();
  switch (request.subtype) {
    case "initialize": {
      const reply = structuredClone(fixture.initializeReply.response.response);
      Object.assign(reply, {
        account: config.account ?? reply.account,
        claude_code_version: config.version ?? reply.claude_code_version,
        commands: config.commands ?? reply.commands,
        current_permission_mode: permissionMode,
        pid: process.pid,
      });
      respond(message.request_id, reply);
      break;
    }
    case "interrupt":
      respond(message.request_id, {});
      received({ kind: "interrupted", busy });
      if (busy) interrupted = true;
      break;
    case "set_permission_mode":
      permissionMode = request.mode;
      respond(message.request_id, {});
      break;
    case "set_model":
      model = request.model;
      respond(message.request_id, {});
      break;
    case "get_context_usage":
      // `contextUsage: null` is a Claude Code too old to know the request.
      if (config.contextUsage === null) {
        send({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: message.request_id,
            error: "Unsupported control request subtype: get_context_usage",
          },
        });
        break;
      }
      respond(
        message.request_id,
        config.contextUsage ?? {
          categories: [],
          totalTokens: 20000,
          maxTokens: 200000,
          percentage: 10,
          autoCompactThreshold: 160000,
          isAutoCompactEnabled: true,
        },
      );
      break;
    default:
      if (ANSWERED_WITH_NOTHING.has(request.subtype)) respond(message.request_id, {});
      else {
        send({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: message.request_id,
            error: `Unsupported control request subtype: ${request.subtype}`,
          },
        });
      }
  }
}

// ---- Input ------------------------------------------------------------------------------

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    received({ kind: "unreadable", line });
    return;
  }
  if (message.type === "control_request") {
    received({ kind: "control_request", message });
    onControlRequest(message);
  } else if (message.type === "control_response") {
    received({ kind: "control_response", message });
    answers.set(message.response?.request_id, message.response);
  } else if (message.type === "user") {
    received({ kind: "prompt", message });
    prompts.push(message);
    if (message.uuid) {
      send({
        type: "command_lifecycle",
        command_uuid: message.uuid,
        state: "queued",
        session_id: sessionId,
        uuid: randomUUID(),
      });
    }
    void pump();
  } else {
    received({ kind: "other", message });
  }
});

// The SDK closing stdin is how it closes the fake; Claude Code exits then.
process.stdin.on("end", () => {
  received({ kind: "closed" });
  quit(0);
});
process.on("SIGTERM", () => {
  received({ kind: "terminated" });
  quit(143);
});

// Turns nobody sent start by themselves while the fake is idle.
setInterval(() => {
  if (!busy && existsSync(scriptDir)) void pump();
}, 50);
