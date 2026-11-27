# B502a: a free Apple ID gives each app its own App ID (native half)

B502 found that a free Apple ID's explicit profile installs only apps whose bundle ID is the profile's App ID, so every
app signed as the setup's one ID and a second app was refused. B502a is the fix for that, split in two: this part is
native only, and the web half (the page makes each app's App ID and profile, and hands it in) is B502a1.

**What I did.**
- `native/sign/FreeAppID.swift`:
  - `appID(for:team:)`: `<bundle id>.<TEAMID>`, not doubled.
  - `keep`: the check and write for a profile handed in. Accepts only a free explicit profile of the held profile's team,
    for the held certificate, that is not lapsed; one file per App ID in the given folder (a newer one replaces the older).
  - `kept`: reads that folder.
  - `profile(for:original:held:kept:certificate:records:installed:)`: the profile an app signs with. An app already
    installed under the held profile's App ID stays there. Otherwise the longest-lasting usable kept profile for the
    app's own App ID (the typed bundle ID if one was typed), else the held one. A profile that pins nothing is used as it is.
  - `resignRefusal`: the `app_id_mismatch` refusal now looks at the profile the app would be signed with.
- `native/sign/IPASigner.swift`: a static `appProfile` hook, set by the shell, that picks the profile for a pinned
  signing; the signer signs with what it returns.
- `native/Sources/Sideload.swift`:
  - `signing.inspect` answers `pinned` and `freeAppId`.
  - `signing.refresh` keeps the profiles it was given.
  - The re-sign refusal uses the app's own profile.
- `native/sign/Library.swift`, `native/Sources/SignAhead.swift`: the record's expiry comes from the profile actually used.
- `native/Sources/MyIPAs.swift`: drops a signed copy under another App ID.
- `native/sign/tests/sideload/main.swift`: new test "free Apple ID: each app signs with its own App ID's profile (B502a)"
  covers the kept profiles, refusals (wildcard, paid team, other team, other certificate, lapsed, held one pins nothing),
  the picks, and two apps side by side under two bundle IDs.

**Follow-ups.**
- B502a1: the web side hands profiles in, so the page makes each app's App ID and profile first; then check two apps on
  the 15 Pro. The handler goes in with its caller, in the same task: `native/test_bridge_contract.py` refuses a Swift
  handler that no page code calls. Add to `native/Sources/Sideload.swift`:
  - the header comment line: `signing.addProfile {profile: base64} -> {appId, expires}` (B502a1), next to the
    `signing.inspect` lines.
  - `b.on("signing.addProfile")` via `SignBridge.run`, next to the other `signing.*` registrations. Decode the base64
    (`bad_profile` when it fails), take `SignStore.identity()` and `SignStore.profile()` (`no_identity` when either is
    missing), then call `FreeAppID.keep(data, held: profile, certificate: KeychainIdentity(id).certificate, in:
    appProfilesDir)`.
  - Answer `{appId: p.appID, expires}`: `appId` without the team, the same form as `freeAppId`; `expires` is ISO 8601,
    or null.
  - The page caller in `web/app/` goes in the same change.
- B502a2: hide the Keep Bundle ID switch where `signing.inspect` answers `pinned`.

**Tests.**
- `SWIFT_TOOLCHAIN` set, then `python3 -m unittest native.test_sideload native.test_sign`: 15 tests passed.
- Failed attempt: the first run skipped the Swift tests silently because `SWIFT_TOOLCHAIN` was unset, so it proved
  nothing about them. The passing run above has the variable set.
- Failed attempt: `signing.addProfile` was registered in `native/Sources/Sideload.swift` with no page caller. The gate
  `test_every_handler_is_called` (`native/test_bridge_contract.py`) failed on it, so the registration was removed and
  the call moved to B502a1.

**Release note.** None: nothing a user can notice until B502a1 hands profiles in.

**Not verified.**
- On-device behaviour on the 15 Pro: nothing hands a profile in yet, so there is nothing to check there. It belongs to
  B502a1.
- That Apple's real per-app profile passes iOS's install: same, B502a1.
- `native/Sources/*.swift` are only compile-checked (`native/build.sh ipa` with `SWIFT_TOOLCHAIN` and `IOS_SDK` set
  passed, after fixing one compile error it found); they were not run.
