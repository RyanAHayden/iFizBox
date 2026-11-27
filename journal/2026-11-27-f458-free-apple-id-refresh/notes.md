# F458: free Apple ID refresh without signing again

## What I did
- App Refresh (GLOSSARY.md): after a setup in the sideload app (Sign In Again / Refresh Profile), installed apps still
  signed with the current certificate get the new profile through misagent over This iPhone's route
  (`com.apple.misagent.shim.remote`). Nothing is signed or copied for them. Apps on another certificate, whose App ID
  Apple no longer lists, or recorded without a certificate serial are signed again, iFizBox last. Apps iOS no longer
  has are dropped from the record. Apps that already last longer than a free profile are left alone (a paid
  certificate's app is not cut to 7 days). iFizBox with no record (a computer install) is not refreshed on its own: taken
  out after the spec review and filed as a follow-up, after the phone run (which had a record for iFizBox).
- Model: BariStore's AGENTS.md "Refresh" section.
- `native/sign/Refresh.swift` (new): `ProfileRefresh.plan` decides per app, `ProfileRefresh.run` installs each profile
  once and hands the rest to re-sign.
- `native/Sources/Sideload.swift`: `signing.refresh {profiles, route: "idevice"}` -> `{renewed, done, failed}`.
- `native/sideload/idevice/IDevice.swift`: `IDevice.withMisagent`; `native/sideload/idevice/pin.env` gains idevice's
  misagent feature.
- `web/app/core/freeroute.js`: `otherProfiles` (one profile per other App ID the apps use, asked once per run) and
  `refreshApps` (calls `signing.refresh`, shows Refreshing Apps).
- `SignedRecord.certSerial` is new; My IPAs' signed copies keep the serial too.

## Checks
- Native test in `native/sign/tests/sideload/main.swift` (stub misagent) passes.
- Node tests in `web/app/core/freeroute.test.js` pass.
- Sideload IPA builds.
- On the iPhone 15 Pro (iOS 27, spare free Apple ID; the phone was needed because misagent, installd and signing are
  device-only): a tiny test app installed with the free certificate from My IPAs (keepBundleId false), then Sign In
  Again. The progress page showed "Refreshing Apps", then "Installed the new profile for <App ID>", then "Done".
  - The phone's provisioning profiles gained one created 2026-11-27T14:51:27, expiring 2026-12-04T14:51:27 (the app's
    was 14:46:16).
  - The app's bundle path, data container and installation SequenceNumber (11280) were unchanged.
  - The record's expiry became 14:51:27; its signed date stayed.
- The app was not launched afterwards, and nothing waited past the old expiry.

## Phone side effects
- Put back the paid certificate (same serial).
- Removed the test app, F458.ipa and the free identity keys.
- Revoked the spare account's older "iFizBox Website" certificate at Apple's certificate limit (not iloader's).
- The first refresh removed 38 records of test apps no longer installed, from the 15's signed list (5 installed ones
  kept). That is the intended behaviour.
- The new build is left installed on the phone.

## Tried and failed
- Keep Bundle IDs on (the default) free install: iOS refused it with 0xe8008016 (invalid entitlements). Filed B502.
  Existing behaviour, not caused here.
- Serving the test IPA over LAN http was blocked on this desktop. `afcclient --documents com.ryha.ifizbox put` worked
  instead.

## Not verified
- That an app still opens past its old expiry (needs 7 days).
- Launching the free-signed test app (needs the Developer Mode and Trust steps).
- The re-sign branch on a device (old certificate or lapsed App ID): only the native test covers it.
- The lockdown route (iOS 15-17.3).
- A refresh with a second App ID's profile on a device.
- A refresh on cellular: the misagent connection does not wait for Airplane Mode as installs do.
- The Refresh Profile button label path while still signed in: the device run used Sign In Again, which runs the same
  setup code.

## Decisions made without asking
- Records without a stored certificate serial (installed before this change) are signed again once.
- BariStore's notBefore fallback was not used.
- A profile iOS refuses is reported, not signed again: the same profile would be refused again.
