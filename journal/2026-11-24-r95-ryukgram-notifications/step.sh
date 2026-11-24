#!/usr/bin/env bash
# step.sh NAME: install $R95_SCRATCH/NAME.ipa as is on the 15 Pro, launch Instagram, wait, pull the probe's two reports and the group fix log.
S=$R95_SCRATCH; cd "$(dirname "$0")/../.."
tools/ui-15.sh R95 wake >/dev/null 2>&1
echo "== install $1"; timeout 500 tools/ui-15.sh R95 install $S/$1.ipa --as-is 2>&1 | tail -3
tools/ui-15.sh R95 wake >/dev/null 2>&1
tools/ui-15.sh R95 launch com.burbn.instagram 2>&1 | tail -1
sleep 100
cd ~/.local/share/ifizbox-rig
for f in r95-t25.txt r95-t80.txt ifizbox-groupfix.log; do timeout 120 pymobiledevice3 apps pull com.burbn.instagram Library/$f $S/$1-$f >/dev/null 2>&1; done
ls -la $S/$1-* | cut -c30-
