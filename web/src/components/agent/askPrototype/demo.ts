// PROTOTYPE (throwaway, branch prototype/ask-interrupt): "How does the Owner interrupt or
// redirect while an ask is open?" (#179). Stub asks and a "would send" log; nothing here
// reaches the Agent Runtime.
import { useState } from "react";
import type { PermissionAsk } from "../../../agent/transcript";

export interface DemoAsk extends PermissionAsk {
  /** Who is asking: Claude itself, or a subagent by its description. */
  from: string;
  /** A background subagent's ask: an interrupt spares it (to confirm live). */
  background: boolean;
}

const base = { suppressAlwaysAllowRule: false, defaultToNo: false };

export const DEMO_ASKS: DemoAsk[] = [
  {
    ...base,
    requestId: "ask-1",
    toolName: "Bash",
    input: { command: "pnpm test -- --run test/claude-agent.test.ts" },
    suggestions: [{ type: "addRules" }],
    from: "Claude",
    background: false,
  },
  {
    ...base,
    requestId: "ask-2",
    toolName: "Edit",
    input: {
      file_path: "src/agent-runtime/asks.ts",
      old_string: "const DENIED_MESSAGE =",
      new_string: "export const DENIED_MESSAGE =",
    },
    suggestions: [{ type: "setMode" }],
    from: "subagent: Fix the lint errors",
    background: true,
  },
  {
    ...base,
    requestId: "ask-3",
    toolName: "Bash",
    input: { command: "rm -rf .data/agents/old-*" },
    suggestions: [],
    from: "subagent: Clean up old Agent folders",
    background: true,
  },
];

export interface DemoAsks {
  asks: DemoAsk[];
  log: string[];
  working: boolean;
  allow(id: string, always?: boolean): void;
  deny(id: string, words?: string): void;
  denyAll(words?: string): void;
  interrupt(): void;
  prompt(text: string, how: "queued" | "now"): void;
  reset(): void;
}

/** The prototype's stand-in for the conversation: asks that go when answered, and a log. */
export function useDemoAsks(): DemoAsks {
  const [asks, setAsks] = useState(DEMO_ASKS);
  const [log, setLog] = useState<string[]>([]);
  const [working, setWorking] = useState(true);
  const [count, setCount] = useState(0);
  const say = (line: string) => {
    setCount((n) => n + 1);
    setLog((l) => [...l.slice(-5), `${count + 1}. ${line}`]);
  };
  const name = (id: string) => {
    const a = asks.find((x) => x.requestId === id);
    return a ? `${a.toolName} (${a.from})` : id;
  };
  return {
    asks,
    log,
    working,
    allow(id, always) {
      say(`allow${always ? " + don't ask again" : ""}: ${name(id)}`);
      setAsks((a) => a.filter((x) => x.requestId !== id));
    },
    deny(id, words) {
      say(`deny${words ? ` "${words}"` : ""}: ${name(id)}`);
      setAsks((a) => a.filter((x) => x.requestId !== id));
    },
    denyAll(words) {
      say(`deny all ${asks.length}${words ? ` with "${words}"` : ""}`);
      setAsks([]);
    },
    interrupt() {
      const kept = asks.filter((a) => a.background);
      say(
        `interrupt → Claude's own asks withdrawn (cancelled); ${kept.length} background subagent ask(s) stay open (to confirm live)`,
      );
      setAsks(kept);
      setWorking(false);
    },
    prompt(text, how) {
      say(
        how === "now"
          ? `prompt "${text}" with priority now → Claude redirects at once (asks: to confirm live)`
          : `prompt "${text}" queued → Claude reads it once the asks are answered`,
      );
    },
    reset() {
      setAsks(DEMO_ASKS);
      setLog([]);
      setCount(0);
      setWorking(true);
    },
  };
}
