#!/bin/bash
# mark.sh LABEL: the owed mark's file and the preferences on disk, read without opening iFizBox
S=$(dirname $0); U=00008130-0018450C3661001C; rm -f $S/m $S/p.plist
timeout 30 pymobiledevice3 apps pull --udid $U com.ryha.ifizbox "Library/Application Support/ifizbox.vpn.backOwed" $S/m >/dev/null 2>&1
timeout 30 pymobiledevice3 apps pull --udid $U com.ryha.ifizbox Library/Preferences/com.ryha.ifizbox.plist $S/p.plist >/dev/null 2>&1
cp $S/p.plist $S/prefs-$1.plist 2>/dev/null
echo "$1: owed file $([ -s $S/m ] && cat $S/m || echo MISSING)"
