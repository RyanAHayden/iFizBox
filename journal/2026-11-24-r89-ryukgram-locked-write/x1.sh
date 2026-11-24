#!/usr/bin/env bash
# x1.sh: RyukGram 456, plain-signed, container files all class 3 except the preferences file (class A): locked launch that lives.
# Needs ry-P-new.ipa and ry-P-old.ipa (sign.sh) in $R89_SCRATCH. OLD=1: signed with the group fix from before B415 (default).
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH; U="tools/ui-15.sh R89"
export APP_ID=com.burbn.instagram APP_LABEL=Instagram; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C
kill_app() { (cd $rig; ios --udid=$udid kill $APP_ID >/dev/null 2>&1); }
setflag() { echo x > $S/r89.$1; (cd $rig; ios --udid=$udid fsync --app=$APP_ID push --srcPath=$S/r89.$1 --dstPath=/Documents/r89.$1 >/dev/null 2>&1); }
tail_r89() { tail -n +$1 $S/sys.log | grep -a -E 'Notice\\u003e: (r89 |group fix:)' | sed 's/.*iPhone //' | cut -c1-330; }
if [ "${PREP:-1}" = 2 ]; then
  $U home; kill_app; $U install $S/ry-P-old.ipa --as-is | tail -1; bash $J/hidcode.sh; $U launch $APP_ID; sleep 25; kill_app
fi
if [ "${PREP:-1}" = 1 ]; then
  $U home; kill_app
  $U install $S/ry-P-new.ipa --as-is | tail -1; bash $J/hidcode.sh
  n=$(wc -l < $S/sys.log); $U launch $APP_ID; sleep 45; tail_r89 $n | head -4; kill_app
  $U install $S/ry-P-old.ipa --as-is | tail -1; bash $J/hidcode.sh
  $U launch $APP_ID; sleep 20; kill_app
fi
$J/prefs.sh before-locked $APP_ID
CLASSA=${CLASSA:-1} bash $J/locked.sh ${HOLD:-22} ${AFTER:-45} | grep -a -v "Update failed" | cut -c1-300
$J/prefs.sh after-locked $APP_ID
