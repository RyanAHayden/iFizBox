#!/usr/bin/env bash
# step.sh NAME [noinstall]: install NAME.ipa on the 15 Pro, launch Instagram, wait, pull the reports
S=$(cd "$(dirname "$0")" && pwd); cd /home/ryha/runs/iFizBox/s4
tools/ui-15.sh B425 wake >/dev/null 2>&1
P() { (cd ~/.local/share/ifizbox-rig && timeout 120 pymobiledevice3 apps pull com.burbn.instagram "$1" "$2" >/dev/null 2>&1); }
P Library/Preferences/com.burbn.instagram.plist $S/$1-prefs-before.plist
[ "${2:-}" ] || timeout 500 tools/ui-15.sh B425 install $S/$1.ipa --as-is 2>&1 | tail -2
tools/ui-15.sh B425 wake >/dev/null 2>&1
tools/ui-15.sh B425 launch com.burbn.instagram 2>&1 | tail -1
sleep 70
P Library/b425.txt $S/$1-b425.txt; P Library/ifizbox-groupfix.log $S/$1-log.txt; P Library/Preferences/com.burbn.instagram.plist $S/$1-prefs-after.plist
tools/ui-15.sh B425 shot B425-$1 | tail -1
for x in before after; do python3 -I -c "import plistlib,sys;d=plistlib.load(open(sys.argv[1],'rb'));print(sys.argv[1][-12:],len(d),'keys')" $S/$1-prefs-$x.plist; done
cat $S/$1-b425.txt; tail -2 $S/$1-log.txt
