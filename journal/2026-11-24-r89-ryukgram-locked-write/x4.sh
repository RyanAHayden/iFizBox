#!/usr/bin/env bash
# x4.sh K: Instagram's crash-loop safe mode: B413+B415's build (ry-P-new.ipa, spy with Documents/r89.crash), K launches that crash 2 s
# after start (unlocked), then a normal launch; preferences pulled after each, screenshot of the last.
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH; U="tools/ui-15.sh R89"
export APP_ID=com.burbn.instagram; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C
kill_app() { (cd $rig; ios --udid=$udid kill $APP_ID >/dev/null 2>&1); }
tail_r89() { tail -n +$1 $S/sys.log | grep -a -E 'Notice\\u003e: (r89 (start|set|launch|const|crash)|group fix:)|Process exited' | grep -a -v "Update failed" | sed 's/.*iPhone //; s/\\u003cNotice\\u003e: //; s/container [A-F0-9-]*; //; s/application-identifier [^;]*; //' | cut -c1-${W:-240}; }
if [ "${PREP:-1}" = 1 ]; then $U home; kill_app; $U install $S/ry-P-new.ipa --as-is | tail -1; bash $J/hidcode.sh; $U launch $APP_ID; sleep 30; kill_app; fi
$J/prefs.sh x4-start $APP_ID
echo x > $S/r89.crash; (cd $rig; ios --udid=$udid fsync --app=$APP_ID push --srcPath=$S/r89.crash --dstPath=/Documents/r89.crash >/dev/null 2>&1)
for i in $(seq 1 ${1:-5}); do
  n=$(wc -l < $S/sys.log); $U launch $APP_ID >/dev/null 2>&1; sleep 9
  echo "-- crashing launch $i"; tail_r89 $n | head -6; kill_app; $J/prefs.sh x4-crash-$i $APP_ID
done
(cd $rig; pymobiledevice3 apps rm $APP_ID Documents/r89.crash >/dev/null 2>&1)
n=$(wc -l < $S/sys.log); $U launch $APP_ID >/dev/null 2>&1; sleep 25
echo "-- normal launch after the crashes"; tail_r89 $n | head -8; $U shot r89-x4 >/dev/null 2>&1; kill_app; $J/prefs.sh x4-after $APP_ID
