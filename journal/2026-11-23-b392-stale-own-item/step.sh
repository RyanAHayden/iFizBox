#!/usr/bin/env bash
# step.sh BUNDLE-SUFFIX("" = probe) run.sh args...: one tools/resignprobe/run.sh step, then the early dylib's last record
set -uo pipefail
cd "$(dirname "$0")/../.."
suf=$1; shift
. native/brand.env
id=$BRAND_BUNDLE_ID.probe${suf:+.$suf}
echo "### $id $*"
tools/resignprobe/run.sh B392 "$@" ${suf:+--probe probe-$suf} 2>&1 | grep -E "INSTALL|launch|kc-plain|no report"
sleep 5
d=tools/resignprobe/build/early-$id; mkdir -p "$d"; rm -f "$d/early.log"
(cd ~/.local/share/ifizbox-rig && timeout 60 ios --udid=00008130-0018450C3661001C fsync --app="$id" pull --srcPath=/Documents/early.log --dstPath="$OLDPWD/$d") >/dev/null 2>&1
# the last launch's record (it starts at "== now")
awk '/^== now/{r=""} {r=r $0 "\n"} END{printf "%s", r}' "$d/early.log" | if [ "${FULL:-0}" = 1 ]; then cat; else grep -E "^==|fix|LOG|^  (Documents|Library|tmp)?/ "; fi
