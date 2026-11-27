# F465a: the app takes the pairing a setup leaves in Documents

## What
- `native/sideload/idevice/IDeviceBridge.swift`: `takeHandedPairing` reads Documents/pairingFile.plist at launch and
  imports it in place of the kept pairing, then deletes the file. Called from `native/Sources/App.swift`. The
  jailbreak build does nothing. Not run on return to the foreground.
- `IDevice.swift` and `IDeviceBridge.swift`: the lockdown-record check (`IDevice.isLockdownRecord`) that the above uses.
- Tests: `native/tests/pairlimit/main.swift` runs the real function with a Swift harness. It needs
  SWIFT_TOOLCHAIN=~/.local/share/swift/swift-6.4.2-RELEASE-ubuntu24.04, otherwise it skips. Run with it, it passed.
  `test_idevice.py` passed.
- The code started from an earlier attempt on wip/F465a, whose session ended uncommitted.

## Decisions
- A file that is no pairing is deleted. The file stays for the next launch if it can't be read or the Keychain won't
  keep the pairing.
- A lockdown record on iOS 27+ is deleted without import. It can't connect there, so it must not replace a pairing
  that works.

## Phone check
iPhone 15 Pro, iOS 27.0.1. Native shell and Keychain, so Chromium can't check it.
- First try failed. The rig's go-ios selfIdentity.plist was converted into an RPPairing record. The app took it,
  deleted the file and showed rp, but Check Connection failed with Pairing Lost: the RemotePairing service does not
  accept that identity.
- Then the app was paired in Developer Mode > Pair with iFizBox. That record was exported with a temporary, uncommitted
  build (removed afterwards) and the pairing forgotten. The real build was installed, the record put in Documents as
  pairingFile.plist, and the app launched: the file was gone, This iPhone showed Ready to Install, Check Connection
  Successful, and `idevice.verify` reported ok, kind rp.
- Home briefly showed the old "Pair Again" tile from the failed first try right after launch. It went away by itself.
- The phone is left paired with iFizBox. The temporary key files were deleted. The app installed on it is this
  branch's build.

## Follow-up
- B506: the computer setup's printed words still tell the person to pick the file by hand (Import Pairing File).

## Not verified
- A file produced by a real Phone Setup or computer setup run.
- A lockdown record on a pre-27 phone. Only the harness, with stand-ins.
- The lockdown-on-27, junk and Keychain-failure branches on a phone. Harness only.
- The jailbreak build on a phone. The guard is in code only.
