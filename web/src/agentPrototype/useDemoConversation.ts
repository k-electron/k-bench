/**
 * PROTOTYPE, throwaway. Never merged: lives only on the `prototype/agent-conversation` branch.
 *
 * A scripted, fake Claude Agent conversation that streams, pauses on an Allow/Deny prompt,
 * takes queued prompts and can be interrupted. It answers "what should a Claude Agent
 * conversation look like?" for the ticket of that name; nothing here talks to a server.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type Mode = "default" | "acceptEdits" | "plan" | "auto";
export const MODES: Mode[] = ["default", "acceptEdits", "plan", "auto"];
export const MODE_LABEL: Record<Mode, string> = {
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan mode",
  auto: "Auto",
};

export type Answer = "allow" | "always" | "deny" | "interrupted";

export type Item = { id: number; raw: unknown } & (
  | { kind: "user"; text: string; queued: boolean }
  | { kind: "thinking"; text: string; seconds: number }
  | { kind: "text"; text: string; streaming: boolean }
  | {
      kind: "tool";
      name: string;
      target: string;
      status: "running" | "done" | "denied";
      result?: string;
      diff?: string[];
      output?: string[];
    }
  | { kind: "permission"; tool: string; target: string; diff: string[]; answer?: Answer }
  | { kind: "unknown"; label: string }
  | { kind: "note"; text: string }
  | { kind: "result"; text: string }
);

type NewItem = Item extends infer T ? (T extends Item ? Omit<T, "id"> : never) : never;

const DIFF = [
  "@@ web/src/usePaneView.ts:58 @@",
  "   const previousId = useRef(id);",
  "-  if (focused && !wasFocused) api.markViewed(id);",
  "+  if (focused && (!wasFocused || id !== previousId.current)) api.markViewed(id);",
  "   previousId.current = id;",
];

const FINDING = `Found it. \`usePaneView\` only reports a view when the Pane **gains focus**:

\`\`\`ts
if (focused && !wasFocused) api.markViewed(id);
\`\`\`

On a phone the drawer opens the Session into the Pane that is *already* focused, so \`wasFocused\` is true and nothing is sent. Two ways to fix it:

- report the view whenever the Pane's Session changes, too
- or clear the Bell on the server when the drawer opens it

The first is one line and keeps the server out of it, so I'll do that.`;

const DONE = `Fixed. Opening a Session from the drawer now clears its Bell, and the \`usePaneView\` tests pass.

Want me to open a PR?`;

const DENIED = `OK, I won't edit it. The change is the one line above in \`web/src/usePaneView.ts\`, if you'd rather make it yourself.`;

class Cancelled extends Error {}

export interface DemoConversation {
  items: Item[];
  running: boolean;
  /** Seconds the current turn has run. */
  elapsed: number;
  /** What Claude is doing right now, for a one-line status. */
  activity: string | null;
  pendingPermission: Extract<Item, { kind: "permission" }> | null;
  mode: Mode;
  setMode: (mode: Mode) => void;
  cycleMode: () => void;
  answer: (answer: Exclude<Answer, "interrupted">) => void;
  send: (text: string) => void;
  interrupt: () => void;
  replay: () => void;
}

export function useDemoConversation(): DemoConversation {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [activity, setActivity] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("default");
  const modeRef = useRef<Mode>("default");
  const nextId = useRef(1);
  const run = useRef({ cancelled: false });
  const permissionResolver = useRef<((a: Answer) => void) | null>(null);
  const queue = useRef<number[]>([]);
  const startedAt = useRef(0);

  const setMode = useCallback((m: Mode) => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  const cycleMode = useCallback(() => {
    setMode(MODES[(MODES.indexOf(modeRef.current) + 1) % MODES.length] ?? "default");
  }, [setMode]);

  const add = useCallback((item: NewItem): number => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { ...item, id } as Item]);
    return id;
  }, []);
  const patch = useCallback((id: number, change: Partial<Item>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? ({ ...item, ...change } as Item) : item)),
    );
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [running]);

  const play = useCallback(
    async (script: (s: Script) => Promise<void>) => {
      const token = { cancelled: false };
      run.current = token;
      startedAt.current = Date.now();
      setElapsed(0);
      setRunning(true);
      const wait = (ms: number) =>
        new Promise<void>((resolve, reject) =>
          setTimeout(() => (token.cancelled ? reject(new Cancelled()) : resolve()), ms),
        );
      const s: Script = {
        add,
        patch,
        wait,
        activity: setActivity,
        mode: () => modeRef.current,
        stream: async (text, raw) => {
          const id = add({ kind: "text", text: "", streaming: true, raw });
          for (let i = 0; i < text.length; ) {
            i += 2 + Math.floor(Math.random() * 5);
            patch(id, { text: text.slice(0, i) } as Partial<Item>);
            await wait(28);
          }
          patch(id, { text, streaming: false } as Partial<Item>);
        },
        askPermission: (item) =>
          new Promise<Answer>((resolve) => {
            const id = add(item);
            permissionResolver.current = (a) => {
              permissionResolver.current = null;
              patch(id, { answer: a } as Partial<Item>);
              resolve(a);
            };
          }),
      };
      try {
        await script(s);
        if (token.cancelled) throw new Cancelled();
        add({
          kind: "result",
          text: `Done in ${Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))}s`,
          raw: {
            type: "result",
            subtype: "success",
            duration_ms: Date.now() - startedAt.current,
            num_turns: 7,
            is_error: false,
          },
        });
      } catch (error) {
        if (!(error instanceof Cancelled)) throw error;
      } finally {
        if (run.current === token) {
          setRunning(false);
          setActivity(null);
          const queued = queue.current.shift();
          if (queued !== undefined) {
            patch(queued, { queued: false } as Partial<Item>);
            void play(replyScript);
          }
        }
      }
    },
    [add, patch],
  );

  const pendingStart = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const replay = useCallback(() => {
    run.current.cancelled = true;
    clearTimeout(pendingStart.current);
    permissionResolver.current = null;
    queue.current = [];
    setItems([]);
    setActivity(null);
    setRunning(false);
    pendingStart.current = setTimeout(() => void play(mainScript), 50);
  }, [play]);

  useEffect(() => {
    replay();
    return () => {
      run.current.cancelled = true;
      clearTimeout(pendingStart.current);
    };
  }, [replay]);

  const send = useCallback(
    (text: string) => {
      const queued = running;
      const id = add({
        kind: "user",
        text,
        queued,
        raw: {
          type: "user",
          message: { role: "user", content: [{ type: "text", text }] },
          uuid: crypto.randomUUID(),
        },
      });
      if (queued) queue.current.push(id);
      else void play(replyScript);
    },
    [add, play, running],
  );

  const interrupt = useCallback(() => {
    if (!running) return;
    run.current.cancelled = true;
    permissionResolver.current?.("interrupted");
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "tool" && item.status === "running"
          ? { ...item, status: "denied", result: "Interrupted" }
          : item.kind === "text" && item.streaming
            ? { ...item, streaming: false }
            : item,
      ),
    );
    add({
      kind: "note",
      text: "Interrupted by you",
      raw: { type: "system", subtype: "interrupted" },
    });
    queue.current = [];
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "user" && item.queued ? { ...item, queued: false } : item,
      ),
    );
    setRunning(false);
    setActivity(null);
  }, [add, running]);

  const answer = useCallback((a: Exclude<Answer, "interrupted">) => {
    permissionResolver.current?.(a);
  }, []);

  const pending = items.find(
    (item): item is Extract<Item, { kind: "permission" }> =>
      item.kind === "permission" && item.answer === undefined,
  );

  return {
    items,
    running,
    elapsed,
    activity,
    pendingPermission: pending ?? null,
    mode,
    setMode,
    cycleMode,
    answer,
    send,
    interrupt,
    replay,
  };
}

interface Script {
  add: (item: NewItem) => number;
  patch: (id: number, change: Partial<Item>) => void;
  wait: (ms: number) => Promise<void>;
  stream: (text: string, raw: unknown) => Promise<void>;
  activity: (text: string | null) => void;
  askPermission: (item: Extract<NewItem, { kind: "permission" }>) => Promise<Answer>;
  mode: () => Mode;
}

async function tool(
  s: Script,
  name: string,
  target: string,
  ms: number,
  done: { result: string; output?: string[]; diff?: string[] },
) {
  const toolUseId = `toolu_${Math.random().toString(36).slice(2, 10)}`;
  s.activity(`${name} ${target}`);
  const id = s.add({
    kind: "tool",
    name,
    target,
    status: "running",
    raw: {
      type: "assistant",
      message: {
        id: "msg_01Proto",
        content: [{ type: "tool_use", id: toolUseId, name, input: { target } }],
      },
    },
  });
  await s.wait(ms);
  s.patch(id, { status: "done", ...done } as Partial<Item>);
  s.activity(null);
}

async function mainScript(s: Script) {
  s.add({
    kind: "user",
    text: "On my phone the Bell doesn't clear when I open a Session from the drawer. Can you find out why and fix it?",
    queued: false,
    raw: { type: "user", message: { role: "user", content: "On my phone the Bell…" } },
  });
  s.activity("Thinking");
  await s.wait(1600);
  s.add({
    kind: "thinking",
    seconds: 2,
    text: "The Bell clears once the owner views the Session. I need to find where viewing is reported from the web app, and check whether the phone's drawer path goes through it.",
    raw: {
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "…" }] },
    },
  });
  await s.stream("I'll look at how viewing a Session clears its Bell.", {
    type: "assistant",
    message: { content: [{ type: "text", text: "I'll look at how…" }] },
  });
  await tool(s, "Grep", '"markViewed"', 900, {
    result: "3 files",
    output: ["src/server/service.ts", "web/src/usePaneView.ts", "web/src/api.ts"],
  });
  await tool(s, "Read", "web/src/usePaneView.ts", 700, { result: "142 lines" });
  await s.stream(FINDING, {
    type: "assistant",
    message: { content: [{ type: "text", text: "Found it. …" }] },
  });
  let answer: Answer = "allow";
  if (s.mode() === "default" || s.mode() === "plan") {
    s.activity("Waiting for you");
    answer = await s.askPermission({
      kind: "permission",
      tool: "Edit",
      target: "web/src/usePaneView.ts",
      diff: DIFF,
      raw: {
        type: "control_request",
        request: {
          subtype: "can_use_tool",
          tool_name: "Edit",
          input: {
            file_path: "web/src/usePaneView.ts",
            old_string: "…",
            new_string: "…",
          },
        },
      },
    });
    s.activity(null);
  }
  if (answer === "interrupted") return;
  if (answer === "deny") {
    s.add({
      kind: "tool",
      name: "Edit",
      target: "web/src/usePaneView.ts",
      status: "denied",
      result: "Denied",
      raw: {
        type: "user",
        message: { content: [{ type: "tool_result", is_error: true }] },
      },
    });
    await s.stream(DENIED, { type: "assistant", message: { content: [] } });
    return;
  }
  await tool(s, "Edit", "web/src/usePaneView.ts", 500, { result: "+1 −1", diff: DIFF });
  s.add({
    kind: "unknown",
    label: "system / memory_recall",
    raw: {
      type: "system",
      subtype: "memory_recall",
      memories: [{ name: "phone-clipboard-via-pbpaste", score: 0.41 }],
      session_id: "3f2c…",
    },
  });
  await tool(s, "Bash", "pnpm test usePaneView", 2600, {
    result: "6 passed",
    output: [
      "✓ web/src/usePaneView.test.ts (6 tests) 41ms",
      "",
      "Test Files  1 passed (1)",
    ],
  });
  await s.stream(DONE, { type: "assistant", message: { content: [] } });
}

async function replyScript(s: Script) {
  s.activity("Thinking");
  await s.wait(1200);
  s.activity(null);
  await s.stream(
    "(Prototype) A real Claude Agent would answer here. Everything you type gets this canned reply.",
    { type: "assistant", message: { content: [] } },
  );
}
