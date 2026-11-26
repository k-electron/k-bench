/**
 * Launching Claude Code for a Claude Session (ADR-0005). k-bench starts it through its
 * documented command-line flags and learns which conversation it is on, and whether it is
 * Working, Waiting or Idle, through silent hooks, so everything k-bench knows about Claude Code is in
 * this file: the flags it passes, the hooks, and the launcher script that runs it.
 */

import {
  DEFAULT_LAUNCH_OPTIONS,
  LAUNCH_CHOICES,
  type LaunchOptions,
} from "../shared/launch-options.ts";
import type { SessionActivity } from "../shared/state-protocol.ts";

/**
 * Reads Launch options from a request. A field left out is Default; a value that is not one
 * of the choices is refused, naming the field (`claude.model`).
 */
export function parseLaunchOptions(
  value: unknown,
): { options: LaunchOptions } | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "claude must be an object" };
  }
  const given = value as Record<string, unknown>;
  const options: LaunchOptions = { ...DEFAULT_LAUNCH_OPTIONS };
  for (const field of ["model", "effort", "advisor"] as const) {
    const choice = given[field];
    if (choice === undefined) continue;
    const choices: readonly unknown[] = LAUNCH_CHOICES[field];
    if (!choices.includes(choice)) {
      return {
        error: `claude.${field} must be one of ${LAUNCH_CHOICES[field].join(", ")}`,
      };
    }
    (options as unknown as Record<string, unknown>)[field] = choice;
  }
  if (given.focusView !== undefined) {
    if (typeof given.focusView !== "boolean") {
      return { error: "claude.focusView must be true or false" };
    }
    options.focusView = given.focusView;
  }
  return { options };
}

/** What a Claude Session is started with. */
export interface ClaudeLaunch {
  /** The Claude conversation the Session runs: a UUID k-bench generated at creation. */
  conversationId: string;
  options: LaunchOptions;
  /**
   * `start` is the first launch, which names the conversation (`--session-id`). `resume` is a
   * restart, which resumes it (`--resume`) and, when there is nothing to resume, starts it
   * with that same ID.
   */
  mode: "start" | "resume";
}

/**
 * The tmux pane user option the conversation hook writes the conversation ID to, on the pane
 * Claude Code runs in, and the tmux `wait-for` channel it signals after (see `TmuxDriver`).
 */
export const CONVERSATION_OPTION = "@kb-conversation";
export const CONVERSATION_CHANNEL = "kb-conversation-changed";

/**
 * Claude Code runs this `SessionStart` hook whenever a conversation starts in the Session,
 * whatever started it: the launch, `/clear`, `/resume`, `/branch`, compaction (which keeps
 * the ID) or a `/restart`. It takes `session_id` from the JSON on stdin and records it on its
 * own tmux pane, then signals the channel, as the Bell does.
 *
 * Claude Code adds a `SessionStart` hook's output to the conversation, so it prints nothing,
 * and it exits 0 whatever happens, so a missing tool never shows in Claude Code (ADR-0005).
 * It is one line of plain POSIX `sh` with tools every Mac has (no `jq`), because it runs
 * under the owner's own environment. Bare `tmux` reaches k-bench's socket through `$TMUX`,
 * which tmux sets in the pane. The ID is passed as an argument, so it cannot inject into a
 * tmux command; k-bench ignores one that isn't UUID-shaped.
 */
const CONVERSATION_HOOK = [
  "{",
  `id=$(tr -d '\\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p');`,
  '[ -n "$id" ] && [ -n "$TMUX_PANE" ] &&',
  `tmux set-option -p -t "$TMUX_PANE" ${CONVERSATION_OPTION} "$id" &&`,
  `tmux wait-for -S ${CONVERSATION_CHANNEL};`,
  "} >/dev/null 2>&1; exit 0",
].join(" ");

/**
 * The tmux pane user option the activity hooks write a Claude Session's state to (a
 * `SessionActivity`), on the pane Claude Code runs in, and the tmux `wait-for` channel they
 * signal after, so the state feed re-reads at once (see `TmuxDriver`). It is empty until a
 * hook has run, which reads as Idle.
 */
export const ACTIVITY_OPTION = "@kb-activity";
export const ACTIVITY_CHANNEL = "kb-activity-changed";

/**
 * Matches the stdin of an event fired inside a subagent (or a teammate), which carries an
 * `agent_id` key. It can't match inside a value, such as a prompt, since JSON escapes a `"`
 * there. Such events say nothing about the Session's own turn, so the activity hooks ignore
 * them. The hooks reference documents `agent_id` as the subagent's or teammate's ID; the
 * main agent started with `--agent` carries only `agent_type`, so that is never tested.
 */
const FROM_AN_AGENT = '"agent_id"[[:space:]]*:';

/**
 * The hook that records `activity` on its own tmux pane and signals the channel, unless its
 * event came from a subagent or its stdin matches `ignore` (an extended regex). It is built
 * like the conversation hook, for the same reasons: it prints nothing, exits 0 whatever
 * happens, and is one line of plain `sh` with no `jq`. The state it writes is k-bench's own
 * word, never taken from stdin.
 */
function activityHook(activity: SessionActivity, ignore?: string): string {
  const skip = [FROM_AN_AGENT, ...(ignore ? [ignore] : [])].join("|");
  return [
    "{",
    "input=$(tr -d '\\n');",
    `if printf '%s' "$input" | grep -Eq '${skip}'; then :;`,
    'elif [ -n "$TMUX_PANE" ]; then',
    `tmux set-option -p -t "$TMUX_PANE" ${ACTIVITY_OPTION} ${activity} &&`,
    `tmux wait-for -S ${ACTIVITY_CHANNEL};`,
    "fi;",
    "} >/dev/null 2>&1; exit 0",
  ].join(" ");
}

/**
 * Which Claude Code hook events set which state (see Working, Waiting and Idle in the
 * glossary):
 * - `SessionStart`: a new or restarted Claude Session, or a new conversation in one, starts
 *   Idle. Not on compaction, which can happen mid-turn and keeps the turn going.
 * - `UserPromptSubmit`: a turn starts, so Working.
 * - `PermissionRequest` (a permission prompt), `PreToolUse` for `AskUserQuestion` (a
 *   question) and `ExitPlanMode` (a plan to approve), and `Elicitation` (an MCP server's
 *   question): Claude Code stops mid-turn for the owner, so Waiting. `PermissionRequest` fires
 *   as the prompt shows; the `Notification` for it waits about six seconds, so it isn't used.
 *   The hooks reference doesn't say whether approving a plan is a permission prompt, so
 *   `ExitPlanMode` is matched as well; if it is, the two agree.
 * - `PostToolUse`, `PostToolUseFailure` and `ElicitationResult`: the owner answered, or a
 *   tool finished, so Working. No hook fires when the owner denies a tool, so the owner's
 *   own key ends Waiting too (see `TmuxDriver.endWaiting`).
 * - `Stop`, and `StopFailure` (fired instead when an API error ends the turn): the turn is
 *   over, so Idle. Neither fires for a subagent.
 * `matcher` is the hook group's tool name matcher, for a tool event.
 */
const ACTIVITY_EVENTS: {
  event: string;
  activity: SessionActivity;
  matcher?: string;
  ignore?: string;
}[] = [
  {
    event: "SessionStart",
    activity: "idle",
    ignore: '"source"[[:space:]]*:[[:space:]]*"compact"',
  },
  { event: "UserPromptSubmit", activity: "working" },
  { event: "PermissionRequest", activity: "waiting" },
  { event: "PreToolUse", activity: "waiting", matcher: "AskUserQuestion|ExitPlanMode" },
  { event: "Elicitation", activity: "waiting" },
  { event: "PostToolUse", activity: "working" },
  { event: "PostToolUseFailure", activity: "working" },
  { event: "ElicitationResult", activity: "working" },
  { event: "Stop", activity: "idle" },
  { event: "StopFailure", activity: "idle" },
];

type HookGroups = { matcher?: string; hooks: { type: "command"; command: string }[] }[];

/** Every hook k-bench passes, by Claude Code hook event: the conversation's, then the states'. */
function launchHooks(): Record<string, HookGroups> {
  const hooks: Record<string, HookGroups> = {
    SessionStart: [{ hooks: [{ type: "command", command: CONVERSATION_HOOK }] }],
  };
  for (const { event, activity, matcher, ignore } of ACTIVITY_EVENTS) {
    hooks[event] = [
      ...(hooks[event] ?? []),
      {
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: "command", command: activityHook(activity, ignore) }],
      },
    ];
  }
  return hooks;
}

/**
 * The `--settings` every launch passes: k-bench's hooks and, with Focus view on, its keys.
 * Focus view needs both keys: it does nothing without the fullscreen renderer, and
 * fullscreen is not the default on every machine. `--settings` applies to that launch only
 * and adds to the owner's own settings and hooks, leaving their files unchanged.
 */
function launchSettings(focusView: boolean): string {
  return JSON.stringify({
    hooks: launchHooks(),
    ...(focusView ? { viewMode: "focus", tui: "fullscreen" } : {}),
  });
}

/**
 * The flags that follow the one naming the conversation. This is where Launch options become
 * flags: a Default option adds nothing. Advisor Off is not a flag (there is none): the
 * launcher sets `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for it. `--settings` is always passed,
 * for k-bench's hooks.
 */
function launchOptionArguments(options: LaunchOptions): string[] {
  const { model, effort, advisor, focusView } = options;
  return [
    ...(model === "default" ? [] : ["--model", model]),
    ...(effort === "default" ? [] : ["--effort", effort]),
    ...(advisor === "default" || advisor === "off" ? [] : ["--advisor", advisor]),
    "--settings",
    launchSettings(focusView),
  ];
}

/** Printed, and waited on, when Claude Code exits with an error. */
const ERROR_MESSAGE = "Claude Code exited with an error. Press any key to close.";

/**
 * Runs Claude Code in the folder, then ends the pane on status 0. On any other status it holds
 * the screen, so the error above it can be read, until a key is pressed. There is no shell
 * underneath: whichever way it ends, the pane ends with it.
 *
 * A restart (mode "resume") tries `--resume <conversation ID>` first. Claude Code saves a
 * conversation only after its first message, so with nothing to resume that fails with exit 1
 * and the launcher tries once more with `--session-id <conversation ID>`. This is safe
 * without looking at Claude Code's files (ADR-0005): `--session-id` fails with exit 1 on an
 * ID that already has a conversation, so the two attempts can never both run one conversation
 * and neither can fork or overwrite it. Both attempts get every Launch option, because
 * `--resume` does not restore `--settings`. Advisor Off sets
 * `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for both, because leaving out `--advisor` is not
 * enough when the owner's settings turn the advisor on.
 *
 * Arguments, never script text: the folder, the program, whether the advisor is off (1 or 0),
 * the mode, the conversation ID, then the option flags. It is plain POSIX `sh` (the wait for
 * a key uses `stty` and `dd`, not `read -n`, which zsh spells differently), so it runs the
 * same under macOS's bash-as-sh and any `sh`. The `cd` is repeated because the owner's login
 * startup files may change directory.
 */
const LAUNCHER = `
cd -- "$1"
program=$2
advisor_off=$3
mode=$4
conversation=$5
shift 5
[ "$advisor_off" = 1 ] && export CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1
if [ "$mode" = resume ]; then
  "$program" --resume "$conversation" "$@"
  [ "$?" -eq 0 ] && exit 0
fi
"$program" --session-id "$conversation" "$@"
status=$?
[ "$status" -eq 0 ] && exit 0
printf '\\n%s\\n' '${ERROR_MESSAGE}'
saved=$(stty -g)
stty -icanon -echo min 1 time 0
dd bs=1 count=1 >/dev/null 2>&1
stty "$saved"
exit "$status"
`;

/**
 * What a Claude Session's pane runs, as an argument list for `tmux new-session`.
 *
 * Three programs, each there for a reason:
 * 1. zsh with no startup files changes into `folder`. tmux ignores `-c` once its own working
 *    directory has been deleted (see `sessionCommand` in tmux.ts), and bash prints a
 *    `getcwd` error then.
 * 2. The owner's login shell (`shell`) runs `exec "$@"`. It only exists to give the launcher
 *    the owner's PATH, so `claude` resolves as in a terminal on the Host, even though
 *    launchd provides a bare environment. It is interactive too, because the Claude Code
 *    installer adds itself to PATH in `.zshrc`, which a login shell alone does not read.
 * 3. `/bin/sh` runs the launcher.
 *
 * The folder, the program and every flag are positional arguments, never spliced into a
 * script, so nothing in them can break or inject into it.
 */
export function claudeCommand(input: {
  folder: string;
  shell: string;
  program: string;
  launch: ClaudeLaunch;
}): string[] {
  const { folder, shell, program, launch } = input;
  return [
    "/bin/zsh",
    "-f",
    "-c",
    'cd -- "$1"; shift; exec "$@"',
    "zsh",
    folder,
    shell,
    "-l",
    "-i",
    "-c",
    'exec "$@"',
    "kb-login",
    "/bin/sh",
    "-c",
    LAUNCHER,
    "kb-launcher",
    folder,
    program,
    launch.options.advisor === "off" ? "1" : "0",
    launch.mode,
    launch.conversationId,
    ...launchOptionArguments(launch.options),
  ];
}
