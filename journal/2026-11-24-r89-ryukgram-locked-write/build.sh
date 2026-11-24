#!/usr/bin/env bash
# R89 (from B415): build.sh OUTDIR: $OUTDIR/{complete,plain-old,plain-new}.ipa, signed with SideDrop's identity (A) by this tree's signer:
# complete: original signature asks for Complete, so the signer keeps it. plain: it does not.
# plain-old carries the group fix from before B415 (no lowering), plain-new this branch's.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/../.." && pwd); O=$1; mkdir -p "$O"
. "$repo/native/brand.env"; id=${LOCK_ID:-$BRAND_BUNDLE_ID.probe.r89}
lld=$(rustc --print sysroot)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld; [ -x "$lld" ] || lld=$(command -v ld64.lld)
cc=(clang -target arm64-apple-ios15.0 -isysroot "$IOS_SDK" -fobjc-arc -O1 -fuse-ld=lld --ld-path="$lld" -framework UIKit -framework Foundation -framework Security)
app=$O/w/Payload/Lock.app; rm -rf "$O/w"; mkdir -p "$app/Frameworks"
"${cc[@]}" -o "$app/Lock" "$here/app.m"
python3 -I - "$app/Info.plist" "$id" <<'P'
import plistlib, sys
plistlib.dump({"CFBundleIdentifier": sys.argv[2], "CFBundleExecutable": "Lock", "CFBundleName": "Lock", "CFBundleDisplayName": "Lock",
 "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "1.0", "CFBundleVersion": "1", "CFBundleInfoDictionaryVersion": "6.0",
 "CFBundleSupportedPlatforms": ["iPhoneOS"], "MinimumOSVersion": "15.0", "LSRequiresIPhoneOS": True, "UIDeviceFamily": [1],
 "UILaunchScreen": {}, "UIFileSharingEnabled": True, "UIRequiredDeviceCapabilities": ["arm64"],
 "UIApplicationSceneManifest": {"UIApplicationSupportsMultipleScenes": False, "UISceneConfigurations": {
  "UIWindowSceneSessionRoleApplication": [{"UISceneConfigurationName": "Default", "UISceneDelegateClassName": "SceneDelegate"}]}}}, open(sys.argv[1], "wb"))
P
K=$HOME/sync/default/signing/rsideload; p12=$K/cert.p12; pw=$(cat "$K/password.txt")
sec=$XDG_RUNTIME_DIR/ifizbox-r89; mkdir -p "$sec"; chmod 700 "$sec"; trap 'rm -f "$sec/key.pem" "$sec/cert.der"' EXIT
openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -nocerts -nodes -out "$sec/key.pem" 2>/dev/null
openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -clcerts -nokeys 2>/dev/null | openssl x509 -outform der -out "$sec/cert.der"
case $(openssl x509 -inform der -in "$sec/cert.der" -noout -issuer) in *G6*) w=AppleWWDRCAG6;; *G5*) w=AppleWWDRCAG5;; *G4*) w=AppleWWDRCAG4;; *) w=AppleWWDRCAG3;; esac
git -C "$repo" show c0a0f075^:web/app/vendor/groupfix/ifizbox-groupfix.dylib > "$O/old.dylib"
cp "$repo/web/app/vendor/groupfix/ifizbox-groupfix.dylib" "$O/new.dylib"
one() { # NAME EXTRA-ENT GROUPFIX
  cat > "$O/ents" <<P
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>application-identifier</key><string>ABCDE12345.$id</string><key>keychain-access-groups</key><array><string>ABCDE12345.$id</string></array><key>com.apple.security.application-groups</key><array><string>group.org.example.probe.original</string></array>$2</dict></plist>
P
  rm -rf "$O/p"; cp -r "$O/w" "$O/p"  # zsign fails on an app it already signed
  (cd "$O/p" && "$HOME/.local/share/ifizbox-rig/zsign" -q -a -e "$O/ents" "$O/p/Payload/Lock.app" >/dev/null && rm -f "$O/in.ipa" && zip -qr "$O/in.ipa" Payload)
  SIGNBENCH_KEY_PEM=$sec/key.pem SIGNBENCH_CHAIN=$repo/native/sign/certs/$w.cer:$repo/native/sign/certs/AppleIncRootCertificate.cer SIGNBENCH_GROUPFIX=$3 \
    "$repo/native/sign/bench/build/signbench-linux" "$O/in.ipa" "$O/$1.ipa" "$sec/cert.der" "$sec/cert.der" "$K/sidedrop-adhoc.mobileprovision" | grep -v -E '^(STAGE|TOTAL|PEAK)|%$' || true
  echo "$1: $(unzip -p "$O/$1.ipa" Payload/Lock.app/Lock | strings | grep -c default-data-protection || true) Complete"
}
echo "$id" > "$O/id"; cp "$here"/*.sh "$here/q.py" "$O/"  # run the steps from $O, with `ios syslog > $O/sys.log` running
one complete '<key>com.apple.developer.default-data-protection</key><string>NSFileProtectionComplete</string>' "$O/old.dylib"
one complete-new '<key>com.apple.developer.default-data-protection</key><string>NSFileProtectionComplete</string>' "$O/new.dylib"
one plain-new '' "$O/new.dylib"
one plain-old '' "$O/old.dylib"
