#!/bin/sh
# Signs the Cellular Shortcuts (cellular-off.plist, cellular-on.plist) on a Mac and writes them to
# web/app/shortcuts/<name>.shortcut, which the site serves and the Cellular Shortcuts page imports.
# `shortcuts sign --mode anyone` needs macOS 12+ with an Apple Account signed in to iCloud; it works over plain ssh.
#   tools/shortcuts/sign.sh [HOST]     HOST: the Mac to sign on (default mba); "local" on a Mac itself
# The names must match SHORTCUT_NAMES (web/app/core/installroute.js) and LocalVPN.shortcutNames: Shortcuts names an
# imported Shortcut after its file, and the app runs it by that name.
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
host=${1:-mba}
here=$(cd "$(dirname "$0")" && pwd)
out=$here/../../web/app/shortcuts
mkdir -p "$out"
for k in off on; do
  case $k in off) name="Cellular Data Off" ;; on) name="Cellular Data On" ;; esac
  if [ "$host" = local ]; then
    tmp=$(mktemp -d)
    plutil -lint "$here/cellular-$k.plist"
    cp "$here/cellular-$k.plist" "$tmp/$name.shortcut"
    shortcuts sign --mode anyone --input "$tmp/$name.shortcut" --output "$out/$name.shortcut"
    rm -r "$tmp"
  else
    ssh "$host" 'mkdir -p /tmp/ifizbox-shortcuts'
    scp "$here/cellular-$k.plist" "$host:/tmp/ifizbox-shortcuts/cellular-$k.plist"
    ssh "$host" "cd /tmp/ifizbox-shortcuts && plutil -lint cellular-$k.plist && cp cellular-$k.plist '$name.shortcut' && shortcuts sign --mode anyone --input '$name.shortcut' --output signed-$k.shortcut 2>/dev/null"
    scp "$host:/tmp/ifizbox-shortcuts/signed-$k.shortcut" "$out/$name.shortcut"
  fi
  chmod 644 "$out/$name.shortcut"
  [ "$(head -c 4 "$out/$name.shortcut")" = AEA1 ] || { echo "$name: not a signed Shortcut" >&2; exit 1; }
  echo "signed $out/$name.shortcut"
done
