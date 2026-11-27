# F463: free Apple ID extensions, native signer

## Split
F463 was too big, so it is split:
- F463 (this task): the native signer only.
- F463c: the page hands extension profiles in, App Refresh renews them, and the keychain-sharing check.
- F463d: the App IDs list and forgetting deleted apps. The original check "a deleted app gone from the list" moved here.

## Done
- `FreeAppID.extensionIDs` and `FreeAppID.usable` (`native/sign/FreeAppID.swift`). The IDs follow the same suffix rule as `core/freeroute.js` `appIdsFor`.
- `IPASigner.extensionProfile` hook (`native/sign/IPASigner.swift`), registered in `native/Sources/Sideload.swift`.
- New Swift test "free Apple ID: an extension signs under its own App ID with its own profile (F463)" in `native/sign/tests/sideload/main.swift`.
- The native half comes from an earlier attempt on branch `wip/F463`, uncommitted when its session ended. Its `Sideload.swift` hunk no longer applied after B502a1, so that hunk was added by hand.

## Tests
With `SWIFT_TOOLCHAIN` and `IOS_SDK` set, `python3 -m unittest -v native.test_sideload native.test_sign`: 15 tests passed.

## Release note
None. Nothing a user can notice until F463c hands profiles in.

## Not verified
- Nothing run on the iPhone 15 Pro. No extension profile is handed in yet; that belongs to F463c.
- That iOS installs an app with an extension signed this way. Same reason.
- The `Sideload.swift` hook registration is only compile-checked by the gate, not run.
- Whether an extension with only its own keychain group can read what the app keeps. F463c.
