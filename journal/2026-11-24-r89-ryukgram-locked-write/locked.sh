#!/usr/bin/env bash
# locked.sh [HOLD]: kill the app, put Documents/r89.sleep there, launch (the constructor sleeps 18 s), lock 2.5 s after the
# launch, stay locked HOLD seconds (default 40), then unlock with the passcode. Log lines go to $S/sys.log (ios syslog running).
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH; ID=$(cat $S/b/id); ID=${APP_ID:-$ID}
U="tools/ui-15.sh R89"; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C
(cd $rig; ios --udid=$udid kill $ID >/dev/null 2>&1; echo x > $S/r89.sleep
 ios --udid=$udid fsync --app=$ID push --srcPath=$S/r89.sleep --dstPath=/Documents/r89.sleep >/dev/null 2>&1
 [ "${CLASSA:-0}" = 1 ] && ios --udid=$udid fsync --app=$ID push --srcPath=$S/r89.sleep --dstPath=/Documents/r89.classA >/dev/null 2>&1)  # CLASSA=1: the constructor makes the preferences file class A right before the sleep
n=$(wc -l < $S/sys.log)
(cd $rig; ios --udid=$udid launch $ID >/dev/null 2>&1 &)
sleep 2.5; $U lock-button; sleep ${1:-40}
bash $J/unlock.sh
sleep 2; $U home; sleep 1; python3 -I $J/q.py tap "${APP_LABEL:-Lock}"  # tap the app's icon: resumes the same process (go-ios launch would restart it)
sleep ${2:-20}
[ -n "${SHOT:-}" ] && $U shot $SHOT >/dev/null 2>&1
echo "== $ID"; tail -n +$n $S/sys.log | grep -a -E "Notice\\\\u003e: (r89 |group fix:)|cfprefsd.*(rejecting|probe.r89|com.burbn.instagram)|SIGBUS|pagein" | grep -v -a -E 'runningboardd|applicationsDidInstall' | sed -e 's/.*iPhone //' -e 's/application-identifier.*isolate/.. isolate/' | cut -c1-400
