#!/bin/bash
# back to the rig build, opened; what is so before a run
S=$(dirname $0); cd /home/ryha/runs/iFizBox/s1
tools/ui-15.sh F438a install $S/base.ipa >/dev/null || echo INSTALL FAILED; tools/ui-15.sh F438a launch; sleep 8
timeout 40 node $S/ev.mjs 'const s=await ifizboxNative.call("idevice.status");const d=await new Promise(r=>{ifizboxNative.call("restore.due",{stream:true},e=>r(e));setTimeout(()=>r("none"),4000)});return "before: otherVPN "+s.otherVPN+" restore "+s.vpn.restore+" due "+JSON.stringify(d)'
