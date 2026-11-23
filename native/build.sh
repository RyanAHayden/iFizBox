#!/usr/bin/env bash
# Build iFizBox on Linux (no Mac, no Theos): the Swift shell around web/app/, arm64, iOS 15+, as two artifacts from
# one executable (task I2; the app picks its mode at launch, native/Sources/mode.c):
#   native/build/iFizBox.deb  jailbreak: rootless, iphoneos-arm64, jailbreak entitlements; checked by mkdeb.py
#   native/build/iFizBox.ipa  sideload: no helper, get-task-allow only, ad hoc signed; checked by mkipa.py.
#                            The user signs it with their own tool (docs/sideload.md, "What I2 needs").
#
#   build.sh [all|deb|ipa]  build and check both (default) or one; `make package|deb|ipa` run this
#   build.sh --probe        exit 0 if the toolchain below is all there, else say what's missing and exit 3
#
# Needs (docs/native.md, "Building on Linux"):
#   SWIFT_TOOLCHAIN  a swift.org Linux toolchain, 6.4.x to match the SDK's compiler: the dir holding usr/bin/swiftc
#                    (default: the one swiftc on PATH belongs to)
#   IOS_SDK          iPhoneOS.sdk extracted from an Xcode .xip (required; iFizBox's own extraction script is task T3)
#   LD64_LLD         an ld64.lld (default: rustup's gcc-ld/ld64.lld, else ld64.lld on PATH)
#   RCODESIGN/LDID   a signer for the entitlements (default: rcodesign or ldid on PATH, then ~/.cargo/bin/rcodesign).
#                    Without one the executable keeps lld's ad hoc signature, which has no entitlements.
# arm64 only: lld can't link arm64e, and apps run as arm64 on arm64e phones (R3).
set -euo pipefail
cd "$(dirname "$0")"
# F170: the product name (and later the IDs) for the templates: $(BRAND_NAME) in Info.plist, deb/control and the
# extensions' plists. The Swift code has it as Brand.name (sign/Brand.swift, from `python3 brand.py sync`).
set -a; . ./brand.env; set +a
brand_sed=(-e "s/\$(BRAND_NAME)/$BRAND_NAME/g")

missing=()
if [ -n "${SWIFT_TOOLCHAIN:-}" ]; then
  tc=$SWIFT_TOOLCHAIN
elif command -v swiftc >/dev/null; then
  tc=$(dirname "$(dirname "$(dirname "$(readlink -f "$(command -v swiftc)")")")")
else
  tc=
fi
swiftc=$tc/usr/bin/swiftc
[ -n "$tc" ] && [ -x "$swiftc" ] || missing+=("swiftc (set SWIFT_TOOLCHAIN to a swift.org 6.4.x toolchain)")
sdk=${IOS_SDK:-}
if [ -z "$sdk" ]; then missing+=("IOS_SDK (point it at an iPhoneOS.sdk extracted from Xcode)")
elif [ ! -d "$sdk" ]; then missing+=("IOS_SDK=$sdk (not a directory)"); fi
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null || true)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld || true)
[ -n "$lld" ] || missing+=("ld64.lld (rustup's, or set LD64_LLD)")
command -v clang >/dev/null || missing+=("clang")
# F15: idevice (the "no server" install route), built from source by sideload/idevice/build.sh: Rust + aarch64-apple-ios.
idevice_why=$(sideload/idevice/build.sh --probe 2>&1) || missing+=("${idevice_why#idevice build: missing }")
# Tailscale for that route (sideload/tailscale/build.sh): a pinned Go builds tsnet as a c-archive, sideload app only.
ts_why=$(sideload/tailscale/build.sh --probe 2>&1) || missing+=("${ts_why#tailscale build: missing }")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'native build: missing %s\n' "${missing[@]}" >&2
  exit 3
fi
[ "${1:-}" = --probe ] && exit 0
what=${1:-all}
case $what in all|deb|ipa) ;; *) echo "usage: build.sh [all|deb|ipa|--probe]" >&2; exit 2 ;; esac

min=15.0 target=arm64-apple-ios15.0
version=$(cat VERSION)
build=$(git rev-list --count HEAD 2>/dev/null || echo 1)
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || echo 0)}
out=build
mkdir -p "$out"
# Clang's module cache records its absolute path: one built before the checkout moved (F170: ~/runs/iFizBox became
# ~/runs/iFizBox) fails with "precompiled file ... was compiled with module cache path". Start it again then.
if [ -d "$out/modules" ] && [ "$(cat "$out/modules/.path" 2>/dev/null)" != "$PWD/$out/modules" ]; then rm -rf "$out/modules"; fi
mkdir -p "$out/modules" && printf '%s' "$PWD/$out/modules" > "$out/modules/.path"
# The ubuntu24.04 toolchain wants libncurses.so.6; Arch ships only the wide one. ldd's whole output is read first:
# `ldd | grep -q` under pipefail fails when grep quits early and ldd dies of SIGPIPE (it did under a loaded gate, I7).
if [[ "$(ldd "$swiftc" 2>/dev/null || true)" == *'libncurses.so.6 => not found'* ]]; then
  mkdir -p "$out/libshim" && ln -sf /usr/lib/libncursesw.so.6 "$out/libshim/libncurses.so.6"
  export LD_LIBRARY_PATH=$PWD/$out/libshim${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
fi
# A resource dir with only SwiftShims and clang's headers: the toolchain's own (Linux) one brings Glibc-flavoured
# CoreFoundation/dispatch module maps that clash with the SDK's.
rd=$out/resource
mkdir -p "$rd"
rm -rf "$rd/shims" && cp -r "$tc/usr/lib/swift/shims" "$rd/shims"
ln -sfn "$tc/usr/lib/swift/clang" "$rd/clang"
sideload/idevice/build.sh # F15: build/idevice/{lib/libidevice_ffi.a,include}, once per pin
sideload/tailscale/build.sh # build/tailscale/libtsnet.a, once per pin
"$swiftc" -parse-as-library -O -wmo -swift-version 5 -runtime-compatibility-version none \
  -target "$target" -sdk "$sdk" -resource-dir "$rd" -I "$rd/shims" -module-cache-path "$out/modules" \
  -Xcc -Wno-nullability-completeness -Xcc -Wno-nullability-inferred-on-nested-type \
  -import-objc-header Sources/iFizBox-Bridging-Header.h -I "$out/idevice/include" -I sideload/tailscale \
  -emit-const-values-path "$out/$BRAND_NAME.swiftconstvalues" \
  -Xfrontend -const-gather-protocols-file -Xfrontend intents/protocols.json \
  -module-name "$BRAND_NAME" -c Sources/*.swift sign/*.swift intents/*.swift intents/App/*.swift share/*.swift share/App/*.swift \
  sideload/idevice/*.swift sideload/tailscale/*.swift sideload/vpn/App/*.swift -o "$out/$BRAND_NAME.o"
clang -target "$target" -isysroot "$sdk" -O2 -c Sources/availability.c -o "$out/availability.o"
clang -target "$target" -isysroot "$sdk" -O2 -c Sources/mode.c -o "$out/mode.o"
# The app's half of the root helper (ifizbox_helper_spawn), and the helper itself (N2's native/helper/).
hflags=(-target "$target" -isysroot "$sdk" -std=c11 -Wall -Wextra -Werror -O2)
clang "${hflags[@]}" -c helper/spawn.c -o "$out/spawn.o"
clang "${hflags[@]}" -c sideload/tailscale/stub.c -o "$out/tsnet-stub.o"
# Two executables from the same objects: the jailbreak one with tsnet's stub, the sideload one with tsnet itself
# (Go's runtime and Tailscale: ~10 MB the jailbreak app doesn't need).
link() {
  clang -target "$target" -isysroot "$sdk" -fuse-ld=lld --ld-path="$lld" "$out/$BRAND_NAME.o" "$out/availability.o" \
    "$out/mode.o" "$out/spawn.o" -L "$sdk/usr/lib/swift" -lz -lbz2 -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -Wl,-adhoc_codesign \
    -L "$out/idevice/lib" -lidevice_ffi -liconv \
    -Wl,-weak_framework,AppIntents -framework NetworkExtension "$@"
}
link "$out/tsnet-stub.o" -o "$out/$BRAND_NAME"
link "$out/tailscale/libtsnet.a" -framework CoreFoundation -framework Security -framework SystemConfiguration -lresolv \
  -o "$out/$BRAND_NAME-sideload"
# N8: AppIntents is iOS 16+ and weak (above), so iFizBox still launches on iOS 15. Nothing else may need it strongly.
if command -v llvm-objdump >/dev/null || [ -x "$tc/usr/bin/llvm-objdump" ]; then
  od=$(command -v llvm-objdump || echo "$tc/usr/bin/llvm-objdump")
  for exe in "$out/$BRAND_NAME" "$out/$BRAND_NAME-sideload"; do
    strong=$("$od" --macho --dylibs-used "$exe" | grep -E '/(AppIntents|_AppIntents_[A-Za-z]+)\.framework/' | grep -v 'weak)' || true)
    [ -z "$strong" ] || { echo "native build: AppIntents linked strongly ($BRAND_NAME would not launch on iOS 15): $strong" >&2; exit 1; }
  done
fi

rcodesign=${RCODESIGN:-$(command -v rcodesign || true)}
ldid=${LDID:-$(command -v ldid || true)}
if [ -z "$rcodesign$ldid" ] && [ -x "$HOME/.cargo/bin/rcodesign" ]; then rcodesign=$HOME/.cargo/bin/rcodesign; fi

SIDELOAD_INTENTS=CheckForUpdatesIntent,AddSourceIntent,RestorePackagesIntent # N8: the both-modes intents

# bundle <iFizBox.app dir> <entitlements> <Info.plist overlay or "">: the executable signed ad hoc with the
# entitlements (the jailbreak trusts ad hoc code; a sideload signer re-signs it), web/app/, icons, Info.plist.
bundle() {
  local app=$1 ents=$2 overlay=$3 exe=$out/$BRAND_NAME
  [ -z "$overlay" ] || exe=$out/$BRAND_NAME-sideload
  mkdir -p "$app/web"
  cp "$exe" "$app/$BRAND_NAME"
  if [ -n "$ldid" ]; then
    "$ldid" -S"$ents" "$app/$BRAND_NAME"
  elif [ -n "$rcodesign" ]; then
    "$rcodesign" sign --entitlements-xml-file "$ents" "$app/$BRAND_NAME" >/dev/null 2>"$out/rcodesign.log" ||
      { cat "$out/rcodesign.log" >&2; exit 1; }
  else
    echo "native build: WARNING no ldid or rcodesign; $app/$BRAND_NAME is ad hoc signed without entitlements" >&2
  fi
  # web/app/ goes in as it is, minus the tests and the website's zsign WebAssembly (F93: the app signs natively).
  # Test fixtures (core/fixtures/: test .p12s, a tiny IPA) stay out too; mkdeb.py/mkipa.py check refuse them.
  # So do the Python tests (icons/test_*.py) and the __pycache__/*.pyc the gate leaves beside them.
  # icons/themes/ (tools/icons.sh: each theme's apple-touch-icon/manifest and glossy sizes, about 11 MB) is the
  # website's: the app shows its icons from the shell's appicon/<name>.png.
  (cd ../web/app && find . -type f ! -name '*.test.js' ! -name '*.test.mjs' ! -name '.*' ! -path './vendor/zsign/*' \
    ! -path './icons/themes/*' ! -path './core/fixtures/*' ! -name 'test_*.py' ! -path '*/__pycache__/*' ! -name '*.pyc' -print0) |
    while IFS= read -r -d '' f; do mkdir -p "$app/web/$(dirname "$f")" && cp "../web/app/$f" "$app/web/$f"; done
  ../tools/buildinfo.sh "$(cd "$app/web" && pwd)" >/dev/null # version and commit for Home's footer
  # The bundled web/ must start (web/app/startup.test.js, skipped without Chromium): a module that fails to load
  # leaves the app on its Loading screen with no crash to show for it.
  if command -v node >/dev/null; then
    IFIZBOX_WEB_DIR="$(cd "$app/web" && pwd)" node --test ../web/app/startup.test.js >"$out/startup.log" 2>&1 ||
      { cat "$out/startup.log" >&2; echo "native build: $app/web doesn't start (web/app/startup.test.js)" >&2; exit 1; }
  fi
  # The sideload IPA's icon has a LITE sash (tools/icons.sh), so it isn't taken for the jailbreak app.
  local icon=AppIcon60x60; [ -z "$overlay" ] || icon=AppIconLite60x60
  # B179: every iPhone size loose (CFBundleIconFiles) and the asset catalog CFBundleIconName names (icon/assets.sh,
  # compiled on a Mac): without Assets.car iOS 26 drew a blank placeholder for the app's notifications.
  local car=Assets.car; [ -z "$overlay" ] || car=AssetsLite.car
  for pt in 20 29 40 60; do
    for x in @2x @3x; do cp "icon/${icon/60x60/${pt}x${pt}}$x.png" "$app/AppIcon${pt}x${pt}$x.png"; done
  done
  cp "icon/$car" "$app/Assets.car"
  # F329: your own icon's two loose sets (icon/alternates.py OWN_SLOTS), the primary icon until the helper writes one
  for s in A B; do for pt in 20 29 40 60; do for x in @2x @3x; do
    cp "icon/${icon/60x60/${pt}x${pt}}$x.png" "$app/IconOwn$s${pt}x$pt$x.png"
  done; done; done
  # F323: every app icon at 180 px as this build's Home Screen shows it (Lite's sashed), for the page: Home's header
  # and Theme > App Icon's thumbnails (Bridge.swift AppScheme serves them as appicon/<icon>.png).
  rm -rf "$app/AppIconThumbs" && python3 icon/alternates.py thumbs "$app/AppIconThumbs" ${overlay:+--lite}
  # B180: the launch screen, Info.plist's UILaunchStoryboardName (compiled on a Mac by launch/storyboard.sh), and
  # the loose PNGs it names (launch/make.py).
  # B203: the .deb's only: the IPA's splash is the neutral UILaunchScreen (Info-sideload.plist).
  [ -n "$overlay" ] || cp -R launch/LaunchScreen.storyboardc "$app/"
  [ -n "$overlay" ] || cp launch/Launch*@2x.png launch/Launch*@3x.png "$app/"
  # B203: every theme's set (launch/make.py): the in-app cover's, and what the helper's launch-theme copies over the
  # files above.
  rm -rf "$app/LaunchThemes" && cp -R launch/themes "$app/LaunchThemes"
  cp bridge.js "$app/bridge.js"
  # Apple's WWDR intermediates and roots, public certificates the on-device signer puts in each CMS (I6).
  mkdir -p "$app/certs" && cp sign/certs/*.cer "$app/certs/"
  sed -e "s/@VERSION@/$version/" -e "s/@BUILD@/$build/" -e "s/@MIN@/$min/" "${brand_sed[@]}" Info.plist > "$app/Info.plist"
  # N8: App Intents (intents/metadata.py stands in for Xcode's metadata step) and the widget extension. The sideload
  # IPA lists only the intents that work without a jailbreak, and its widget has no controls.
  local variant=jailbreak only=()
  [ -z "$overlay" ] || { variant=sideload; only=(--only "$SIDELOAD_INTENTS"); }
  rm -rf "$app/Metadata.appintents"
  python3 intents/metadata.py build "$out/$BRAND_NAME.swiftconstvalues" "$app/Metadata.appintents" "${only[@]}" >/dev/null
  SWIFTC=$swiftc SDK=$sdk RD=$rd LLD=$lld OUT=$out VERSION=$version BUILD=$build LDID=$ldid RCODESIGN=$rcodesign \
    widget/build.sh "$variant" "$app"
  # N9: the share extension (share/build.sh): a shared link -> ifizbox://share?url=…
  SWIFTC=$swiftc SDK=$sdk RD=$rd LLD=$lld OUT=$out VERSION=$version BUILD=$build LDID=$ldid RCODESIGN=$rcodesign \
    share/build.sh "$variant" "$app"
  # F372: the built-in VPN's packet tunnel, the IPA's only (This iPhone installs; the jailbreak app has its helper)
  [ -z "$overlay" ] || SWIFTC=$swiftc SDK=$sdk RD=$rd LLD=$lld OUT=$out VERSION=$version BUILD=$build LDID=$ldid \
    RCODESIGN=$rcodesign sideload/vpn/build.sh "$app"
  [ -z "$overlay" ] || python3 mkipa.py plist "$app/Info.plist" "$overlay" "$app/Info.plist"
  [ -z "$overlay" ] || cp sideload/tailscale/LICENSE "$app/LICENSE-tailscale.txt" # tsnet is BSD-3-Clause
  printf 'APPL????' > "$app/PkgInfo"
}

if [ "$what" != ipa ]; then
  root=$out/root
  rm -rf "$root" "$out/debian"
  mkdir -p "$out/debian"
  bundle "$root/var/jb/Applications/$BRAND_NAME.app" entitlements.plist ""
  # ifizbox-helper: plain 0755, no setuid (the app spawns it as root through the persona attributes); ad hoc signed.
  # Only the .deb has it: the IPA's app finds no helper and runs in sideload mode (Sources/mode.c).
  libexec=$root/var/jb/usr/libexec/ifizbox
  mkdir -p "$libexec"
  clang "${hflags[@]}" -fuse-ld=lld --ld-path="$lld" -Wl,-adhoc_codesign -o "$libexec/ifizbox-helper" helper/main.c helper/policy.c \
    helper/ipa.c helper/paid.c -framework CoreFoundation -lobjc
  chmod 0755 "$libexec/ifizbox-helper"
  # F59: appinst's entitlements, for install-ipa's installApplication:withOptions:error: (helper/entitlements.plist).
  if [ -n "$ldid" ]; then
    "$ldid" -Shelper/entitlements.plist "$libexec/ifizbox-helper"
  elif [ -n "$rcodesign" ]; then
    "$rcodesign" sign --entitlements-xml-file helper/entitlements.plist "$libexec/ifizbox-helper" >/dev/null \
      2>"$out/rcodesign.log" || { cat "$out/rcodesign.log" >&2; exit 1; }
  fi
  # N5: the background upgrade check (daemon/README.md), a launchd daemon; jailbreak only.
  daemon/stage.sh "$root" "$sdk" "$lld" "$ldid" "$rcodesign"
  sed -e "s/@VERSION@/$version-$build/" "${brand_sed[@]}" deb/control > "$out/debian/control"
  for s in postinst prerm; do sed "${brand_sed[@]}" deb/$s > "$out/debian/$s"; chmod 0755 "$out/debian/$s"; done
  python3 mkdeb.py build "$root" "$out/debian" "$out/$BRAND_NAME.deb"
  python3 mkdeb.py check "$out/$BRAND_NAME.deb"
  echo "$out/$BRAND_NAME.deb ($(du -h "$out/$BRAND_NAME.deb" | cut -f1))"
fi

if [ "$what" != deb ]; then
  ipa=$out/ipa
  rm -rf "$ipa"
  bundle "$ipa/$BRAND_NAME.app" entitlements-sideload.plist Info-sideload.plist
  python3 mkipa.py build "$ipa/$BRAND_NAME.app" "$out/$BRAND_NAME.ipa"
  python3 mkipa.py check "$out/$BRAND_NAME.ipa"
  echo "$out/$BRAND_NAME.ipa ($(du -h "$out/$BRAND_NAME.ipa" | cut -f1))"
fi
