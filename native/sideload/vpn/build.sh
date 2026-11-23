#!/usr/bin/env bash
# The built-in VPN's packet tunnel extension into the sideload app: <app>/PlugIns/iFizBoxVPN.appex, arm64, iOS 15+.
# native/build.sh calls this from bundle() for the IPA only (the jailbreak app installs through its helper):
#
#   sideload/vpn/build.sh <iFizBox.app dir>
#   env: SWIFTC SDK RD LLD OUT VERSION BUILD BRAND_NAME [LDID] [RCODESIGN] (as share/build.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
native=$(dirname "$(dirname "$here")")
[ $# -eq 1 ] || { sed -n '2,6p' "$0" >&2; exit 2; }
app=$1
: "${SWIFTC:?}" "${SDK:?}" "${RD:?}" "${LLD:?}" "${OUT:?}" "${VERSION:?}" "${BUILD:?}" "${BRAND_NAME:?}"
min=15.0 target=arm64-apple-ios15.0
obj=$OUT/vpn
exe=${BRAND_NAME}VPN
appex=$app/PlugIns/$exe.appex
mkdir -p "$obj" "$appex"

if [ ! -f "$obj/$exe" ] || [ "$here/Extension/PacketTunnelProvider.swift" -nt "$obj/$exe" ]; then
  "$SWIFTC" -parse-as-library -O -wmo -swift-version 5 -runtime-compatibility-version none -application-extension \
    -target "$target" -sdk "$SDK" -resource-dir "$RD" -I "$RD/shims" -module-cache-path "$OUT/modules" \
    -Xcc -Wno-nullability-completeness -Xcc -Wno-nullability-inferred-on-nested-type \
    -module-name "$exe" -c "$here/Extension/PacketTunnelProvider.swift" -o "$obj/$exe.o"
  clang -target "$target" -isysroot "$SDK" -O2 -c "$native/Sources/availability.c" -o "$obj/availability.o"
  # A network extension starts in Foundation's NSExtensionMain, as Xcode links it.
  clang -target "$target" -isysroot "$SDK" -fuse-ld=lld --ld-path="$LLD" -fapplication-extension "$obj/$exe.o" \
    "$obj/availability.o" -L "$SDK/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -Wl,-adhoc_codesign \
    -Wl,-e,_NSExtensionMain -framework Foundation -framework NetworkExtension -o "$obj/$exe"
fi
cp "$obj/$exe" "$appex/$exe"
sed -e "s/@VERSION@/$VERSION/" -e "s/@BUILD@/$BUILD/" -e "s/@MIN@/$min/" -e "s/\$(BRAND_NAME)/$BRAND_NAME/g" "$here/Info.plist" > "$appex/Info.plist"

ents=$here/entitlements.plist
if [ -n "${LDID:-}" ]; then
  "$LDID" -S"$ents" "$appex/$exe"
elif [ -n "${RCODESIGN:-}" ]; then
  "$RCODESIGN" sign --entitlements-xml-file "$ents" "$appex/$exe" >/dev/null 2>"$obj/rcodesign.log" ||
    { cat "$obj/rcodesign.log" >&2; exit 1; }
else
  echo "vpn: WARNING no ldid or rcodesign; $exe.appex is ad hoc signed without entitlements" >&2
fi
