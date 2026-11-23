#!/bin/sh
# Drive the iPhone 15 Pro's screen (iOS 27, no jailbreak; iFizBox's sideload/Lite test phone, on this machine's USB)
# from Linux: go-ios (tunnel, disk image, install, screenshots) + WebDriverAgent on the phone (touches, buttons).
# One agent at a time: every action needs the UI lock.
#   tools/ui-15.sh lock ME            take the lock (fails, naming the holder, if someone else has it)
#   tools/ui-15.sh ME up              start tunnel, disk image, WebDriverAgent (every command does this when needed)
#   tools/ui-15.sh ME tap X Y         tap at screenshot pixels (1179x2556 portrait)
#   tools/ui-15.sh ME swipe X1 Y1 X2 Y2 [secs]
#   tools/ui-15.sh ME type TEXT       type into the focused field
#   tools/ui-15.sh ME open URL        open a URL, e.g. ifizbox://sources
#   tools/ui-15.sh ME launch BUNDLE   launch (or bring forward) an app; the brand's ID if BUNDLE is omitted
#   tools/ui-15.sh ME install IPA [--as-is]  sign an .ipa for this phone (zsign, the team's ad hoc profile; keeps
#                                     its bundle ID and Keychain groups, like the app's own signer) and install it;
#                                     --as-is: no signing
#   tools/ui-15.sh ME home            Home
#   tools/ui-15.sh ME lock-button     lock the screen;  ME wake: wake and unlock it (no passcode on this phone)
#   tools/ui-15.sh ME reboot          restart the phone, wait for it, bring WDA back and unlock it (about a minute)
#   tools/ui-15.sh ME shot NAME       screenshot -> ref/15/screens/NAME.png
#   tools/ui-15.sh ME source          the frontmost app's accessibility tree (XML)
#   tools/ui-15.sh unlock ME          close every app, lock the screen and release it; always do this when done, even
#                                     after a failure (IFIZBOX_UI_TIDY=0: just release it)
# ME is your task ID. A lock unused for 30 minutes is stale and can be taken over. Setup: docs/iphone15.md.
# Take it only for what Chromium (tools/readme_shots.py, fake bridge) and node --test can't check (AGENTS.md), and
# keep `trap 'tools/ui-15.sh unlock ME' EXIT` beside it in a script. When a session ends or is dropped, the runner
# frees its task's locks (runner.toml on_exit: tools/ui-release.sh).
set -eu
lock=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-15-ui.lock  # outside the repo: shared by every worktree on this machine
run=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-15           # logs of the background tunnel, WDA and port forward
rig=${IFIZBOX_15_RIG:-$HOME/.local/share/ifizbox-rig}  # WDA.ipa, ddi/, ca-bundle.pem, zsign, sign/ (docs/iphone15.md)
udid=${IFIZBOX_15_UDID:-00008130-0018450C3661001C}
wda=http://127.0.0.1:8100
stale=30

holder() { cat "$lock/owner" 2>/dev/null || echo '?'; }
case $1 in
  lock)
    if ! mkdir "$lock" 2>/dev/null; then
      if [ "$(holder)" != "$2" ] && [ -z "$(find "$lock/owner" -mmin +$stale 2>/dev/null)" ]; then
        echo "iPhone 15 UI is locked by $(holder) (touched $(date -r "$lock/owner" +%H:%M)); try again later" >&2
        exit 1
      fi
      echo "taking over from $(holder)" >&2
    fi
    echo "$2" > "$lock/owner"
    # the runner slot that holds it, so tools/ui-release.sh frees it when that slot's session ends
    if [ -n "${AGENT_SLOT:-}" ]; then echo "$AGENT_SLOT" > "$lock/slot"; else rm -f "$lock/slot"; fi
    exit 0 ;;
  unlock)
    [ "$(holder)" = "$2" ] || exit 0
    [ "${IFIZBOX_UI_TIDY:-1}" = 1 ] && { sh "$0" "$2" tidy || echo "couldn't tidy the iPhone 15" >&2; }
    rm -rf "$lock"; exit 0 ;;
esac

me=$1; cmd=$2; shift 2
[ "$(holder)" = "$me" ] || { echo "take the lock first: tools/ui-15.sh lock $me (held by $(holder))" >&2; exit 1; }
touch "$lock/owner"
mkdir -p "$run"
here=$(cd "$(dirname "$0")/.." && pwd)
case ${1:-} in /*|'') ;; *) [ "$cmd" = install ] && set -- "$PWD/$1" ;; esac
cd "$rig"  # go-ios keeps its pairing identity (selfIdentity.plist) in the current directory
gi() { ios --udid="$udid" "$@" 2>>"$run/ios.log"; }
bg() { name=$1; shift; setsid nohup ios --udid="$udid" "$@" >"$run/$name.log" 2>&1 < /dev/null & }
wait_for() { i=0; until eval "$1"; do i=$((i + 1)); [ $i -lt "$2" ] || return 1; sleep 1; done; }

up() {
  curl -sf -m 3 "$wda/status" >/dev/null 2>&1 && return 0
  gi list | grep -q "$udid" || { echo "iPhone 15 ($udid) isn't on USB, or isn't trusted" >&2; exit 1; }
  if ! ios tunnel ls 2>/dev/null | grep -q "$udid"; then
    bg tunnel tunnel start --userspace
    wait_for 'ios tunnel ls 2>/dev/null | grep -q "$udid"' 30 || { echo "tunnel didn't start: $run/tunnel.log" >&2; exit 1; }
  fi
  # The disk image stays mounted until the phone reboots. Apple's signing server needs Apple's root CA (ca-bundle.pem).
  gi image list | grep -q signature ||
    SSL_CERT_FILE=$rig/ca-bundle.pem gi image mount --path="$rig/ddi/iOS_DDI/Restore" >/dev/null
  ss -ltn 'sport = :8100' | grep -q 8100 || bg forward forward 8100 8100
  if ! gi ps | grep -q WebDriverAgentRunner; then
    bg wda runwda --bundleid=com.ryha.wda.xctrunner --testrunnerbundleid=com.ryha.wda.xctrunner \
      --xctestconfig=WebDriverAgentRunner.xctest
  fi
  wait_for 'curl -sf -m 3 "$wda/status" >/dev/null 2>&1' 40 ||
    { echo "WebDriverAgent didn't answer: $run/wda.log (re-sign it? docs/iphone15.md)" >&2; exit 1; }
}
sid() {  # WDA's current session, or a new one (opening one launches nothing)
  s=$(curl -s -m 10 "$wda/status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionId") or "")')
  [ -n "$s" ] || s=$(curl -s -m 30 -X POST "$wda/session" -H 'Content-Type: application/json' \
    -d '{"capabilities":{}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionId"])')
  echo "$s"
}
post() {  # post PATH JSON: under the session; prints WDA's error, if any, and fails
  curl -s -m 60 -X POST "$wda/session/$(sid)$1" -H 'Content-Type: application/json' -d "$2" |
    python3 -c 'import json,sys; v=json.load(sys.stdin).get("value"); e=isinstance(v,dict) and v.get("error"); sys.exit(e and print(e, v.get("message",""), file=sys.stderr) or 0)'
}
pt() { python3 -c "print(round($1/3))"; }  # screenshot pixels -> points (3x)
# keychain_entitlements IPA PROFILE: the profile's entitlements the way the app's own signer writes them
# (native/sign/Profile.swift entitlements(for:keptID:)), so Keychain items written under a rig-installed build (the
# imported identity, the RemotePairing record) are still there after an in-app self-update or re-sign: keychain
# groups [TEAM.<Info.plist ID>, TEAM.<App ID>] (the first only when the profile's groups allow it),
# application-identifier TEAM.<App ID>, get-task-allow false. zsign alone would keep the profile's [TEAM.*, ...].
keychain_entitlements() {
  openssl smime -inform der -verify -noverify -in "$2" 2>/dev/null | python3 -c '
import plistlib, re, sys, zipfile
p = plistlib.loads(sys.stdin.buffer.read())
e = p["Entitlements"]
with zipfile.ZipFile(sys.argv[1]) as z:
    info = next(n for n in z.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", n))
    kept = plistlib.loads(z.read(info))["CFBundleIdentifier"]
team = e.get("com.apple.developer.team-identifier") or (p.get("TeamIdentifier") or [""])[0]
app = e["application-identifier"].split(".", 1)[1]  # Profile.bundleID(for:)
if app == "*":
    app = kept
elif app.endswith(".*"):
    app = kept if kept.startswith(app[:-1]) else app[:-1] + kept.split(".")[-1]
if team:
    if "keychain-access-groups" in e:
        own, mine = team + "." + kept, team + "." + app
        ok = any(g == own or (g.endswith("*") and own.startswith(g[:-1])) for g in e["keychain-access-groups"])
        e["keychain-access-groups"] = [own, mine] if own != mine and ok else [mine]
    e["application-identifier"] = team + "." + app
e["get-task-allow"] = False
sys.stdout.buffer.write(plistlib.dumps(e))' "$1"
}

case $cmd in
  up) up ;;
  tap)
    up; post /actions "{\"actions\":[{\"type\":\"pointer\",\"id\":\"f\",\"parameters\":{\"pointerType\":\"touch\"},\"actions\":[
      {\"type\":\"pointerMove\",\"duration\":0,\"x\":$(pt "$1"),\"y\":$(pt "$2")},{\"type\":\"pointerDown\"},
      {\"type\":\"pause\",\"duration\":80},{\"type\":\"pointerUp\"}]}]}" ;;
  swipe)
    up; ms=$(python3 -c "print(round(${5:-0.3}*1000))")
    post /actions "{\"actions\":[{\"type\":\"pointer\",\"id\":\"f\",\"parameters\":{\"pointerType\":\"touch\"},\"actions\":[
      {\"type\":\"pointerMove\",\"duration\":0,\"x\":$(pt "$1"),\"y\":$(pt "$2")},{\"type\":\"pointerDown\"},
      {\"type\":\"pointerMove\",\"duration\":$ms,\"x\":$(pt "$3"),\"y\":$(pt "$4")},{\"type\":\"pointerUp\"}]}]}" ;;
  type) up; post /wda/keys "$(python3 -c 'import json,sys; print(json.dumps({"value": list(sys.argv[1])}))' "$1")" ;;
  open) up; post /url "$(python3 -c 'import json,sys; print(json.dumps({"url": sys.argv[1]}))' "$1")" ;;
  launch)
    [ $# -gt 0 ] || { . "$here/native/brand.env"; set -- "$BRAND_BUNDLE_ID"; }
    up; post /wda/apps/activate "{\"bundleId\":\"$1\"}" ;;
  install)
    ipa=$1
    if [ "${2:-}" != --as-is ]; then
      ipa=$run/signed.ipa
      keychain_entitlements "$1" "$rig/sign/app.mobileprovision" > "$run/entitlements.plist" ||
        { echo "couldn't read the bundle ID of $1 or the profile's entitlements" >&2; exit 1; }
      "$rig/zsign" -q -z 1 -k "$rig/sign/key.pem" -c "$rig/sign/cert.pem" -m "$rig/sign/app.mobileprovision" \
        -e "$run/entitlements.plist" -o "$ipa" "$1" || { echo "zsign failed on $1" >&2; exit 1; }
    fi
    gi install --path="$ipa" >/dev/null || { echo "install failed: $run/ios.log" >&2; exit 1; }
    echo "installed $1" ;;
  home) up; curl -sf -m 30 -X POST "$wda/wda/homescreen" >/dev/null ;;
  lock-button)  # a short side-button press: WDA's /wda/lock holds it, which on iOS 27 opens Siri
    up; post /wda/performIoHidEvent '{"page":12,"usage":48,"duration":0.05}' ;;
  wake) up; curl -sf -m 30 -X POST "$wda/wda/unlock" >/dev/null ;;
  reboot)  # B238: iOS redraws notification icons only after a restart (docs/iphone15.md); back up and unlocked after
    gi reboot >/dev/null || { echo "reboot failed: $run/ios.log" >&2; exit 1; }
    wait_for '! gi list | grep -q "$udid"' 60 || { echo "the phone didn't go down" >&2; exit 1; }
    wait_for 'gi list | grep -q "$udid"' 180 || { echo "the phone didn't come back in 3 minutes" >&2; exit 1; }
    wait_for 'gi image list >/dev/null 2>&1' 60 || true  # lockdown answers a little after USB does
    up; curl -sf -m 30 -X POST "$wda/wda/unlock" >/dev/null; curl -sf -m 30 -X POST "$wda/wda/homescreen" >/dev/null
    echo "rebooted" ;;
  shot)
    dir=$here/ref/15/screens; mkdir -p "$dir"
    gi screenshot --output="$dir/$1.png" >/dev/null || { up; gi screenshot --output="$dir/$1.png" >/dev/null; }
    echo "$dir/$1.png" ;;
  tidy)  # unlock runs it: app switcher empty, Home Screen, screen off. Only when WebDriverAgent is still up.
    curl -sf -m 3 "$wda/status" >/dev/null 2>&1 || exit 0
    snap() { gi screenshot --output="$run/tidy-$1.png" >/dev/null; }
    same() { python3 "$here/tools/ui-same.py" "$run/tidy-$1.png" "$run/tidy-$2.png"; }
    # the screen can be off while WDA says unlocked, and then /wda/unlock does nothing: the side button wakes it
    snap now; python3 "$here/tools/ui-same.py" "$run/tidy-now.png" &&
      { post /wda/performIoHidEvent '{"page":12,"usage":48,"duration":0.05}'; sleep 1; }
    curl -sf -m 30 -X POST "$wda/wda/unlock" >/dev/null; curl -sf -m 30 -X POST "$wda/wda/homescreen" >/dev/null
    sleep 1; snap home; i=0
    # up from the very bottom edge: the app switcher (a W3C pointer swipe from there doesn't trigger it)
    post /wda/dragfromtoforduration '{"fromX":196,"fromY":851,"toX":196,"toY":450,"duration":0.1}'; sleep 1.5
    while [ $i -lt 40 ]; do  # ponytail: 40 cards at most; stops at the Home Screen or when nothing changes
      snap now; { same home now || { [ $i -gt 0 ] && same prev now; }; } && break
      sh "$here/tools/ui-15.sh" "$me" swipe 589 1400 589 150 0.2; sleep 0.8; mv "$run/tidy-now.png" "$run/tidy-prev.png"; i=$((i + 1))
    done
    curl -sf -m 30 -X POST "$wda/wda/homescreen" >/dev/null; sleep 1
    post /wda/performIoHidEvent '{"page":12,"usage":48,"duration":0.05}' ;;
  source) up; curl -s -m 60 "$wda/source" | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])' ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
