#!/bin/sh
# A stand-in for Claude Code, so no test runs the real `claude`. The test harness copies it
# next to an empty `conversations` folder in each test instance and points the instance
# config's Claude Code program at the copy.
#
# It prints what it was started with (the folder it runs in, each argument, whether the
# advisor is turned off), then reads lines the way Claude Code reads messages:
#   exit N   quits with status N
#   bell     rings the terminal bell
#   /compact compacts the conversation: the saved conversation starts again at a summary
#   (other)  is a message: the conversation is saved, as Claude Code does once the first
#            message is sent, and the stub answers "claude-stub heard: <message>"
# The conversation is also written, as Claude Code writes it, to a Claude Code folder of the
# test's own beside this script (`claude-config`, see fake-claude-session.mjs), where the
# Agent SDK reads it back when a Session returns from the terminal to the web.
# It fails as Claude Code does: --resume of a conversation it never saved, and --session-id
# of one it did save, each exit 1.
#
# Run with `--input-format stream-json`, as the Agent SDK runs Claude Code, it is not a
# terminal program at all: it hands over to fake-claude-sdk.mjs, under the `node` linked
# beside it (the harness puts both there).

here=$(dirname "$0")
case " $* " in
  *" --input-format stream-json "*) exec "$here/node" "$here/fake-claude-sdk.mjs" "$@" ;;
esac
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

# The folder-trust question, when the test asked for it (`FakeClaude.requireTrust()`): like
# Claude Code's, its default option is "No, exit", which quits; the cursor (❯) moves with the
# arrow keys and Enter confirms the option it is on.
if [ -e "$here/trust-required" ]; then
  sel=1
  saved_tty=$(stty -g 2>/dev/null)
  stty -icanon -echo min 1 time 0 2>/dev/null
  esc=$(printf '\033')
  while :; do
    printf '\033[2J\033[H'
    echo "Do you trust the files in this folder?"
    if [ "$sel" = 1 ]; then
      echo "❯ 1. No, exit"
      echo "  2. Yes, I trust this folder"
    else
      echo "  1. No, exit"
      echo "❯ 2. Yes, I trust this folder"
    fi
    key=$(dd bs=1 count=1 2>/dev/null)
    if [ "$key" = "$esc" ]; then
      dd bs=1 count=2 >/dev/null 2>&1
      sel=$((3 - sel))
    elif [ -z "$key" ]; then
      if [ "$sel" = 1 ]; then
        stty "$saved_tty" 2>/dev/null
        echo "claude-stub trust refused"
        exit 1
      fi
      break
    fi
  done
  stty "$saved_tty" 2>/dev/null
  printf '\033[2J\033[H'
fi

echo "claude-stub ready"
while IFS= read -r line; do
  case $line in
    "exit "*) exit "${line#exit }" ;;
    bell) printf '\a' ;;
    /compact)
      "$here/node" "$here/fake-claude-session.mjs" "$here/claude-config" "$id" compact
      echo "claude-stub compacted"
      ;;
    *)
      : >"$saved/$id"
      "$here/node" "$here/fake-claude-session.mjs" "$here/claude-config" "$id" turn "$line"
      echo "claude-stub heard: $line"
      ;;
  esac
done
exit 0
