#!/usr/bin/env bash
# mkry.sh: RyukGram 456 store IPA + the spy dylib (spy.m) -> ry-spy.ipa, then ry-P-new.ipa / ry-P-old.ipa (sign.sh). Needs R89_SCRATCH, RY_IPA.
set -euo pipefail
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write; S=$R89_SCRATCH
lld=$(rustc --print sysroot)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld; [ -x "$lld" ] || lld=$(command -v ld64.lld)
clang -target arm64-apple-ios15.0 -isysroot "$IOS_SDK" -fobjc-arc -O1 -fuse-ld=lld --ld-path="$lld" -framework UIKit -framework Foundation -dynamiclib -install_name @rpath/ryspy.dylib -o $S/ryspy.dylib $J/spy.m
rm -rf $S/ry; mkdir $S/ry; (cd $S/ry && unzip -q $RY_IPA)
python3 -I journal/2026-11-23-b390-ryukgram/prep.py $S/ry/Payload/Instagram.app $S/ryspy.dylib >/dev/null; rm -f $S/ry/Payload/Instagram.app/ryspy-set.plist
(cd $S/ry && rm -f ../ry-spy.ipa && zip -qr ../ry-spy.ipa Payload)
$J/sign.sh $S/ry-spy.ipa $S/ry-P-new.ipa $S/b/new.dylib | tail -1; $J/sign.sh $S/ry-spy.ipa $S/ry-P-old.ipa $S/b/old.dylib | tail -1
