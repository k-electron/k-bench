// The shipped code the live check runs recordings through, so that a verdict is about k-bench's
// own reducers and trackers and not about a second reading of the JSON. The runtime's modules
// (src/) are imported as they are; the browser's (web/src/agent/) are written for Vite, with
// import paths that have no extension, so a resolve hook adds `.ts` for them here. They are
// imported by URL at run time (and typed below by what the check reads), so that `tsc` does not
// check the browser's files under the server's settings.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ConversationTracker } from "../../src/agent/conversation.ts";
import { subscriptionProblem } from "../../src/agent-runtime/account.ts";
import { Activity } from "../../src/agent-runtime/activity.ts";
import { CommandList } from "../../src/agent-runtime/commands.ts";
import { sdkLaunchOptions } from "../../src/agent-runtime/session.ts";
import { TaskTracker } from "../../src/agent-runtime/tasks.ts";
import {
  planTerminalImport,
  type SavedMessage,
} from "../../src/agent-runtime/terminal-import.ts";
import type { AgentStatus, LogEntry } from "../../src/shared/agent-protocol.ts";

export type { SavedMessage };
export {
  Activity,
  CommandList,
  ConversationTracker,
  planTerminalImport,
  sdkLaunchOptions,
  subscriptionProblem,
  TaskTracker,
};

const ROOT = join(import.meta.dirname, "..", "..");

/** What the check reads of the browser's `TranscriptItem`s. */
export interface Item {
  kind: string;
  key: string;
  seq?: number;
  [field: string]: unknown;
}

interface Items {
  buildItems(entries: readonly LogEntry[]): {
    items: Item[];
    model?: string;
    cwd?: string;
    claudeVersion?: string;
    focusView: boolean;
  };
}

interface Unsupported {
  unsupportedInMessage(message: Record<string, unknown>): Array<{
    what: string;
    name: string;
    summary: string;
  }>;
}

interface Prompts {
  queuedPromptIds(entries: readonly LogEntry[]): ReadonlySet<string>;
}

interface WebActivity {
  contextLeftPercent(context: {
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    isAutoCompactEnabled: boolean;
    autoCompactThreshold?: number;
  }): number | undefined;
}

export interface WebModules {
  items: Items;
  unsupported: Unsupported;
  prompts: Prompts;
  activity: WebActivity;
}

let loaded: Promise<WebModules> | undefined;

/** The browser's `buildItems`, `unsupportedInMessage`, `queuedPromptIds` and `contextLeftPercent`. */
export function webModules(): Promise<WebModules> {
  loaded ??= (async () => {
    registerHooks({
      resolve(specifier, context, next) {
        if (
          specifier.startsWith(".") &&
          !/\.[cm]?[jt]sx?$/.test(specifier) &&
          context.parentURL?.includes("/web/src/")
        ) {
          const base = fileURLToPath(new URL(specifier, context.parentURL));
          for (const extension of [".ts", ".tsx", "/index.ts"]) {
            if (existsSync(base + extension)) {
              return next(pathToFileURL(base + extension).href, context);
            }
          }
        }
        return next(specifier, context);
      },
    });
    const load = (file: string) => import(pathToFileURL(join(ROOT, file)).href);
    return {
      items: (await load("web/src/agent/items.ts")) as Items,
      unsupported: (await load("web/src/agent/unsupported.ts")) as Unsupported,
      prompts: (await load("web/src/agent/prompts.ts")) as Prompts,
      activity: (await load("web/src/agent/activity.ts")) as WebActivity,
    };
  })();
  return loaded;
}

/**
 * The log the runtime would have written for a session of the check: its prompts as
 * `prompt` entries (before the messages they cause, as the runtime logs them), its messages
 * as `sdk` entries (never the streamed fragments), numbered from 1.
 */
export function logOf(
  events: ReadonlyArray<
    | { kind: "prompt"; id: string; text: string }
    | { kind: "message"; message: SDKMessage }
  >,
): LogEntry[] {
  const entries: LogEntry[] = [];
  let seq = 0;
  const t = new Date().toISOString();
  for (const event of events) {
    if (event.kind === "prompt") {
      entries.push({ seq: ++seq, t, kind: "prompt", id: event.id, text: event.text });
    } else if ((event.message as { type?: string }).type !== "stream_event") {
      entries.push({
        seq: ++seq,
        t,
        kind: "sdk",
        message: event.message as unknown as Record<string, unknown>,
      });
    }
  }
  return entries;
}

/** The statuses `Activity` publishes while it reads these messages, as it would in the runtime. */
export function activityStates(
  events: ReadonlyArray<{ kind: "prompt" } | { kind: "message"; message: SDKMessage }>,
): AgentStatus["state"][] {
  const states: AgentStatus["state"][] = [];
  const activity = new Activity({
    openAsks: () => 0,
    publish: (status) => states.push(status.state),
  });
  for (const event of events) {
    if (event.kind === "prompt") activity.prompt();
    else activity.message(event.message as unknown as Record<string, unknown>);
  }
  return states;
}
