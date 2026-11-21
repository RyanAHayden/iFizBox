#!/bin/sh
# R69: print the Home Screen badge iOS 15 keeps for iFizBox (FrontBoard's applicationState.db, SBApplicationBadgeKey),
# and the count the page last sent (ifizbox.updates.pageCount) with its prefs file's mtime. Run on the desktop.
set -eu
d=$(mktemp -d)
scp -q '7:/var/mobile/Library/FrontBoard/applicationState.db*' "$d/"
printf 'icon badge: '
sqlite3 "$d/applicationState.db" "select cast(value as text) from kvs join key_tab k on k.id=kvs.key join application_identifier_tab a on a.id=kvs.application_identifier where a.application_identifier='com.ryha.ifizbox' and k.key='SBApplicationBadgeKey';"
echo
rm -r "$d"
ssh 7 'p=/var/jb/var/mobile/Library/Preferences/com.ryha.ifizbox.plist; stat -c "prefs mtime: %y" $p 2>/dev/null || stat -f "prefs mtime: %Sm" $p; date "+phone now: %T"'
