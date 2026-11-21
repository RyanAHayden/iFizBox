#!/bin/sh
# Drive the 4S's screen. One agent at a time: every action needs the UI lock (pulling files over ssh doesn't).
#   tools/ui-4s.sh lock ME           take the lock (fails, naming the holder, if someone else has it)
#   tools/ui-4s.sh ME tap X Y        stouch tap, points (320x480 portrait)
#   tools/ui-4s.sh ME swipe X1 Y1 X2 Y2 [secs]
#   tools/ui-4s.sh ME open URL       uiopen, e.g. cydia://sources
#   tools/ui-4s.sh ME home           home button
#   tools/ui-4s.sh ME shot NAME      screenshot -> ref/4s/screens/NAME.png (stays in the Camera Roll: no rm on the 4S)
#   tools/ui-4s.sh unlock ME         release it; always do this when done, even after a failure
# ME is your task ID. A lock unused for 30 minutes is stale and can be taken over.
set -eu
lock=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-4s-ui.lock  # outside the repo: shared by every worktree on this machine
host=${IFIZBOX_4S_HOST:-4s}
stale=30

holder() { cat "$lock/owner" 2>/dev/null || echo '?'; }
case $1 in
  lock)
    if ! mkdir "$lock" 2>/dev/null; then
      if [ "$(holder)" != "$2" ] && [ -z "$(find "$lock/owner" -mmin +$stale 2>/dev/null)" ]; then
        echo "4S UI is locked by $(holder) (touched $(date -r "$lock/owner" +%H:%M)); try again later" >&2
        exit 1
      fi
      echo "taking over from $(holder)" >&2
    fi
    echo "$2" > "$lock/owner"
    # the runner slot that holds it, so tools/ui-release.sh frees it when that slot's session ends
    if [ -n "${AGENT_SLOT:-}" ]; then echo "$AGENT_SLOT" > "$lock/slot"; else rm -f "$lock/slot"; fi
    exit 0 ;;
  unlock)
    [ "$(holder)" = "$2" ] && rm -rf "$lock"; exit 0 ;;
esac

me=$1; cmd=$2; shift 2
[ "$(holder)" = "$me" ] || { echo "take the lock first: tools/ui-4s.sh lock $me (held by $(holder))" >&2; exit 1; }
touch "$lock/owner"
case $cmd in
  tap) ssh "$host" "stouch touch $1 $2" 2>/dev/null ;;
  swipe) ssh "$host" "stouch swipe $*" 2>/dev/null ;;
  open) ssh "$host" "uiopen '$1'" 2>/dev/null ;;
  home) ssh "$host" 'activator send libactivator.system.homebutton' 2>/dev/null ;;
  shot)
    dir=$(dirname "$0")/../ref/4s/screens; mkdir -p "$dir"
    f=$(ssh "$host" 'activator send libactivator.system.take-screenshot 2>/dev/null; sleep 2; ls -t /var/mobile/Media/DCIM/100APPLE/*.PNG | head -1')
    scp -q "$host:$f" "$dir/$1.png"; echo "$dir/$1.png" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
