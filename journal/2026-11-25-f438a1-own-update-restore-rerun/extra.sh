#!/bin/bash
# extra.sh off|none|left : one run of that kind
S=$(dirname $0); cd /home/ryha/runs/iFizBox/s1; echo "#### $1 $(date +%T)"
case $1 in off) v=ts r=false m=front;; none) v=ours r=true m=front;; left) v=ts r=true m=home;; esac
tools/ui-15.sh F438a1 install $S/base.ipa >/dev/null || echo INSTALL FAILED
python3 $S/vpn.py $v || exit 1
tools/ui-15.sh F438a1 launch; sleep 6; bash $S/set.sh $r
timeout 40 node $S/ev.mjs 'const s=await ifizboxNative.call("idevice.status");return "before: otherVPN "+s.otherVPN+" restore "+s.vpn.restore+" remembered "+s.vpn.remembered+" entitled "+s.vpn.entitled'
$S/run.sh $1 $m
tools/ui-15.sh F438a1 install $S/base.ipa >/dev/null || echo INSTALL FAILED; echo "rig build in: $(bash $S/ver.sh)"
bash $S/mark.sh $1-rig; tools/ui-15.sh F438a1 launch; sleep 9
timeout 40 node $S/ev.mjs 'const s=await ifizboxNative.call("idevice.status");const d=await new Promise(r=>{ifizboxNative.call("restore.due",{stream:true},e=>r(e));setTimeout(()=>r("none"),4000)});return "return: otherVPN "+s.otherVPN+" restore "+s.vpn.restore+" due "+JSON.stringify(d)'
tools/ui-15.sh F438a1 shot f438a1-$1-return >/dev/null; bash $S/mark.sh $1-return
[ $1 = left ] && { timeout 60 node $S/ev.mjs 'return "answer "+JSON.stringify(await ifizboxNative.call("restore.answer",{answer:"on"}))' 40; sleep 8; timeout 40 node $S/ev.mjs 'const s=await ifizboxNative.call("idevice.status");return "after the answer: otherVPN "+s.otherVPN'; bash $S/mark.sh left-answered; }
