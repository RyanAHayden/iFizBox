# B502: free Apple ID installs need the bundle ID to equal the profile's App ID

**What I did.**
- iOS (seen on the 15 Pro, iOS 27) installs an app signed with a free Apple ID's explicit profile only when the app's
  bundle ID equals the profile's App ID.
- `native/sign/Profile.swift` `pinsBundleID` (free and not a wildcard) turns Keep Bundle IDs off in `signingIDs`.
- `native/sign/IPASigner.swift` signs the app as the profile's App ID (a typed bundle ID too) and leaves extensions out.
- New `native/sign/FreeAppID.swift` refuses (`app_id_taken`) when another installed or recorded app, or the running
  iFizBox itself (a computer install), already has that ID, since the install would replace it with its data. iFizBox
  updating itself and re-signing the same app are allowed.
- `signing.inspect` reports `keepBundleId` false on this route.
- Re-sign refuses (`app_id_mismatch`) an app installed under another bundle ID: signed as the App ID it would become a
  second copy.
- iOS 27 can't be asked whether an app is installed, so a recorded app counts until it is removed from Signed Apps.
- Result: on this route only one app can be installed at a time, and an iFizBox that came from a computer install can't
  install other apps yet.
- Decision: each app gets its own App ID (`<bundle id>.<TEAMID>`) and profile. That needs the page to register it with
  Apple before signing, so it is a separate task (filed as a plan item, see the follow-up).

**Tried and failed.**
- Signing a tiny app with zsign, three variants:
  - Own bundle ID, entitlements naming the free App ID: refused 0xe8008016, with either keychain group set.
  - Own bundle ID, `application-identifier` = `TEAM.<own ID>`: refused 0xe8008015 (no profile).
  - Bundle ID = App ID: installed.
- `native/build.sh sideload` is not a target; the target is `ipa`.
- Plain rust `ld64.lld` failed with `-fuse-ld=<path>`; it needs `-fuse-ld=lld --ld-path=`.

**Checks.**
- `native/test_sideload.py`: 3 tests OK, including the new Swift test (`native/sign/tests/sideload/main.swift`).
- On the 15 Pro, with the branch's IPA, a spare free Apple ID, default settings, installed via This iPhone's
  `library.install`:
  - The first test app, B502One, installed as `com.ryha.ifizbox.4549VNVVAG`.
  - B502Two was refused with the message.
  - After uninstalling One and removing it from the record, Two installed.
- Chromium could not do this: signing and installd are device-only.

**Phone side effects.**
- Removed the paid certificate, signed in the spare free Apple ID, and approved its two-factor prompt on the 15 itself,
  typing the code there. Note: `~/.claude/ACCESS.md` says "ask for each 2FA code", while earlier tasks found the code
  shows on the 15. The user should know which applies.
- Revoked the spare account's "iFizBox Website" certificate at the limit (the spare account's own, not iloader's).
- Removed the test apps and test IPAs, restored the exact paid certificate (same serial), and deleted the exported key
  files.
- The branch's build is left installed on the 15.

**Not verified.**
- Launching the free-signed app (needs Developer Mode and Trust).
- The refusal for a computer-installed iFizBox holding the ID on a device: only the native test covers it.
- The sheet's Keep Bundle ID switch on screen: turning it on has no effect on this route; the `signing.inspect` value was
  not checked on the device.
- Re-sign and App Refresh of an app installed this way.
- Whether a paid team's development profile has the same rule.
- An app with extensions on the device.
- The Signing Server route (refused earlier for free profiles).
- The Re-sign refusal on the device: added after the phone run, so the build on the 15 lacks it; the native test covers
  it.
