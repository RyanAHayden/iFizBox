#!/usr/bin/env bash
# e1.sh IPA WAIT [APP_ID LABEL]: install IPA, one unlocked launch (writes), a second one that sets the preferences file to class A,
# kill, wait WAIT seconds (lets cfprefsd drop its cache), then a locked launch (locked.sh) and a check of the preferences file.
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH; U="tools/ui-15.sh R89"
export APP_ID=${3:-$(cat $S/b/id)} APP_LABEL=${4:-Lock}; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C
kill_app() { (cd $rig; ios --udid=$udid kill $APP_ID >/dev/null 2>&1); }
[ -n "${1:-}" ] && [ "$1" != none ] && $U install $1 --as-is | tail -1
$U home; kill_app; $U launch $APP_ID; sleep 14; kill_app
echo x > $S/r89.classA; (cd $rig; ios --udid=$udid fsync --app=$APP_ID push --srcPath=$S/r89.classA --dstPath=/Documents/r89.classA >/dev/null 2>&1)
n=$(wc -l < $S/sys.log); $U launch $APP_ID; sleep 14; kill_app
tail -n +$n $S/sys.log | grep -a -E 'Notice\\u003e: r89 (set|constructor)' | sed 's/.*iPhone //' | cut -c1-200
$J/prefs.sh before-locked $APP_ID
sleep ${2:-0}
bash $J/locked.sh ${HOLD:-40} ${AFTER:-25} | grep -a -v "Update failed" | cut -c1-300
kill_app; sleep 2
$J/prefs.sh after-locked $APP_ID
