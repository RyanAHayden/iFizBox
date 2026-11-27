#!/bin/bash
# cancel.sh NAME: Tailscale on, Restore My VPN on, library.install of B490.ipa (a 300 MB test app, its own bundle ID)
# through This iPhone, Cancel (signing.cancel) once the copy has begun, then the log until Shortcuts opened. NAME.log.
S=$(cd $(dirname $0); pwd); U=00008130-0018450C3661001C; cd /home/ryha/runs/iFizBox/s5
EV=$S/ev.mjs # PAGE=<our app's cdp page id> in the environment: another iFizBox copy on the phone has a page too
[ -n "$PAGE" ] || { echo "PAGE= not set"; exit 2; }
echo "#### $1 $(date +%T)"
timeout 30 node $EV 'const s=await ifizboxNative.call("vpn.setRestore",{on:true});const t=await ifizboxNative.call("idevice.status");return "restore "+s.restore+" remembered "+s.remembered+" otherVPN "+t.otherVPN'
timeout 120 env PYTHONUNBUFFERED=1 pymobiledevice3 syslog live --udid $U -e 'iFizBox install|VPN .* is (connected|disconnected)|com\.apple\.shortcuts|WFShortcuts|Shortcuts\[' >$S/$1.log 2>/dev/null &
P=$!; sleep 2
timeout 30 node $EV 'window.__x=ifizboxNative.call("library.install",{file:"B490.ipa",route:"idevice",stream:true},()=>{}).then(r=>window.__i="ok",e=>window.__i="ERR "+(e.message||e));return 1' >/dev/null
for i in $(seq 1 150); do grep -q 'AFC: [0-9.]* MB of' $S/$1.log && break; sleep .2; done
echo "cancel at $(date +%H:%M:%S.%N | cut -c1-12)" | tee $S/$1.cancel # not in NAME.log: its writer overwrites it
timeout 30 node $EV 'return await ifizboxNative.call("signing.cancel",{})'
sleep 40
timeout 30 node $EV 'return "page: "+window.__i'
kill $P 2>/dev/null
echo "== $1"
cat $S/$1.cancel
grep -E 'AFC: (copied|[0-9.]* MB of)|cancelled|vpn: off|Restore My VPN|installd: (install asked|Complete)|installed|failed|Received request to open "com.apple.shortcuts"|SpringBoard\{NetworkExtension\}.*Tailscale.* is connected' $S/$1.log |
  cut -c12-26,60-200 | awk '!seen[$0]++' | head -40
