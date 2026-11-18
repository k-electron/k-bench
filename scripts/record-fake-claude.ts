// Records what a real Claude Code says over the Agent SDK's stdio protocol, for the fake
// `claude` (test/harness/fake-claude-sdk.mjs). Run by hand by the owner, never in CI, and
// never inside a test: it runs the real `claude` on the owner's own login and spends a few
// short Haiku turns (cents). See docs/internals/test-seams.md.
//
//   node scripts/record-fake-claude.ts record <out-dir> [path-to-claude [scenario...]]
//
// Each scenario runs the SDK against scripts/tee-claude.mjs, which runs `claude` and copies
// every line either way into <out-dir>/<scenario>.jsonl. The throwaway folder it works in is
// <out-dir>/work. Then
//
//   node scripts/record-fake-claude.ts fixtures <out-dir>
//
// reads those recordings and writes the redacted fixtures in test/harness/fixtures/: it
// replaces the account, folder, plugins, skills and commands, and drops hook output, so
// nothing of the person who recorded them is committed.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import {
  type CanUseTool,
  type Options,
  query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

const TEE = join(import.meta.dirname, "tee-claude.mjs");
const FIXTURES = join(import.meta.dirname, "..", "test", "harness", "fixtures");

/** A prompt queue the SDK reads as its streaming input. */
class Input {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(text: string, uuid: string): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage["uuid"],
    });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.queue.length > 0) yield this.queue.shift() as SDKUserMessage;
      if (this.closed) return;
      await new Promise<void>((resolveWake) => {
        this.wake = resolveWake;
      });
    }
  }
}

interface Scenario {
  name: string;
  options?: Partial<Options>;
  canUseTool?: CanUseTool;
  /** Drives the session: sends prompts, waits for messages. */
  run(session: Session): Promise<void>;
}

interface Session {
  input: Input;
  q: ReturnType<typeof query>;
  /** Resolves with the message `match` accepts, from those not yet seen by this call. */
  next(match: (message: Record<string, unknown>) => boolean): Promise<void>;
}

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const isResult = (m: Record<string, unknown>) => m.type === "result";
const isTextDelta = (m: Record<string, unknown>) =>
  m.type === "stream_event" &&
  (m.event as { delta?: { type?: string } } | undefined)?.delta?.type === "text_delta";

const SCENARIOS: Scenario[] = [
  {
    name: "text",
    async run({ input, next }) {
      input.push("Reply with the single word: pong", uuid());
      await next(isResult);
    },
  },
  {
    // The ask is denied, so nothing runs.
    name: "permission",
    canUseTool: async () => ({ behavior: "deny", message: "Not now." }),
    async run({ input, next }) {
      input.push(
        "Use the Write tool to create a file named hello.txt containing hi.",
        uuid(),
      );
      await next(isResult);
    },
  },
  {
    name: "ask-question",
    canUseTool: async (name, toolInput) => {
      if (name !== "AskUserQuestion") return { behavior: "deny", message: "Not now." };
      const questions = (toolInput.questions ?? []) as Array<{
        question: string;
        options: Array<{ label: string }>;
      }>;
      const answers = Object.fromEntries(
        questions.map((q) => [q.question, q.options[0]?.label ?? ""]),
      );
      return { behavior: "allow", updatedInput: { ...toolInput, answers } };
    },
    async run({ input, next }) {
      input.push(
        "Use the AskUserQuestion tool to ask me whether I prefer tea or coffee. Then reply with my answer and nothing else.",
        uuid(),
      );
      await next(isResult);
    },
  },
  {
    // Plan approval is an ask for ExitPlanMode. It is denied, so nothing runs.
    name: "plan",
    options: { permissionMode: "plan" },
    canUseTool: async () => ({ behavior: "deny", message: "Not now." }),
    async run({ input, next }) {
      input.push(
        "Plan how to create a file named hello.txt containing hi, and present the plan for approval.",
        uuid(),
      );
      await next(isResult);
    },
  },
  {
    // A second prompt sent while the first reply is streaming, then an interrupt.
    name: "mid-turn",
    async run({ input, q, next }) {
      input.push("Write a story of about 150 words about a lighthouse.", uuid());
      await next(isTextDelta);
      input.push("After that, say only: done", uuid());
      await next(isResult);
      await next(isResult);
      input.push("Count from 1 to 400, one number per line.", uuid());
      await next(isTextDelta);
      await q.interrupt();
      await next(isResult);
    },
  },
  {
    name: "clear",
    async run({ input, next }) {
      input.push("Reply with the single word: ok", uuid());
      await next(isResult);
      input.push("/clear", uuid());
      await next((m) => m.type === "system" && m.subtype === "init");
      input.push("Reply with the single word: again", uuid());
      await next(isResult);
    },
  },
];

async function record(outDir: string, claude: string, only: string[]): Promise<void> {
  const work = join(outDir, "work");
  mkdirSync(work, { recursive: true });
  // Claude Code's own variables from a surrounding session would change its behaviour.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("CLAUDE_") && name !== "CLAUDECODE",
    ),
  );
  for (const scenario of SCENARIOS.filter(
    (s) => only.length === 0 || only.includes(s.name),
  )) {
    const file = join(outDir, `${scenario.name}.jsonl`);
    rmSync(file, { force: true });
    process.stdout.write(`recording ${scenario.name}\n`);
    const input = new Input();
    const q = query({
      prompt: input,
      options: {
        pathToClaudeCodeExecutable: TEE,
        cwd: work,
        model: "haiku",
        includePartialMessages: true,
        enableFileCheckpointing: true,
        extraArgs: { "replay-user-messages": null },
        env: {
          ...env,
          K_BENCH_RECORD_FILE: file,
          K_BENCH_REAL_CLAUDE: claude,
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
        },
        ...(scenario.canUseTool ? { canUseTool: scenario.canUseTool } : {}),
        ...scenario.options,
      },
    });
    const seen: Array<Record<string, unknown>> = [];
    const listeners = new Set<() => void>();
    const pump = (async () => {
      for await (const message of q) {
        seen.push(message as unknown as Record<string, unknown>);
        for (const listener of listeners) listener();
      }
    })();
    let cursor = 0;
    const next: Session["next"] = (match) =>
      new Promise((resolveNext, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out")), 120_000);
        const check = () => {
          while (cursor < seen.length) {
            const message = seen[cursor++] as Record<string, unknown>;
            if (match(message)) {
              clearTimeout(timer);
              listeners.delete(check);
              resolveNext();
              return;
            }
          }
        };
        listeners.add(check);
        check();
      });
    try {
      await scenario.run({ input, q, next });
    } finally {
      input.close();
      q.close();
      await pump.catch(() => {});
    }
  }
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(`recorded in ${outDir}\n`);
}

// ---- Fixtures -------------------------------------------------------------------------
//
// The fake Claude builds its messages from one recorded example of each kind, so they have
// exactly the fields a real Claude Code sends. This picks those examples out of the
// recordings, removes whatever identifies the person or machine that recorded them, and
// writes them to test/harness/fixtures/messages.json.

type Json = Record<string, unknown>;

interface Recording {
  /** What the SDK sent to `claude`. */
  in: Json[];
  /** What `claude` sent back. */
  out: Json[];
  argv: string[];
}

function readRecording(file: string): Recording {
  const recording: Recording = { in: [], out: [], argv: [] };
  for (const raw of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(raw) as { dir: string; line: unknown };
    if (entry.dir === "argv") recording.argv = entry.line as string[];
    if (entry.dir === "in" || entry.dir === "out") {
      recording[entry.dir].push(JSON.parse(entry.line as string) as Json);
    }
  }
  return recording;
}

const asJson = (value: unknown) => value as Json;
const eventOf = (m: Json) => asJson(m.event).type;
const deltaOf = (m: Json) => asJson(asJson(m.event).delta ?? {}).type;
const blockOf = (m: Json) => asJson(asJson(m.event).content_block ?? {}).type;
const contentOf = (m: Json) => asJson(m.message).content as Json[];
const askOf = (m: Json) => asJson(m.request).tool_name;

function pick(messages: Json[], what: string, match: (m: Json) => boolean): Json {
  const found = messages.find(match);
  if (!found) throw new Error(`no ${what} in the recordings: record again`);
  return found;
}

/** Replaces what identifies the person or machine in a recorded value. */
function redact(value: unknown, outDir: string): unknown {
  const json = JSON.stringify(value)
    .split(join(outDir, "work"))
    .join("/home/you/project")
    .split(outDir)
    .join("/home/you/recording")
    .split(homedir())
    .join("/home/you")
    .replace(/\/Users\/[^/"\\]+/g, "/home/you")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "you@example.com")
    .replace(/"signature":"[^"]+"/g, '"signature":"ZmFrZS1zaWduYXR1cmU="')
    .replace(/"signature":"[^"]+"/g, '"signature":"ZmFrZS1zaWduYXR1cmU="');
  return JSON.parse(json);
}

/** Empties the lists that hold the recorder's own plugins, skills, commands and servers. */
function scrub(message: Json): Json {
  const copy = structuredClone(message);
  const reply = asJson(asJson(copy.response ?? {}).response ?? {});
  for (const target of [copy, reply]) {
    for (const key of ["plugins", "skills", "slash_commands", "agents", "mcp_servers"]) {
      if (key in target) target[key] = [];
    }
    for (const key of ["memory_paths", "messaging_socket_path"]) delete target[key];
    if (Array.isArray(target.commands)) {
      target.commands = (target.commands as Json[]).filter((c) => c.builtin);
    }
    if (Array.isArray(target.tools)) {
      target.tools = (target.tools as string[]).filter((t) => !t.startsWith("mcp__"));
    }
    if (Array.isArray(target.terminal_slash_commands)) {
      target.terminal_slash_commands = [];
    }
  }
  if (reply.account) {
    reply.account = {
      email: "you@example.com",
      organization: "Example Org",
      subscriptionType: "Claude Max",
      apiProvider: "firstParty",
    };
  }
  if ("pid" in reply) reply.pid = 4242;
  if (copy.type === "rate_limit_event") {
    copy.rate_limit_info = {
      status: "allowed",
      resetsAt: 1795048200,
      rateLimitType: "five_hour",
      isUsingOverage: false,
    };
  }
  return copy;
}

function fixtures(outDir: string): void {
  const read = (name: string) => readRecording(join(outDir, `${name}.jsonl`));
  const text = read("text");
  const permission = read("permission");
  const ask = read("ask-question");
  const plan = read("plan");
  const mid = read("mid-turn");
  const clear = read("clear");
  const stream = (r: Recording, what: string, ...match: Array<(m: Json) => boolean>) =>
    pick(r.out, what, (m) => m.type === "stream_event" && match.every((test) => test(m)));
  const first = (r: Recording, type: string, sub?: (m: Json) => boolean) =>
    pick(r.out, type, (m) => m.type === type && (sub?.(m) ?? true));
  const sub = (name: string) => (m: Json) => m.subtype === name;
  const toolUse = (name: string) => (m: Json) =>
    contentOf(m).some((b) => b.type === "tool_use" && b.name === name);
  const toolResult = (error: boolean) => (m: Json) =>
    Array.isArray(asJson(m.message).content) &&
    contentOf(m).some((b) => b.type === "tool_result" && Boolean(b.is_error) === error);

  const initializeReply = pick(
    text.out,
    "initialize reply",
    (m) =>
      m.type === "control_response" && "commands" in asJson(asJson(m.response).response),
  );
  const messages: Record<string, Json> = {
    initializeReply,
    init: first(text, "system", sub("init")),
    status: first(text, "system", sub("status")),
    rateLimit: first(text, "rate_limit_event"),
    commandLifecycle: first(text, "command_lifecycle"),
    sessionState: first(permission, "system", sub("session_state_changed")),
    userEcho: first(text, "user", (m) => m.isReplay === true),
    messageStart: stream(text, "message_start", (m) => eventOf(m) === "message_start"),
    textStart: stream(
      text,
      "text block start",
      (m) => eventOf(m) === "content_block_start",
      (m) => blockOf(m) === "text",
    ),
    textDelta: stream(text, "text delta", (m) => deltaOf(m) === "text_delta"),
    blockStop: stream(text, "block stop", (m) => eventOf(m) === "content_block_stop"),
    messageDelta: stream(text, "message_delta", (m) => eventOf(m) === "message_delta"),
    messageStop: stream(text, "message_stop", (m) => eventOf(m) === "message_stop"),
    thinkingStart: stream(
      permission,
      "thinking start",
      (m) => eventOf(m) === "content_block_start",
      (m) => blockOf(m) === "thinking",
    ),
    thinkingDelta: stream(
      permission,
      "thinking delta",
      (m) => deltaOf(m) === "thinking_delta",
    ),
    toolStart: stream(
      permission,
      "tool start",
      (m) => eventOf(m) === "content_block_start",
      (m) => blockOf(m) === "tool_use",
    ),
    toolDelta: stream(permission, "tool delta", (m) => deltaOf(m) === "input_json_delta"),
    assistantText: first(text, "assistant"),
    assistantThinking: first(permission, "assistant", (m) =>
      contentOf(m).some((b) => b.type === "thinking"),
    ),
    assistantToolUse: first(permission, "assistant", toolUse("Write")),
    assistantAskUserQuestion: first(ask, "assistant", toolUse("AskUserQuestion")),
    assistantExitPlanMode: first(plan, "assistant", toolUse("ExitPlanMode")),
    toolResultDenied: first(permission, "user", toolResult(true)),
    toolResultAnswered: first(ask, "user", toolResult(false)),
    canUseTool: pick(
      permission.out,
      "permission ask",
      (m) => m.type === "control_request" && askOf(m) === "Write",
    ),
    canUseToolAskUserQuestion: pick(
      ask.out,
      "AskUserQuestion ask",
      (m) => m.type === "control_request" && askOf(m) === "AskUserQuestion",
    ),
    canUseToolExitPlanMode: pick(
      plan.out,
      "ExitPlanMode ask",
      (m) => m.type === "control_request" && askOf(m) === "ExitPlanMode",
    ),
    resultSuccess: first(text, "result", (m) => m.subtype === "success"),
    resultInterrupted: first(mid, "result", sub("error_during_execution")),
    assistantAborted: first(mid, "assistant", (m) => m.aborted === true),
    userInterrupted: first(mid, "user", (m) =>
      JSON.stringify(m.message).includes("Request interrupted"),
    ),
    conversationReset: first(clear, "conversation_reset"),
    backgroundTasksChanged: first(clear, "system", sub("background_tasks_changed")),
    clearEcho: first(
      clear,
      "user",
      (m) => m.isReplay === true && JSON.stringify(m.message).includes("command-name"),
    ),
    resultClear: first(clear, "result", (m) => m.stop_reason === null),
  };

  const out: Json = {
    recorded: {
      claudeCodeVersion: asJson(messages.init).claude_code_version,
      argv: text.argv,
    },
  };
  for (const [key, message] of Object.entries(messages)) {
    out[key] = redact(scrub(message), outDir);
  }
  const written = `${JSON.stringify(out, null, 2)}\n`;
  const username = userInfo().username;
  for (const secret of [homedir(), `/Users/${username}`, username, outDir]) {
    if (secret.length > 2 && written.includes(secret)) {
      throw new Error(`the fixtures still contain "${secret}": extend redact()`);
    }
  }
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(join(FIXTURES, "messages.json"), written);
  process.stdout.write(`wrote ${join(FIXTURES, "messages.json")}\n`);
}

const [command, outArg, claudeArg, ...only] = process.argv.slice(2);
if (command === "record" && outArg) {
  await record(
    resolve(outArg),
    claudeArg ? resolve(claudeArg) : join(homedir(), ".local", "bin", "claude"),
    only,
  );
} else if (command === "fixtures" && outArg) {
  fixtures(resolve(outArg));
} else {
  process.stderr.write(
    "usage: node scripts/record-fake-claude.ts record <out-dir> [claude [scenario...]]\n       node scripts/record-fake-claude.ts fixtures <out-dir>\n",
  );
  process.exit(2);
}
