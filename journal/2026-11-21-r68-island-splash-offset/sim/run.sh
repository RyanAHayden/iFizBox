#!/usr/bin/env bash
# R68 check on the Mac (iOS Simulator). Expects next to it: main.swift, LaunchScreen.storyboardc/, Launch*@?x.png,
# web/ (web/app without app.js). For each simulator named in $DEVICES: the system launch screen (splash-<dev>.png),
# the page's frame with --status-bar-bottom set as App.swift does (page-<dev>.png) and the numbers TopInset used
# (inset-<dev>.txt). Simulators missing on the Mac are created as "R68 <type>".
#
#   ssh mba 'cd <dir> && nohup bash run.sh > run.log 2>&1 &'    then poll run.log for "done"
set -euo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
DEVICES=${DEVICES:-"iPhone 17 Pro|iPhone 17 Pro Max|iPhone Air|iPhone 17|R68 16 Pro|R68 16 Pro Max|R68 16|R68 15 Pro|R68 14 Pro|iPhone 16e"}
id=${APP_ID:-com.example.r68island1} # SplashBoard keeps refusing an ID whose launch image once failed

rm -rf App.app && mkdir App.app
xcrun -sdk iphonesimulator swiftc -parse-as-library -target arm64-apple-ios15.0-simulator main.swift -o App.app/App
cp -R LaunchScreen.storyboardc Launch*@?x.png web App.app/
cat > App.app/Info.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$id</string>
<key>CFBundleExecutable</key><string>App</string>
<key>CFBundleName</key><string>R68</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>15.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
<key>UILaunchStoryboardName</key><string>LaunchScreen</string>
<key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>
<key>UIViewControllerBasedStatusBarAppearance</key><true/>
<key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>
EOF
codesign -s - -f App.app

IFS='|'
for dev in $DEVICES; do
  case $dev in
    "R68 "*)
      if ! xcrun simctl list devices | grep -q "$dev ("; then
        t=${dev#R68 }; t=iPhone-${t// /-}
        xcrun simctl create "$dev" "com.apple.CoreSimulator.SimDeviceType.$t" >/dev/null
      fi ;;
  esac
  tag=${dev// /_}
  echo "== $dev"
  xcrun simctl boot "$dev" 2>/dev/null || true
  xcrun simctl bootstatus "$dev" -b >/dev/null
  xcrun simctl ui "$dev" appearance light
  xcrun simctl status_bar "$dev" override --time 9:41 --batteryState charged --batteryLevel 100 || true
  xcrun simctl uninstall "$dev" $id 2>/dev/null || true
  xcrun simctl install "$dev" App.app
  xcrun simctl launch "$dev" $id >/dev/null
  sleep "${SPLASH_WAIT:-3}" # a cold-booted simulator can still show black at 3 s: rerun those with SPLASH_WAIT=5
  xcrun simctl io "$dev" screenshot "splash-$tag.png" >/dev/null
  sleep 8
  xcrun simctl io "$dev" screenshot "page-$tag.png" >/dev/null
  cp "$(xcrun simctl get_app_container "$dev" $id data)/Documents/r68.txt" "inset-$tag.txt" || echo none > "inset-$tag.txt"
  cat "inset-$tag.txt"
  xcrun simctl terminate "$dev" $id
  xcrun simctl shutdown "$dev"
done
echo done
