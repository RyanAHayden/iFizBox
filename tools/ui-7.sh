#!/bin/sh
# Drive the iPhone 7's screen (iOS 15.8.8, palera1n rootless; iFizBox's .deb test phone). One agent at a time:
# every action needs the UI lock (ssh, dpkg and reading files don't).
#   tools/ui-7.sh lock ME           take the lock (fails, naming the holder, if someone else has it)
#   tools/ui-7.sh ME tap X Y        tap at screenshot pixels (750x1334 portrait)
#   tools/ui-7.sh ME swipe X1 Y1 X2 Y2 [secs]
#   tools/ui-7.sh ME open URL       uiopen, e.g. ifizbox://sources (an ifizbox:// open checks the app runs, retries once)
#   tools/ui-7.sh ME home           Home button
#   tools/ui-7.sh ME lock-button    side button (locks or wakes the screen)
#   tools/ui-7.sh ME shot NAME      screenshot -> ref/7/screens/NAME.png (nothing kept on the phone)
#   tools/ui-7.sh unlock ME         release it; always do this when done, even after a failure
# ME is your task ID. A lock unused for 30 minutes is stale and can be taken over.
# Taps, swipes and buttons come from phonectl on the phone (tools/phonectl/, installed setuid in /var/jb/usr/local/bin).
set -eu
lock=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-7-ui.lock  # outside the repo: shared by every worktree on this machine
host=${IFIZBOX_7_HOST:-7}
stale=30
pc=/var/jb/usr/local/bin/phonectl

holder() { cat "$lock/owner" 2>/dev/null || echo '?'; }
case $1 in
  lock)
    if ! mkdir "$lock" 2>/dev/null; then
      if [ "$(holder)" != "$2" ] && [ -z "$(find "$lock/owner" -mmin +$stale 2>/dev/null)" ]; then
        echo "iPhone 7 UI is locked by $(holder) (touched $(date -r "$lock/owner" +%H:%M)); try again later" >&2
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
[ "$(holder)" = "$me" ] || { echo "take the lock first: tools/ui-7.sh lock $me (held by $(holder))" >&2; exit 1; }
touch "$lock/owner"
case $cmd in
  tap) ssh "$host" "$pc tap $1 $2" ;;
  swipe) ssh "$host" "$pc swipe $*" ;;
  open)
    # B38: a cold ifizbox:// open now and then shows the launch zoom and drops back to the Home Screen, with no crash
    # log (also seen with Sileo, R16a): SpringBoard drops the launch, the app never runs. If the app isn't running
    # 3 s later, open it once more.
    ssh "$host" "uiopen '$1'"
    case $1 in
      ifizbox:*)
        . "$(dirname "$0")/../native/brand.env"
        app="UIKitApplication:$BRAND_BUNDLE_ID\["
        ssh "$host" "sleep 3; launchctl list | grep -q '$app' || { echo 'not running after open, opening again' >&2; uiopen '$1'; sleep 3; launchctl list | grep -q '$app'; }" ||
          { echo "open $1: $BRAND_NAME still isn't running" >&2; exit 1; } ;;
    esac ;;
  home) ssh "$host" "$pc home" ;;
  lock-button) ssh "$host" "$pc lock" ;;
  shot)
    dir=$(dirname "$0")/../ref/7/screens; mkdir -p "$dir"
    ssh "$host" "$pc shot -" > "$dir/$1.png"
    echo "$dir/$1.png" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
