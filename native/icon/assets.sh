#!/usr/bin/env bash
# Compiles the app icons into an asset catalog (Assets.car) for each build: native/icon/Assets.car (the .deb's plain
# icons) and native/icon/AssetsLite.car (the sideload IPA's, with the LITE sash). Only Apple's actool writes
# Assets.car, so this runs on a Mac with Xcode; build.sh copies the committed .car files on Linux. Rerun it after
# tools/icons.sh or icon/alternates.py change the icons, and commit what it writes.
#
#   native/icon/assets.sh          on the Mac
#   native/icon/assets.sh <host>   from Linux: builds the catalogs here, compiles them on <host> over ssh, copies back
#
# Each catalog (icon/alternates.py catalog) holds AppIcon, Info.plist's CFBundleIconName (Classic, with Gunmetal as
# its dark appearance and the globe alone, icon/glass/AppIconTinted1024.png, as its tinted one: iOS 26+ Clear and
# Tinted), and every alternate set Info.plist's CFBundleAlternateIcons lists (F323: the icon follows the
# theme, Sources/AppIcon.swift). iOS reads AppIcon from Assets.car for notifications, Settings and Spotlight; with the
# name set and no catalog it shows a blank placeholder there. native/test_icons.py checks every set and size.
# F324: glass.py's CAR_SETS (the Glass icon, Icon-glass) go in as Icon Composer documents, so iOS 26+ draws them in
# Liquid Glass (Clear, Tinted, Dark); needs Xcode 26's actool.
set -euo pipefail
cd "$(dirname "$0")"

# compile <dir holding Assets.xcassets> <out.car>, on the Mac
compile() {
  export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
  local alts=() name
  for name in $(cd "$1/Assets.xcassets" && ls -d Icon-*.appiconset); do alts+=(--alternate-app-icon "${name%.appiconset}"); done
  mkdir -p "$1/out"
  # F324: each set's Icon Composer document (icon/glass.py), same name as its .appiconset: iOS 26+ draws the .icon
  # in Liquid Glass, iOS 15-25 the PNGs.
  # glass.py car leaves glass/ empty while CAR_SETS is: no documents, not an error (nullglob, so no ls to fail).
  local glass=() doc
  shopt -s nullglob
  for doc in "$1"/glass/*.icon; do
    glass+=("$doc")
    # one with no .appiconset of its own (the Glass icon) is an alternate actool would otherwise not list
    name=$(basename "$doc" .icon)
    if [ "$name" != AppIcon ] && [ ! -d "$1/Assets.xcassets/$name.appiconset" ]; then alts+=(--alternate-app-icon "$name"); fi
  done
  shopt -u nullglob
  xcrun actool --compile "$1/out" --platform iphoneos --minimum-deployment-target 15.0 --target-device iphone \
    --app-icon AppIcon "${alts[@]}" --output-partial-info-plist "$1/partial.plist" \
    --errors --warnings --output-format human-readable-text "$1/Assets.xcassets" ${glass[@]+"${glass[@]}"} > "$1/actool.log" 2>&1 ||
    { cat "$1/actool.log" >&2; exit 1; }
  # A set actool didn't take whole ("unassigned children": a dark appearance dropped) is a broken icon: stop.
  if grep -i -E "warning|error" "$1/actool.log" >&2; then echo "icon assets: actool complained (above)" >&2; exit 1; fi
  cp "$1/out/Assets.car" "$2"
}

if [ "${1:-}" = --compile ]; then compile "$2" "$3"; exit 0; fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 alternates.py catalog "$work/plain" >/dev/null
python3 alternates.py catalog "$work/lite" --lite >/dev/null
python3 glass.py car "$work/plain/glass" >/dev/null
python3 glass.py car "$work/lite/glass" >/dev/null

if [ "$(uname)" != Darwin ]; then
  host=${1:?"icon assets: run on a Mac, or give a Mac's ssh host"}
  dir=$(ssh "$host" mktemp -d)
  tar -C "$work" -cf - plain lite | ssh "$host" tar -C "$dir" -xf -
  scp -q assets.sh "$host:$dir/"
  ssh "$host" "bash $dir/assets.sh --compile $dir/plain $dir/Assets.car && bash $dir/assets.sh --compile $dir/lite $dir/AssetsLite.car"
  scp -q "$host:$dir/Assets.car" "$host:$dir/AssetsLite.car" .
  ssh "$host" rm -rf "$dir"
else
  compile "$work/plain" Assets.car
  compile "$work/lite" AssetsLite.car
fi
# The PNGs the .car files were compiled from, so native/test_icons.py notices icons changed without a rerun.
python3 alternates.py sources > assets.sources
python3 glass.py sources >> assets.sources
echo "icon assets: wrote native/icon/Assets.car, AssetsLite.car and assets.sources"
