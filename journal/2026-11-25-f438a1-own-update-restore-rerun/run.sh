#!/bin/bash
# run.sh NAME MODE(front|home|late): one own update, log to NAME.log
S=$(dirname $0); U=00008130-0018450C3661001C; cd /home/ryha/runs/iFizBox/s1
timeout 220 env PYTHONUNBUFFERED=1 pymobiledevice3 syslog live --udid $U -e 'iFizBox install|self-close|termination reported by launchd.*ifizbox|errorsystem.*ifizbox|com.ryha.ifizbox.*(Install complete|finished install)|VPN .* is (connected|disconnected)|Received terminate request response|AssertionAcquisitionFailure|Restore My VPN|cannot be launched|installing or uninstalling|Installing.*ifizbox' >$S/$1.log 2>/dev/null &
P=$!; sleep 2
timeout 60 node $S/ev.mjs 'window.__x=ifizboxNative.call("library.install",{file:"F438a1.ipa",route:"idevice",stream:true},()=>{}).then(r=>window.__i="ok",e=>window.__i="ERR "+(e.message||e));return 1' >/dev/null
[ "$2" = home ] && { sleep 1; tools/ui-15.sh F438a1 home; }
[ "$2" = late ] && { for i in $(seq 1 100); do grep -q 'IPA copied' $S/$1.log && break; sleep .2; done; sleep 4; tools/ui-15.sh F438a1 home; }
for i in $(seq 1 60); do sleep 1; grep -q 'self-close: exit' $S/$1.log && grep -q 'self-close: exit$\|exit (backstop' $S/$1.log && break; done
[ -n "$(jobs -p)" ]; sleep 12; tools/ui-15.sh F438a1 shot f438a1-$1 >/dev/null; sleep 3
v=$(cd ~/.local/share/ifizbox-rig; ios --udid=$U apps 2>/dev/null | python3 -c 'import json,sys
for l in sys.stdin:
  try: d=json.loads(l)
  except Exception: continue
  for a in (d if isinstance(d,list) else []):
    if a.get("CFBundleIdentifier")=="com.ryha.ifizbox": print(a["CFBundleShortVersionString"])')
bash $S/mark.sh $1-installed
tools/ui-15.sh F438a1 launch; sleep 7
echo "== $1 $2 version $v (no swipe, no reopen before this reading)"
timeout 40 node $S/ev.mjs 'return await new Promise(r=>{ifizboxNative.call("restore.due",{stream:true},e=>r("new copy due "+JSON.stringify(e)));setTimeout(()=>r("no due answer"),4000)})'
bash $S/mark.sh $1-opened
tools/ui-15.sh F438a1 shot f438a1-$1-new >/dev/null
kill $P 2>/dev/null
echo "Shortcut runs in the log: $(grep -c 'Restore My VPN Shortcut: back' $S/$1.log); last VPN states:"
grep -E 'SpringBoard.*VPN (Tailscale|iFizBox VPN) .* is ' $S/$1.log | sed -E 's/^[^ ]+ ([0-9:.]+) .*VPN (Tailscale|iFizBox VPN) .* is (.*)/\1 \2 \3/' | tail -3
grep -E 'before the close|self-close: ex|vpn: off|Restore My VPN:|not run' $S/$1.log | cut -c12-200
