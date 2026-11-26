# B475: on the free Apple ID route, an in-app install fails loudly

## Problem
On the free Apple ID route, the in-app install (Installed > iFizBox > Install) signed the app on the phone, then handed
the IPA to the Signing Server (itms-services). iOS refuses an app with a free profile from a website
(`MIInstallerErrorDomain` 111) without a word to the app: the Console Log ended Completed with nothing installed.
The IPA also kept bundle ID `com.ryha.ifizbox`, while the free profile is for `com.ryha.ifizbox.<TEAMID>`.

## Changes
- (a) `native/sign/Profile.swift` `isFree`: a team profile ("iOS Team Provisioning Profile…" or `LocalProvision`) whose
  CreationDate to ExpirationDate is at most 8 days. Free profiles last 7 days, paid team profiles a year. Swift tests
  in `native/sign/tests/main.swift`.
- (b) `signing.status`'s profile carries `free` (`native/Sources/SignBridge.swift`).
- (c) The shell refuses the Signing Server route on a free profile (an install before it downloads, a signed-ahead copy before it uploads):
  `Sideload.refusesFree` in `signing.install` (`native/Sources/Sideload.swift`), and `signing.open`
  (`native/Sources/SignAhead.swift`; the signed copy stays kept). It answers `free_profile: …`. This covers every
  caller: the IPA queue run, single installs and iFizBox's own update.
- (d) `web/app/core/signing.js`: `freeProfile(status)`, `FREE_PROFILE_TITLE` ("Free Apple ID Can't Install"),
  `freeProfileText(name)`, and `deviceError`'s `free_profile` case, which opens Signing.
- (e) `web/app/signing/freeprofile.js` (new, loaded lazily so the app's startup module count stays under its cap):
  `onFreeProfile(native)` reads `signing.status`, and `selfParams` turns Keep Bundle IDs off. It is used only for
  iFizBox's own row: `signing/queue.js` `prepareOnDevice` and `signing/route.js` `installOnDevice`. So iFizBox's own
  update is signed as `<bundle ID>.<TEAMID>`, the ID the Computer Install gave it.
- (f) Tests: `web/app/signing/freeprofile.test.js`.

## Tried and dropped
A JS-side check: read `signing.status` before every Signing Server open or install. It added a bridge call to every
install, broke 4 call-order tests (`markedresign`, `signing-client-device`, `apprun`) and pushed `app.js`'s static
import closure over its 120-module cap. The shell-side refusal needs no extra call.

## Device check (iPhone 15 Pro, iOS 27.0.1, 2026-11-26)
- Built the Lite IPA from this branch. Read the free identity from the installed free copy through Web Inspector
  (`signing.export`), then signed the build with it (zsign, plug-ins removed, bundle ID `com.ryha.ifizbox.4549VNVVAG`,
  keychain group `4549VNVVAG.com.ryha.ifizbox.4549VNVVAG`). Installed it over USB (`tools/ui-15.sh install --as-is`).
  The Keychain identity survived.
- `signing.status` then said `free: true` for "iOS Team Provisioning Profile: com.ryha.ifizbox.4549VNVVAG".
- Installed > iFizBox > Modify > Reinstall > Confirm. The log said "App iFizBox.app: com.ryha.ifizbox ->
  com.ryha.ifizbox.4549VNVVAG", left out the 3 plug-ins, and signed it as `com.ryha.ifizbox.4549VNVVAG`. Then it failed in
  red: "iFizBox: iOS doesn't install iFizBox from the Signing Server when it's signed with a free Apple ID, and This
  iPhone needs Network Extensions, which a free Apple ID's profile doesn't have. Use a certificate in Settings >
  Installation & Signing, or install iFizBox again from a computer (Computer Install on ifizbox.com)." and "1 failed",
  not Completed.
- Screenshot: `ref/15/screens/b475-run.png` (not committed). The identity files were deleted afterwards.
- The free copy on the 15 is now this branch's dev build (1.0.3 build 6025, no plug-ins), instead of the website's
  release copy.

## Finding
On a free profile there is no in-app route that installs at all. The Signing Server is refused by iOS, and This iPhone
needs the built-in VPN (Network Extensions, which free profiles can't have). So a free route needs a computer for every
weekly re-sign today. Filed as the follow-up research task R104 (a loopback VPN app instead of the built-in one, and
what it would change).

## Other observation
The blue dot on the older Lite copy (`com.ryha.ifizbox`) in T87a is most likely iOS starting to replace that copy,
since the IPA carried its unsuffixed bundle ID. The own update now carries the suffixed ID. Not reproduced.

## Not verified
- The website's own free path is unchanged (not touched).
- The refusal through `signing.install` (the single install path) was checked only in node tests. The phone run went
  through the IPA queue (`signing.open`).
- Other apps (not iFizBox) on a free profile: node tests only.
- iOS error 111 itself is still not read from the device log. The new refusal happens before iOS is asked.
- The jailbreak build is unaffected (signing is refused there anyway).
- A paid Xcode team profile (1 year) is treated as not free: Swift test only, no such profile on hand.
