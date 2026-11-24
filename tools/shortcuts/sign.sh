#!/bin/sh
# Signs cellular-installs.plist on a Mac and writes web/app/shortcuts/Cellular Installs.shortcut, which the app hands
# to Shortcuts' Add Shortcut sheet. `shortcuts sign --mode anyone` needs macOS 12+ with an Apple Account signed in to
# iCloud; it works over plain ssh.
#   tools/shortcuts/sign.sh [HOST]   HOST: the Mac to sign on (default mba); "local" on a Mac itself
# The name must match CellularShortcut.shortcutName: Shortcuts names an imported Shortcut after its file, and the app
# runs it by that name.
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
host=${1:-mba}
name="Cellular Installs"
key=cellular-installs
here=$(cd "$(dirname "$0")" && pwd)
out=$here/../../web/app/shortcuts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ "$host" = local ]; then
  plutil -lint "$here/$key.plist"
  plutil -convert binary1 -o "$tmp/$name.shortcut" "$here/$key.plist"
  shortcuts sign --mode anyone --input "$tmp/$name.shortcut" --output "$tmp/signed.shortcut"
else
  ssh "$host" 'mkdir -p /tmp/ifizbox-shortcuts'
  scp "$here/$key.plist" "$host:/tmp/ifizbox-shortcuts/$key.plist"
  ssh "$host" "cd /tmp/ifizbox-shortcuts && plutil -lint $key.plist && plutil -convert binary1 -o '$name.shortcut' $key.plist && shortcuts sign --mode anyone --input '$name.shortcut' --output signed-$key.shortcut 2>/dev/null"
  scp "$host:/tmp/ifizbox-shortcuts/signed-$key.shortcut" "$tmp/signed.shortcut"
fi
[ "$(head -c 4 "$tmp/signed.shortcut")" = AEA1 ] || { echo "$name: not a signed Shortcut" >&2; exit 1; }
mkdir -p "$out"
cp "$tmp/signed.shortcut" "$out/$name.shortcut"
chmod 644 "$out/$name.shortcut"
echo "signed $out/$name.shortcut"
