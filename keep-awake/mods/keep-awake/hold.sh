#!/bin/sh
# Keeps macOS or Linux from sleeping while this process lives (the display may still turn off).
# Run by the keep-awake mod; --stop only ends the helpers already running.
me=$$

# One helper at a time: a reloaded mod or a second start replaces the old one.
# Anchored to how the mod runs it ("sh <path>"), so an editor with this file open is left alone.
for pid in $(pgrep -f '^sh [^ ]*keep-awake/hold\.sh' 2>/dev/null); do
  if [ "$pid" != "$me" ]; then kill "$pid" 2>/dev/null; fi
done
if [ "$1" = "--stop" ]; then exit 0; fi

# The blocker watches this script and lets go within seconds of it ending, however it ends.
case "$(uname -s)" in
  Darwin)
    caffeinate -i -w "$me" &
    ;;
  Linux)
    command -v systemd-inhibit >/dev/null 2>&1 || { echo "systemd-inhibit not found" >&2; exit 1; }
    systemd-inhibit --what=sleep:idle --who=Herdr --why="Keep awake" --mode=block \
      sh -c "while kill -0 $me 2>/dev/null; do sleep 2; done" &
    ;;
  *)
    echo "unsupported system: $(uname -s)" >&2
    exit 1
    ;;
esac
blocker=$!
sleep 1
kill -0 "$blocker" 2>/dev/null || { echo "could not block sleep" >&2; exit 1; }

# The mod starts a new helper when this one ends, so the computer is never held long
# after Herdr is gone: 9 minutes at most (under exec's 10-minute cap), 5 seconds if it quit.
parent=$PPID
i=0
while [ "$i" -lt 108 ]; do
  sleep 5
  kill -0 "$parent" 2>/dev/null || break
  i=$((i + 1))
done
