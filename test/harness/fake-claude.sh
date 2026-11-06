#!/bin/sh
# A stand-in for Claude Code, so no test runs the real `claude`. The test harness copies it
# next to an empty `conversations` folder in each test instance and points the instance
# config's Claude Code program at the copy.
#
# It prints what it was started with (the folder it runs in, each argument, whether the
# advisor is turned off), then reads lines the way Claude Code reads messages:
#   exit N   quits with status N
#   bell     rings the terminal bell
#   (other)  is a message: the conversation is saved, as Claude Code does once the first
#            message is sent, and the stub answers "claude-stub heard: <message>"
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
for arg in "$@"; do
  echo "claude-stub arg: $arg"
  case $previous in
    --resume) resume=$arg ;;
    --session-id) fresh=$arg ;;
  esac
  previous=$arg
done

if [ -n "$resume" ] && [ ! -e "$saved/$resume" ]; then
  echo "No conversation found with session ID: $resume"
  exit 1
fi
if [ -n "$fresh" ] && [ -e "$saved/$fresh" ]; then
  echo "Session ID $fresh is already in use."
  exit 1
fi
id=${resume:-$fresh}

echo "claude-stub ready"
while IFS= read -r line; do
  case $line in
    "exit "*) exit "${line#exit }" ;;
    bell) printf '\a' ;;
    *)
      : >"$saved/$id"
      echo "claude-stub heard: $line"
      ;;
  esac
done
exit 0
