#!/usr/bin/env bash
# before/after on the 15 Pro: probe with the real zxPluginsInject
cd /home/ryha/runs/iFizBox/s4
trap 'tools/ui-15.sh unlock B393' EXIT
id=com.ryha.ifizbox.probe.zx; b=tools/resignprobe/build
R() { echo "=== $*"; timeout 240 tools/resignprobe/run.sh B393 "$@" 2>&1 | grep -v -E '^\s*$' | cut -c1-260; }
fresh() { R uninstall zx; rm -f $b/seen-$id; }
fresh
R web A --no-groupfix --probe probe-zx; sleep 12
echo "--- main's fix"; SIGNER_REPO=/home/ryha/repos/iFizBox R web A --probe probe-zx
fresh
R web A --no-groupfix --probe probe-zx; sleep 12
echo "--- this branch"; R web A --probe probe-zx
PROBE_ID=$id R check again
R web A --probe probe-zx
echo "--- fresh install (shim folder left in the profile group?)"; fresh
R web A --probe probe-zx
