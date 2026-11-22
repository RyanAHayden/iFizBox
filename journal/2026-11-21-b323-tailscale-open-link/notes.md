# B323 Open Tailscale without the "Could not sign device" sheet

## What was wrong

Open Tailscale (the Installation page's row, This iPhone's fix row, and the install-failure alert's fix button)
opened `tailscale://`. Tailscale for iOS (1.104.7 on the iPhone 15 Pro) answers every `tailscale:` link with its
Tailnet Lock sheet "Could not sign device — An error occurred: The signing request could not be authenticated:
Unable to verify deeplink".

## What I checked on the iPhone 15 Pro

- Tailscale's installed Info.plist and entitlements (go-ios `ios apps`, installation_proxy Browse, read-only):
  one URL type, `CFBundleURLSchemes = [tailscale]`; no `com.apple.developer.associated-domains`, so no universal
  links; no Home Screen quick actions; `NSUserActivityTypes` are only Siri intents (Connect, Disconnect, …), which
  a URL can't start.
- Opened from Home through WDA (`tools/ui-15.sh open`), with Tailscale's own sheets closed first:
  `tailscale://`, `tailscale://open`, `tailscale:`, `tailscale://app`, `tailscale://login`, `tailscale://ipn`,
  `tailscale:///`. Every one showed "Could not sign device" (read from the accessibility tree; screenshots
  `ref/15/screens/b323-1*.png`, `b323-2*.png`). So no tailscale: link just opens the app.
- iFizBox's own `signing.openApp {bundleId: "io.tailscale.ipn.ios"}` (LSApplicationWorkspace
  openApplicationWithBundleID:, F155), evaluated in the installed app's web view over Web Inspector
  (pymobiledevice3 webinspector cdp): answered `{opened: true}`, Tailscale came forward on its main screen with
  iOS's "◀ iFizBox" back link and no error sheet (`ref/15/screens/b323-openapp.png`).
  Chromium can't check this: it needs the real Tailscale app and iOS's app launch.

## The change

- `core/installroute.js`: `TAILSCALE_ID` and `openTailscale(call)` (signing.openApp by bundle ID). `TAILSCALE_URL`
  stays, only for `idevice.vpnApps`' canOpenURL (that part works: the scheme is registered), with a comment never
  to open it.
- `screens/installroute.js`: all three Open Tailscale paths use `openTailscaleApp`; when iOS won't open it, the
  alert says plainly "Open Tailscale from the Home Screen and turn it on. No Tailscale app? Get it from the App
  Store."
- `signing/route.js` `runFix("openTailscale")`: same bundle-ID open (it was silent on failure before, still is).
- `IDeviceBridge.swift`: comment only (tailscaleScheme is for detection).
- Tests: `core/installroute.test.js` (openTailscale, runFix), `screens/installroute-pair.test.js` (Open Tailscale
  calls signing.openApp, never app.openURL tailscale:, and the by-hand alert).

## Tried and failed

- No other link form: every tailscale: link above fails the same way; there is nothing else registered.

## Not verified

- Tapping the actual Open Tailscale row in a build with this change on the 15: the installed build is the old one
  and building + installing a new Lite IPA wasn't needed to prove the call; the row's code path is covered by the
  fake-DOM test and the bridge call itself was run on the phone against the installed shell.
- Opening Tailscale when it isn't already running in the background (it was running during the test).
  openApplicationWithBundleID: launches cold apps too, but I didn't kill Tailscale to see it.
- Older iOS versions (15–26) for openApplicationWithBundleID:; F155 already relies on it there.
