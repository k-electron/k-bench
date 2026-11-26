#!/bin/sh
# A stand-in for Claude Code, so no test runs the real `claude`. The test harness copies it
# next to an empty `conversations` folder in each test instance and points the instance
# config's Claude Code program at the copy.
#
# It prints what it was started with (the folder it runs in, each argument, whether the
# advisor is turned off). `--settings` and its value are not printed as arguments: it prints
# the settings without their hooks as one `claude-stub settings:` line instead, and runs the
# settings' hook commands as Claude Code does, with the event's JSON on stdin (`session_id`,
# `hook_event_name` and the event's own fields). SessionStart runs at start (source
# `startup`, or `resume` for --resume) and on `clear`. Claude Code adds what a SessionStart
# or UserPromptSubmit hook prints to the conversation, so the stub prints that as
# `claude-stub context: <output>`; any other hook's output is dropped. An `ignore-settings`
# file beside it makes it ignore --settings, as Claude Code does when hooks can't run. It
# prints `claude-stub conversation: <id>` once the hooks have run.
# Then it reads lines the way Claude Code reads messages:
#   exit N   quits with status N
#   bell     rings the terminal bell
#   clear    switches to a new conversation ID, as /clear does; like any conversation it is
#            saved only once a message is sent
#   think    is a message whose turn stays open: UserPromptSubmit runs, and Stop doesn't,
#            until the next message
#   (other)  is a message, one whole turn: UserPromptSubmit runs, the conversation is saved,
#            as Claude Code does once the first message is sent, the stub answers
#            "claude-stub heard: <message>", and Stop runs
# It fails as Claude Code does: --resume of a conversation it never saved, and --session-id
# of one it did save, each exit 1.

here=$(dirname "$0")
saved="$here/conversations"
mkdir -p "$saved"

echo "claude-stub cwd: $(pwd)"
echo "claude-stub advisor tool disabled: ${CLAUDE_CODE_DISABLE_ADVISOR_TOOL:-unset}"
previous=
resume=
fresh=
settings=
for arg in "$@"; do
  case $previous in
    --resume) resume=$arg ;;
    --session-id) fresh=$arg ;;
    --settings) settings=$arg ;;
  esac
  [ "$arg" != --settings ] && [ "$previous" != --settings ] &&
    echo "claude-stub arg: $arg"
  previous=$arg
done
[ -e "$here/ignore-settings" ] && settings=

if [ -n "$settings" ]; then
  echo "claude-stub settings: $(printf '%s' "$settings" | plutil -remove hooks -o - - 2>/dev/null ||
    printf '%s' "$settings")"
fi

# Runs every hook command the settings give for the event $1, with the JSON $2 on stdin,
# and reports what a hook prints when Claude Code would add it to the conversation.
run_hooks() {
  [ -n "$settings" ] || return 0
  group=0
  while printf '%s' "$settings" |
    plutil -extract "hooks.$1.$group" raw -o - - >/dev/null 2>&1; do
    hook=0
    while command=$(printf '%s' "$settings" |
      plutil -extract "hooks.$1.$group.hooks.$hook.command" raw -o - - 2>/dev/null); do
      output=$(printf '%s\n' "$2" | sh -c "$command")
      case $1 in
        SessionStart | UserPromptSubmit)
          [ -n "$output" ] && echo "claude-stub context: $output"
          ;;
      esac
      hook=$((hook + 1))
    done
    group=$((group + 1))
  done
}

# Claude Code's SessionStart, with the source in $1.
session_start() {
  run_hooks SessionStart \
    "$(printf '{"session_id":"%s","hook_event_name":"SessionStart","source":"%s"}' "$id" "$1")"
}

# Claude Code's UserPromptSubmit, for the message in $1.
prompt_submit() {
  prompt=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  run_hooks UserPromptSubmit \
    "$(printf '{"session_id":"%s","hook_event_name":"UserPromptSubmit","prompt":"%s"}' "$id" "$prompt")"
}

# Claude Code's Stop, once a turn has ended.
turn_stop() {
  run_hooks Stop \
    "$(printf '{"session_id":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$id")"
}

if [ -n "$resume" ] && [ ! -e "$saved/$resume" ]; then
  echo "No conversation found with session ID: $resume"
  exit 1
fi
if [ -n "$fresh" ] && [ -e "$saved/$fresh" ]; then
  echo "Session ID $fresh is already in use."
  exit 1
fi
id=${resume:-$fresh}
if [ -n "$resume" ]; then session_start resume; else session_start startup; fi
echo "claude-stub conversation: $id"

echo "claude-stub ready"
while IFS= read -r line; do
  case $line in
    "exit "*) exit "${line#exit }" ;;
    bell) printf '\a' ;;
    clear)
      id=$(uuidgen | tr 'A-Z' 'a-z')
      session_start clear
      echo "claude-stub conversation: $id"
      ;;
    think)
      prompt_submit "$line"
      : >"$saved/$id"
      echo "claude-stub thinking"
      ;;
    *)
      prompt_submit "$line"
      : >"$saved/$id"
      echo "claude-stub heard: $line"
      turn_stop
      ;;
  esac
done
exit 0
