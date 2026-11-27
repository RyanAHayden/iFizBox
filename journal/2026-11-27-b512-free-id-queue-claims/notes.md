# B512 free Apple ID: claims for signed apps not yet installed

Two new apps installed at once on a free Apple ID with no sign-in could share one App ID: the second replaced the
first or made the first fail. Now the second is refused with Sign In Needed.

Cause (now confirmed): the app queue signs ahead, and a signed record is only written once an app is installed.
`FreeAppID.holder` read records only, so a second new app signed under the held profile's App ID.

What changed:

- `FreeAppID.Claims` (static `claims`) in `native/sign/FreeAppID.swift`. `holder` takes `claimed:`, so a claimed App ID
  counts as held.
- `native/Sources/SignAhead.swift` claims on its serial `signer` queue right after signing, and releases on install,
  failure, cancel, discard or expiry.
- `signAndOpen` in `native/Sources/Sideload.swift` (used by `signing.install` and Re-sign All) claims too while it installs.
- Claims are only made for a profile that pins the bundle ID (a free Apple ID).
- A copy kept again after a failed install holds no claim: only the Signing Server can open it, and it refuses a free
  Apple ID.

Known limit, unchanged from before (see journal/2026-11-27-B502a1-free-app-id-queue): when no bundle ID is known before
signing and the held App ID is taken, the refusal comes before an App ID can be made, even with a sign-in session. A
copy signed but not yet installed can now be what takes it.

Verified:

- `native/sign/tests/sideload/main.swift`: the claim tests (refused while claimed, allowed once released; not the shell's release calls).
- `native/test_sideload.py` 9/9 OK with the Swift toolchain.
- `make -C native package` built the .deb and the IPA.

Phone check, iPhone 15 Pro, this branch's Lite build (Chromium can't do real signing or installing):

- `signing.export`, then `signing.remove`, then signed in with the spare free Apple ID (2FA done on the phone).
- At Certificate Limit, revoked the old "iFizBox Website" certificate and left iloader's.
- Reloaded the page to drop the session.
- Put two test apps `com.ryha.b512.one` and `com.ryha.b512.two` into Documents, queued both with `queueLibraryInstall`,
  and tapped Confirm.
- Result PASS: B512 one installed as `com.ryha.ifizbox.<TEAM>`. B512 two failed with "Sign in with your free Apple ID in
  Settings, then install it again" and the Sign In Needed alert.

Phone restored: original certificate back (same serial), freeid localStorage keys removed, test app uninstalled and its
record forgotten, test IPAs deleted, same 5 signed records as before. The phone keeps this branch's build. The spare
Apple ID has a new "iFizBox Website" certificate.

Not verified:

- Install failure, discard and 30-minute expiry releasing the claim on a device. The release itself is unit tested; the
  calls in `SignAhead.swift` and `Sideload.swift` for those paths are only compile-checked.
- A direct `signing.install` running beside a queue run.
- The queue with a live sign-in session on this build.
