# B479: a second computer install keeps the old certificate

## Goal
B478 found that a second computer install with a new Free Apple ID certificate leaves the sideload app on the old
certificate. On the iPhone 15 Pro the old serial was `4C36…` and the new one `6C76…`. The app kept the old, revoked
certificate in the Keychain. B479 makes the app switch to the certificate the computer install brought.

## Finding
- `importBundled` (`native/Sources/SignBridge.swift`) imported `ifizbox-identity.plist` only when the Keychain held no
  identity (`BundledIdentity.shouldImport` in `native/sign/Handoff.swift`).
- `refreshBundledProfile` then marked the new file as seen, so it was never imported later either.
- `adoptBundledFreeId` (`web/app/screens/free-apple-id.js`) refused `web/free-id.json` on the serial mismatch.

## Code change
- New pure rule `BundledIdentity.replacesIdentity` in `native/sign/Handoff.swift`. The file's identity replaces the held
  one when all of these hold:
  - the file's certificate differs from the held one;
  - the file's profile lists that certificate, can sign now (not expired) and lists devices;
  - the held identity either came from a file, or has a Free Apple ID profile (`Profile.isFree`, the 7-day team
    profile).
- "Came from a file" is recorded by `rememberImportedCertificate()` after each file import: the SHA-256 of the imported
  certificate is stored under the new UserDefaults key `ifizbox.bundledCert` (`BundledIdentity.importedCertKey`).
- A paid identity imported by hand stays.
- `refreshBundledProfile` checks this rule first, once per file, using the same digest keys as B420. When it replaces,
  it imports with `SignStore.importIdentity` and `confirmImport`, and logs both serials. On failure it marks nothing, so
  the next launch retries.
- B420's profile-only replacement is unchanged. With no readable held profile and no replacement, it still returns
  without marking.
- `adoptBundledFreeId` needs no change: `signing.status` runs on the same serial queue after `importBundled`, so it
  sees the new serial.

## Decision
The phone from B478 was installed by a build from before this fix, so it has no `ifizbox.bundledCert`. The Free Apple ID
branch (held profile `isFree`) covers it, so no migration step is needed.

## Tests
- 12 checks in `native/sign/tests/sideload/main.swift`, "another certificate replaces one a file brought, or a Free
  Apple ID's". They use the fixtures' `cert.der` and `ca.der` as the two certificates.
- `native/test_sideload.py`: the source check for `refreshBundledProfile` is updated. It used to forbid `importIdentity`
  there.
- `SWIFT_TOOLCHAIN=~/.local/share/swift/swift-6.4.2-RELEASE-ubuntu24.04 python3 -m unittest native.test_sideload`:
  9 tests OK.

## Tried and failed
- The first run of `test_sideload` skipped the Swift tests. `SWIFT_TOOLCHAIN` pointed at the parent folder
  `~/.local/share/swift`. It needs the `swift-6.4.2-RELEASE-ubuntu24.04` folder.

## Not verified
- The check on the iPhone 15 Pro: a computer install over an installed copy with a new certificate should leave the new
  serial in `signing.status` and `ifizbox.freeid`. Not run, for two reasons:
  - A computer install (`ifizbox.com/sign/setup.sh`) installs the published app build, which lacks this fix until the
    next release.
  - Making a new Free Apple ID certificate revokes the spare Apple ID's current "iFizBox Website" certificate (`6C76…`),
    which other tasks use.
  - Filed as R105, to run once release 1.0.5 is published.
