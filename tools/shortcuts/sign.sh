#!/bin/sh
# Signs our Shortcuts on a Mac and writes them to web/app/shortcuts/<name>.shortcut, which the site serves and the
# app shares to Shortcuts' Add Shortcut sheet:
#   install-switch.plist  "Install Switch": This iPhone's one Shortcut (Cellular Data and Set VPN around installs)
#   cellular-off.plist    "Cellular Data Off" \ the two Cellular Shortcuts it replaces; kept for phones that
#   cellular-on.plist     "Cellular Data On"  / added them before
# `shortcuts sign --mode anyone` needs macOS 12+ with an Apple Account signed in to iCloud; it works over plain ssh.
#   tools/shortcuts/sign.sh [HOST] [KEY...]   HOST: the Mac to sign on (default mba); "local" on a Mac itself
#                                             KEY: install-switch, cellular-off, cellular-on (default: all)
# The names must match SHORTCUT_NAMES (web/app/core/installroute.js) and LocalVPN.shortcutNames: Shortcuts names an
# imported Shortcut after its file, and the app runs it by that name.
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
host=${1:-mba}
[ $# -gt 0 ] && shift
keys=${*:-install-switch cellular-off cellular-on}
here=$(cd "$(dirname "$0")" && pwd)
out=$here/../../web/app/shortcuts
mkdir -p "$out"
for k in $keys; do
  case $k in
    install-switch) name="Install Switch" ;;
    cellular-off) name="Cellular Data Off" ;;
    cellular-on) name="Cellular Data On" ;;
    *) echo "unknown Shortcut $k" >&2; exit 2 ;;
  esac
  if [ "$host" = local ]; then
    tmp=$(mktemp -d)
    plutil -lint "$here/$k.plist"
    plutil -convert binary1 -o "$tmp/$name.shortcut" "$here/$k.plist"
    shortcuts sign --mode anyone --input "$tmp/$name.shortcut" --output "$out/$name.shortcut"
    rm -r "$tmp"
  else
    ssh "$host" 'mkdir -p /tmp/ifizbox-shortcuts'
    scp "$here/$k.plist" "$host:/tmp/ifizbox-shortcuts/$k.plist"
    ssh "$host" "cd /tmp/ifizbox-shortcuts && plutil -lint $k.plist && plutil -convert binary1 -o '$name.shortcut' $k.plist && shortcuts sign --mode anyone --input '$name.shortcut' --output signed-$k.shortcut 2>/dev/null"
    scp "$host:/tmp/ifizbox-shortcuts/signed-$k.shortcut" "$out/$name.shortcut"
  fi
  chmod 644 "$out/$name.shortcut"
  [ "$(head -c 4 "$out/$name.shortcut")" = AEA1 ] || { echo "$name: not a signed Shortcut" >&2; exit 1; }
  echo "signed $out/$name.shortcut"
done
