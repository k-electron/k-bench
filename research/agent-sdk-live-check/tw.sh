#!/bin/bash
# tw.sh <seconds-max> <regex> : wait until pane matches regex (polls), then print pane
max=$1; re=$2
for i in $(seq 1 $max); do
  S=$(tmux -L livecheck capture-pane -p -t t)
  if echo "$S" | grep -q -E "$re"; then break; fi
  perl -e 'select(undef,undef,undef,1)'
done
tmux -L livecheck capture-pane -p -t t | grep -v '^\s*$' | tail -${3:-25}
