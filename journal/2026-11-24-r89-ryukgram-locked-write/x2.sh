#!/usr/bin/env bash
# x2.sh N: B413+B415's build (ry-P-new.ipa) installed over the container the Complete copy left (every file class A); one unlocked
# launch (the group fix lowers them), then N locked launches (no class A forced), the preferences file pulled after each.
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH; U="tools/ui-15.sh R89"
export APP_ID=com.burbn.instagram APP_LABEL=Instagram; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C
kill_app() { (cd $rig; ios --udid=$udid kill $APP_ID >/dev/null 2>&1); }
tail_r89() { tail -n +$1 $S/sys.log | grep -a -E 'Notice\\u003e: (r89 (start|set|launch|const|t(0|30|60|80):|after)|group fix:)|SIGBUS' | grep -a -v "Update failed" | sed 's/.*iPhone //; s/\\u003cNotice\\u003e: //; s/container [A-F0-9-]*; //; s/application-identifier [^;]*; //' | cut -c1-${W:-420}; }
if [ "${PREP:-1}" = 1 ]; then
  $U home; kill_app; $J/prefs.sh before-install $APP_ID
  $U install $S/ry-P-new.ipa --as-is | tail -1; bash $J/hidcode.sh
  n=$(wc -l < $S/sys.log); $U launch $APP_ID; sleep 45; tail_r89 $n | head -5; kill_app
fi
$J/prefs.sh start $APP_ID
for i in $(seq 1 ${1:-3}); do
  n=$(wc -l < $S/sys.log)
  CLASSA=0 bash $J/locked.sh ${HOLD:-22} ${AFTER:-45} >/dev/null 2>&1
  echo "-- locked launch $i"; tail_r89 $n | head -${LINES_:-14}
  kill_app; sleep 2; $J/prefs.sh after-locked-$i $APP_ID
done
