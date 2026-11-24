# F245 Website signing with Keep Bundle IDs: keep app extensions

## Verdict

**Kept extensions install on a stock phone, so `websign-job.js` now keeps PlugIns and Extensions when Keep
Bundle IDs is on and zsign changes no ID.** R27 was the deciding phone test, but it was dropped from the run app with
no result. F245 ran that install itself on the rig's iPhone 15 Pro (iOS 27, no jailbreak) on 2026-11-23, with a real
team certificate and profile.

## Phone test

`tools/signtest.mjs`, with removal off (the job as it was before F245), Keep Bundle IDs on. Both IPAs use foreign
throwaway IDs:

- `org.example.f245test`: R26's Tiny IPA with one widget appex, from R26's `tools/mkfx.py` with the ID changed.
- `org.example.f245box`: released iFizBox 0.27.0 IPA with its IDs rewritten. It has the Share, VPN and Widget
  extensions.

Installed over USB with `ios install` (go-ios) and uninstalled after each. The phone was left clean.

| IPA | App ID profile | Profile in appex | Result |
|---|---|---|---|
| Tiny | explicit | no | installed |
| Tiny | explicit | yes | installed |
| Tiny | wildcard `com.ryha.*` | no | installed |
| Tiny | wildcard `com.ryha.*` | yes | installed |
| iFizBox 0.27.0 extensions | explicit | no | installed |
| iFizBox 0.27.0 extensions | explicit | yes | installed |

All six installed. The condition, with the profile copied into each appex, is met.

## Not verified

- **The old "integrity could not be verified" cause is not confirmed.** R26 guessed that a missing profile in the appex
  caused it. These installs succeed without the profile, so that guess is not supported. Other apps with the same
  profiles are or may be on the phone, so iOS may already have had the profile. The old failure may have been another
  bug, such as the zsign mmap bug fixed by `tools/zsign-wasm/fs-mmap.patch`. Not determined; this is speculation.
- Installs went over USB with go-ios, which uses the same installd. The website's own route (itms-services/OTA from
  Safari) is not verified.
- Launching the apps and extensions is not verified. Tiny's extensions are stub binaries.
- The ID-changed case was not re-tested.
- A phone that never had the profile was not tested.
- Extensions' own App Groups, push and similar entitlements get the app's entitlements. The group fix dylib is not
  injected into extensions.
- Website memory for large, extension-heavy IPAs is not checked.

## Change

`web/app/websign-job.js`:

- With Keep Bundle IDs on and zsign changing no ID (the signed ID equals the IPA's own), PlugIns and Extensions are
  kept. Watch is always removed.
- `profileExtensions` writes the profile into each top-level appex, over an old one.
- Keep off, or an `appBundleId` override that changes the ID: all three (PlugIns, Extensions, Watch) are removed as
  before.

`web/app/websign-job.test.js`: real-zsign tests with appexes in PlugIns and Extensions and a Watch app. The old test
is narrowed to `removeTree`.

## Follow-on check

Final job on the phone: `runSignJob` unchanged, no hooks: the Tiny IPA (wildcard profile) and the iFizBox IPA (explicit profile, three extensions) both installed, then were uninstalled; the profile is in each iFizBox appex.
