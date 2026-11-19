import { parseArgs } from "node:util";
import {
  DEFAULT_LAUNCH_OPTIONS,
  LAUNCH_CHOICES,
  type LaunchOptions,
} from "../shared/launch-options.ts";

/**
 * What the server's launcher passes the runtime (`agentCommand` in src/server/claude.ts).
 * Always arguments, never environment variables: the tmux server's environment is whatever
 * the first tmux command had.
 */
export interface RuntimeArgs {
  /** The Agent's folder: the log and the socket are in it, and `exit.json` goes there. */
  agentDir: string;
  /** The Workspace's folder, where Claude Code runs. */
  folder: string;
  /** The absolute path of the owner's installed `claude`. */
  claude: string;
  /** The Claude conversation this Agent runs. */
  conversation: string;
  /**
   * `start` names the conversation (`--session-id`). `resume` carries on one (`--resume`);
   * when no prompt was ever sent it starts instead, because Claude Code saves a
   * conversation only after its first message.
   */
  mode: "start" | "resume";
  /** The Session's Launch options; a flag left out is Default (`agentLaunchArguments`). */
  launch: LaunchOptions;
}

/** Reads the runtime's command line; throws a plain message for one that is not valid. */
export function parseRuntimeArgs(argv: string[]): RuntimeArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "agent-dir": { type: "string" },
      folder: { type: "string" },
      claude: { type: "string" },
      conversation: { type: "string" },
      mode: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      advisor: { type: "string" },
      "focus-view": { type: "boolean" },
    },
    strict: true,
  });
  const agentDir = values["agent-dir"];
  const folder = values.folder;
  const claude = values.claude;
  const conversation = values.conversation;
  const mode = values.mode;
  if (!agentDir || !folder || !claude || !conversation) {
    throw new Error(
      "Usage: --agent-dir --folder --claude --conversation --mode [--model --effort --advisor --focus-view]",
    );
  }
  if (mode !== "start" && mode !== "resume") {
    throw new Error('--mode must be "start" or "resume"');
  }
  const launch: LaunchOptions = {
    ...DEFAULT_LAUNCH_OPTIONS,
    focusView: values["focus-view"] === true,
  };
  for (const field of ["model", "effort", "advisor"] as const) {
    const choice = values[field];
    if (choice === undefined) continue;
    const choices: readonly string[] = LAUNCH_CHOICES[field];
    if (!choices.includes(choice)) {
      throw new Error(`--${field} must be one of ${choices.join(", ")}`);
    }
    (launch as unknown as Record<string, string>)[field] = choice;
  }
  return { agentDir, folder, claude, conversation, mode, launch };
}
