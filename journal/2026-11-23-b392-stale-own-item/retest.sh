#!/usr/bin/env bash
# The last dylib again: fresh (A), old way (B), ours (C). Needs the phone's lock.
cd "$(dirname "$0")/../.."; J=journal/2026-11-23-b392-stale-own-item
end=$((SECONDS+3000)); got=0
while [ $SECONDS -lt $end ]; do tools/ui-15.sh lock B392 2>/dev/null && { got=1; break; }; sleep 10; done
[ $got = 1 ] || { echo "no lock"; exit 1; }
trap 'tools/ui-15.sh unlock B392' EXIT
bash $J/build-early.sh ""
timeout 150 $J/step.sh "" native A; tools/resignprobe/run.sh B392 uninstall
timeout 150 $J/step.sh "" sidedrop A; timeout 150 $J/step.sh "" native A
tools/resignprobe/run.sh B392 uninstall
