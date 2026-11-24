#!/bin/sh
# Signs our Shortcuts on a Mac and writes web/app/shortcuts/<name>.shortcut, which the app hands to Shortcuts' Add
# Shortcut sheet. `shortcuts sign --mode anyone` needs macOS 12+ with an Apple Account signed in to iCloud; it works
# over plain ssh.
#   tools/shortcuts/sign.sh [HOST [KEY]]   HOST: the Mac to sign on (default mba); "local" on a Mac itself
#                                          KEY: only that one, cellular-installs or restore-vpn (default both)
# Each name must match its shortcutName (CellularShortcut, RestoreShortcut): Shortcuts names an imported Shortcut after
# its file, and the app runs it by that name.
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
host=${1:-mba}
only=${2:-}
case $only in ''|cellular-installs|restore-vpn) ;; *) echo "no Shortcut $only" >&2; exit 2 ;; esac
here=$(cd "$(dirname "$0")" && pwd)
out=$here/../../web/app/shortcuts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# signs $key.plist as $name
sign() {
  if [ -n "$only" ] && [ "$only" != "$key" ]; then return 0; fi
  rm -f "$tmp/signed.shortcut"
  if [ "$host" = local ]; then
    plutil -lint "$here/$key.plist"
    plutil -convert binary1 -o "$tmp/$name.shortcut" "$here/$key.plist"
    shortcuts sign --mode anyone --input "$tmp/$name.shortcut" --output "$tmp/signed.shortcut"
  else
    # one connection: a sleeping Mac answers only for moments
    ssh -o ConnectTimeout=10 "$host" "set -e; d=\$(mktemp -d); trap 'rm -rf \"\$d\"' EXIT; cd \"\$d\"; cat > in.plist; plutil -lint in.plist >&2; plutil -convert binary1 -o '$name.shortcut' in.plist; shortcuts sign --mode anyone --input '$name.shortcut' --output signed.shortcut 2>/dev/null; cat signed.shortcut" < "$here/$key.plist" > "$tmp/signed.shortcut"
  fi
  [ "$(head -c 4 "$tmp/signed.shortcut")" = AEA1 ] || { echo "$name: not a signed Shortcut" >&2; exit 1; }
  mkdir -p "$out"
  cp "$tmp/signed.shortcut" "$out/$name.shortcut"
  chmod 644 "$out/$name.shortcut"
  echo "signed $out/$name.shortcut"
}

key=cellular-installs name="Cellular Installs"
sign
key=restore-vpn name="Restore My VPN"
sign
