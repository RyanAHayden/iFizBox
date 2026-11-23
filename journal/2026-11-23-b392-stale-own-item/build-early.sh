#!/usr/bin/env bash
# build-early.sh [SUFFIX]: tools/resignprobe/build.sh's probe with early.dylib linked in (inits before the group fix)
set -euo pipefail
cd "$(dirname "$0")/../.."; j=$PWD/$(dirname "$0" | sed 's#^.*journal/#journal/#')
. native/brand.env; suf=${1:-}; b=tools/resignprobe/build; name=probe${suf:+-$suf}
lld=${LD64_LLD:-$( (find "$HOME/.rustup" /usr/lib/rustlib -name ld64.lld -path "*gcc-ld*" 2>/dev/null || true) | head -1)}; export LD64_LLD=$lld
tools/resignprobe/build.sh ${suf:+"$suf"}
app=$PWD/$b/$name/Payload/Probe.app; mkdir -p "$app/Frameworks"
cc="clang ${EARLY_FLAGS:-} -target arm64-apple-ios15.0 -isysroot $IOS_SDK -fobjc-arc -O2 -fuse-ld=lld --ld-path=$lld -framework Foundation -framework Security"
$cc -dynamiclib -install_name @rpath/early.dylib -o "$app/Frameworks/early.dylib" "$j/early.m"
$cc -framework UIKit -Wl,-rpath,@executable_path/Frameworks "$app/Frameworks/early.dylib" -o "$app/Probe" tools/resignprobe/probe.m
z=${IFIZBOX_15_RIG:-$HOME/.local/share/ifizbox-rig}/zsign
(cd $b/$name && "$z" -f -q -a -e orig.plist "$app" && rm -f ../$name.ipa && zip -qr ../$name.ipa Payload)
