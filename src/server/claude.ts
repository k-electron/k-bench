/**
 * Launching Claude Code for a Claude Session (ADR-0005). k-bench starts it through its
 * documented command-line flags and never reads its output or its files, so everything
 * k-bench knows about Claude Code is in this file: the flags it passes and the launcher
 * script that runs it.
 */

/** What a Claude Session is started with. */
export interface ClaudeLaunch {
  /** The Claude conversation the Session runs: a UUID k-bench generated at creation. */
  conversationId: string;
}

/**
 * The flags that follow the program's name. This is where Launch options become flags:
 * a Default option adds nothing.
 */
export function claudeArguments(launch: ClaudeLaunch): string[] {
  return ["--session-id", launch.conversationId];
}

/** Printed, and waited on, when Claude Code exits with an error. */
const ERROR_MESSAGE = "Claude Code exited with an error. Press any key to close.";

/**
 * Runs the command it is given in the folder, then ends the pane on status 0. On any other
 * status it holds the screen, so the error above it can be read, until a key is pressed.
 * There is no shell underneath: whichever way it ends, the pane ends with it.
 *
 * Arguments, never script text: `$1` is the folder, the rest is the command. It is plain
 * POSIX `sh` (the wait for a key uses `stty` and `dd`, not `read -n`, which zsh spells
 * differently), so it runs the same under macOS's bash-as-sh and any `sh`. The `cd` is
 * repeated because the owner's login startup files may change directory.
 */
const LAUNCHER = `
cd -- "$1"
shift
"$@"
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
    ...claudeArguments(launch),
  ];
}
