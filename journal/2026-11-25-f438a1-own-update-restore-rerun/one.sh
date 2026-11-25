#!/bin/bash
# one.sh NAME MODE: Tailscale on, rig build opened, one run, strong check
S=$(dirname $0); cd /home/ryha/runs/iFizBox/s1; echo "#### $1 $(date +%T)"
python3 $S/vpn.py ts || exit 1
tools/ui-15.sh F438a1 launch; sleep 6; bash $S/set.sh true
timeout 40 node $S/ev.mjs 'const s=await ifizboxNative.call("idevice.status");return "before: otherVPN "+s.otherVPN+" restore "+s.vpn.restore+" remembered "+s.vpn.remembered+" entitled "+s.vpn.entitled'
$S/run.sh $1 $2; $S/strong.sh $1
