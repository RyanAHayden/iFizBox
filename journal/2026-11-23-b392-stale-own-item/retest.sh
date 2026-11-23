#!/usr/bin/env bash
# A to E again with the committed dylib. Needs the phone's lock.
cd "$(dirname "$0")/../.."; J=journal/2026-11-23-b392-stale-own-item
end=$((SECONDS+3000)); got=0
while [ $SECONDS -lt $end ]; do tools/ui-15.sh lock B392 2>/dev/null && { got=1; break; }; sleep 10; done
[ $got = 1 ] || { echo "no lock"; exit 1; }
trap 'tools/ui-15.sh unlock B392' EXIT
u() { tools/resignprobe/run.sh B392 uninstall "$@" >/dev/null 2>&1; }
b() { EARLY_FLAGS=$1 bash $J/build-early.sh "$2" >/dev/null 2>&1 || echo "BUILD FAILED $1 $2"; }
s() { timeout 150 $J/step.sh "$@"; }
u; u two
b "" ""; echo "== A"; s "" native A; u
b -DWRITE ""; echo "== B"; s "" sidedrop A
b "" ""; echo "== C"; s "" native A; s "" native A; u
echo "== D"; b -DWRITE two; s two native A --no-groupfix
b -DWRITE ""; s "" sidedrop A
b "" two; s two native A
echo "== E"; u two; s two native A; b -DCLEAR two; s two native A
u; u two
