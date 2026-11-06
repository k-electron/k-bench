/**
 * Launching Claude Code for a Claude Session (ADR-0005). k-bench starts it through its
 * documented command-line flags and never reads its output or its files, so everything
 * k-bench knows about Claude Code is in this file: the flags it passes and the launcher
 * script that runs it.
 */

import {
  DEFAULT_LAUNCH_OPTIONS,
  LAUNCH_CHOICES,
  type LaunchOptions,
} from "../shared/launch-options.ts";

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
 * Both keys are needed: focus view does nothing without the fullscreen renderer, and
 * fullscreen is not the default on every machine. `--settings` applies to that launch only
 * and leaves the owner's settings files unchanged.
 */
const FOCUS_VIEW_SETTINGS = '{"viewMode":"focus","tui":"fullscreen"}';

/**
 * The flags that follow the one naming the conversation. This is where Launch options become
 * flags: a Default option adds nothing. Advisor Off is not a flag (there is none): the
 * launcher sets `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for it.
 */
function launchOptionArguments(options: LaunchOptions): string[] {
  const { model, effort, advisor, focusView } = options;
  return [
    ...(model === "default" ? [] : ["--model", model]),
    ...(effort === "default" ? [] : ["--effort", effort]),
    ...(advisor === "default" || advisor === "off" ? [] : ["--advisor", advisor]),
    ...(focusView ? ["--settings", FOCUS_VIEW_SETTINGS] : []),
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
