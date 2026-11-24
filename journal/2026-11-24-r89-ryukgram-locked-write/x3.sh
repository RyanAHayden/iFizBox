#!/usr/bin/env bash
# x3.sh N: RyukGram 456 signed for Complete (ry-C-old.ipa), crash_counter in place; N locked launches that die of SIGBUS (the user's
# 12:05 and 15:36 crashes), the preferences file pulled after each; then one unlocked launch.
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH; U="tools/ui-15.sh R89"
export APP_ID=com.burbn.instagram APP_LABEL=Instagram; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C
kill_app() { (cd $rig; ios --udid=$udid kill $APP_ID >/dev/null 2>&1); }
tail_r89() { tail -n +$1 $S/sys.log | grep -a -E 'Notice\\u003e: (r89 (start|set|launch|const)|group fix:)|SIGBUS|Process exited' | grep -a -v "Update failed" | sed 's/.*iPhone //; s/\\u003cNotice\\u003e: //' | cut -c1-${W:-300}; }
if [ "${PREP:-1}" = 1 ]; then
  $U home; kill_app; $U install $S/ry-C-old.ipa --as-is | tail -1; bash $J/hidcode.sh
  n=$(wc -l < $S/sys.log); $U launch $APP_ID; sleep 35; tail_r89 $n | head -4; kill_app
fi
$J/prefs.sh start $APP_ID
for i in $(seq 1 ${1:-3}); do
  n=$(wc -l < $S/sys.log)
  bash $J/locked.sh 22 20 >/dev/null 2>&1
  echo "-- locked launch $i"; tail_r89 $n | head -8
  kill_app; sleep 2; $J/prefs.sh after-crash-$i $APP_ID
done
