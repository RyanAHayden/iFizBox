#!/bin/bash
# strong.sh NAME: rig build over it, not opened; Tailscale off and iFizBox VPN selected; opened: must not ask
S=$(dirname $0); cd /home/ryha/runs/iFizBox/s1
tools/ui-15.sh F438a1 install $S/base.ipa >/dev/null || echo INSTALL FAILED; echo "rig build in: $(bash $S/ver.sh)"
python3 $S/vpn.py ours; bash $S/mark.sh $1-rig
tools/ui-15.sh F438a1 launch; sleep 9
timeout 40 node $S/ev.mjs 'const s=await ifizboxNative.call("idevice.status");const d=await new Promise(r=>{ifizboxNative.call("restore.due",{stream:true},e=>r(e));setTimeout(()=>r("none"),4000)});return "strong: otherVPN "+s.otherVPN+" on "+s.vpn.on+" restore "+s.vpn.restore+" remembered "+s.vpn.remembered+" due "+JSON.stringify(d)'
sleep 3; timeout 40 node $S/ev.mjs 'return await new Promise(r=>{ifizboxNative.call("restore.due",{stream:true},e=>r("strong, again: due "+JSON.stringify(e)));setTimeout(()=>r("no due answer"),4000)})'
tools/ui-15.sh F438a1 shot f438a1-$1-strong >/dev/null; bash $S/mark.sh $1-strong
