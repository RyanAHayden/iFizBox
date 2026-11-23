# iPhone 15 Pro: the sideload test phone

The iPhone 15 Pro (iPhone16,1, iOS 27, no jailbreak) is the test phone for the sideload build (Lite IPA). It sits on
the Linux desktop's USB, and agents drive it from there with no Mac and no person: `tools/ui-15.sh`, under its lock.

## When to use it

Only when Chromium or a local check can't do it. Changes to `web/app/` are checked in Chromium (the
`tools/readme_shots.py` / `capture.mjs` route, with the fake bridge) and with `node --test`. The phone is for what
needs the real device: the native shell, signing and installing, iOS-only WebKit bugs, Home Screen icons and
notifications. Write in the journal why Chromium couldn't do it.

Hold the lock only while you drive the screen, and give it back even after a failure: in a script, put
`trap 'tools/ui-15.sh unlock T99' EXIT` right after `lock`. When a runner session ends or is dropped, the runner
frees every phone lock its task holds (`runner.toml` `on_exit` runs `tools/ui-release.sh`). A lock nobody gives back
blocks every other phone task until it goes stale after 30 minutes.

## How it works

- **go-ios** (`ios`, a single Go binary on `PATH`) runs the iOS 17+ tunnel in user space (no root), mounts the
  developer disk image, installs IPAs, takes screenshots and launches WebDriverAgent.
- **WebDriverAgent** (Appium's fork) runs on the phone as an XCUITest runner, `com.ryha.wda.xctrunner`, and takes
  touches, typing, Home, lock and unlock over HTTP. go-ios forwards its port 8100 to `127.0.0.1:8100`.
- `tools/ui-15.sh ME up` starts whatever of these isn't running (about 4 s cold); every other command calls it.
  Background logs: `$XDG_RUNTIME_DIR/ifizbox-15/`.
- Coordinates are screenshot pixels (1179x2556), like `ui-7.sh`; the script divides by 3 for WDA's points.

```sh
tools/ui-15.sh lock T99
tools/ui-15.sh T99 install build/iFizBox.ipa   # signs it for this phone, then installs
tools/ui-15.sh T99 launch                      # the brand's bundle ID
tools/ui-15.sh T99 tap 355 2400                # Sources tab
tools/ui-15.sh T99 shot sources                # ref/15/screens/sources.png
tools/ui-15.sh unlock T99                # closes every app, locks the screen, frees the lock
```

## Remote control for a person

`tools/remote-15.py` serves a page on this machine's Tailscale IP (port 8098) that mirrors the screen live (small JPEGs, only when it changes; needs Pillow)
and forwards taps, drags, typing, Home and Wake. Use it when a login or other person-only step blocks an agent: the
page's actions borrow whoever holds the UI lock, so the person types while the agent waits. With the lock free it
takes it as `USER` and gives it back after 5 idle minutes. Anyone on the tailnet can drive the phone while it runs.

## Rig files

In `$IFIZBOX_15_RIG` (default `~/.local/share/ifizbox-rig/`), never in the repo:

- `WDA.ipa`: WebDriverAgent, built and signed (below).
- `ddi/iOS_DDI/`: the personalised developer disk image, copied from a Mac with Xcode
  (`/Library/Developer/DeveloperDiskImages/iOS_DDI`). Mounting asks Apple's signing server (gs.apple.com) for a
  signature; it stays mounted until the phone reboots.
- `selfIdentity.plist`: go-ios's pairing identity. go-ios reads and writes it in the current directory, so
  `ui-15.sh` runs `ios` from this folder; run it there by hand too, or it makes a new one wherever you are.
- `zsign` (native, built from the commit `tools/build-zsign-wasm.sh` pins) and `sign/` (`key.pem`, `cert.pem`,
  `app.mobileprovision`: links to the team's distribution cert and the explicit ad hoc profile that lists this
  phone). `install` signs every IPA with these, keeping its bundle ID, as the app's own signer does: the explicit
  profile carries app groups and push, which the wildcard development profile can't. `--as-is` skips signing.
  The Keychain groups are the ones the app's own signer writes, not the profile's `[TEAM.*, com.apple.token]`:
  `TEAM.<Info.plist ID>` first, then `TEAM.<App ID>`. Keychain items written under a rig-installed build (the
  imported signing identity, the RemotePairing record) then stay readable after an in-app self-update or re-sign.
  An IPA installed with `--as-is`, or by any other signer, can still lose them: re-import the identity and re-pair.
- `ca-bundle.pem`: the system CA bundle plus Apple Root CA (https://www.apple.com/appleca/AppleIncRootCertificate.cer).
  gs.apple.com's chain ends at Apple's own root, which Linux doesn't trust.

## Building and signing WebDriverAgent

WDA needs a **development** profile (`get-task-allow`); ad hoc and distribution profiles don't run XCUITest. The
team has an Apple Development certificate and a development profile for `com.ryha.*` listing this phone, made with
the App Store Connect API (both valid for a year). A new phone needs the profile regenerated with its UDID.

On a Mac with Xcode 26 (no signing in the build):

```sh
git clone --depth 1 https://github.com/appium/WebDriverAgent wda && cd wda
xcodebuild build-for-testing -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
  -destination generic/platform=iOS -derivedDataPath dd CODE_SIGNING_ALLOWED=NO PRODUCT_BUNDLE_IDENTIFIER=com.ryha.wda
```

Then sign `dd/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app` inside-out: each item in `Frameworks/`,
then `PlugIns/WebDriverAgentRunner.xctest`, then the app with entitlements `application-identifier`
`S8NFX3A2LT.com.ryha.wda.xctrunner`, the team ID, `get-task-allow` true, and the profile copied in as
`embedded.mobileprovision`. Over ssh, `codesign` can't use the login keychain: import the `.p12` into a throwaway
keychain, put it on the search list (`security list-keychains -d user -s tmp.keychain-db login.keychain-db`) and
`set-key-partition-list` it, then restore the list and delete it. macOS `security` only reads a `.p12` made with
`openssl pkcs12 -export -legacy`. Zip `Payload/WebDriverAgentRunner-Runner.app` as `WDA.ipa` and run
`ios install --path=WDA.ipa`.

## Gotchas

- **The phone must be unlocked** for touches to land. `ui-15.sh ME wake` unlocks it (it has no passcode). Keep
  Auto-Lock on Never while it's on the cable.
- **While WDA runs, the phone shows WebDriverAgent's black app** if nothing else is in front, and the status bar
  offers "◀ WebDriverAgent…". `launch` brings the app you want forward.
- **`home` from an app can land on the App Library** page; it's the Home Screen, just not page one.
- **After a reboot**, the disk image is gone; `up` mounts it again and restarts WDA (about 5 s).
- **Don't open WebDriverAgent from the Home Screen**: it only runs under the test runner and closes at once
  otherwise. That's normal.
- **`lock-button` is a short side-button press** (an IOHID event). WDA's own `/wda/lock` holds the button, which
  on iOS 27 opens Siri setup instead of locking.
- **Other phones on the same USB are fine**: every `ios` call names this phone's UDID (`IFIZBOX_15_UDID`).
- **Developer Mode** must stay on, and the phone must be trusted by this desktop (usbmuxd pairing record).
- **Notification icons are cached until a restart.** After installing a build or switching the app icon, iOS keeps
  drawing the old icon on notifications (old and new ones) until the phone restarts: `ui-15.sh ME reboot` (about a
  minute; it brings WDA back and unlocks) before judging a notification's icon. The first push right after a
  restart can take a minute to arrive.
- **The Home Screen icon changes at once** after an alternate-icon switch: no restart needed. Only notification
  icons wait for one (above).
- **Dark mode alone keeps the Home Screen's icons light.** While Home Screen > Edit > Customize is on Default,
  iOS 27 draws every icon's light look in Dark mode; only the wallpaper dims. To check a Home Screen icon "in
  Dark", set Customize > Dark > Auto as well as Dark mode, and put Customize back to Default afterwards.
- **WebDriverAgent switches Light/Dark mode**: `curl -X POST 127.0.0.1:8100/wda/device/appearance -d
  '{"name":"dark"}'` (or `"light"`). Put the phone back in the mode you found it in.
- **Test push**: `curl -X POST https://ifizbox.com/api/push/test -H 'Content-Type: application/json' -d
  '{"token":"<token>"}'`. The token is in the push database: `npx wrangler d1 execute ifizbox-push --remote -c
  wrangler.ifizbox.toml --command "SELECT token, version, ios, updated FROM push_devices ORDER BY updated DESC"`
  in `worker/`; launching iFizBox on the phone re-registers it, so its row is the newest `updated` (docs/push.md).
