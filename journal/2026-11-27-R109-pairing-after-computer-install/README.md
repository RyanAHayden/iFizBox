# R109: how the pairing arrives after a Computer Install

## Question
After a Computer Install on a free Apple ID, how does the app get its pairing?

## Answer
It does not get it automatically. Before iOS 27 the user must import a file by hand. On iOS 27+ the computer's file is
not used at all, and the app pairs on the phone instead.

## What the code does
- `tools/setup/core/src/lib.rs` (~478) writes the computer's lockdown pairing record to `Documents/pairingFile.plist`
  and prints "Gave the app its pairing file." `worker/src/setup.js` sets `PAIRING_PATH`. `web/app/screens/computer-install.js`
  `makeCode` never sends `pairing=`, so the file is written on every iOS version.
- Nothing in `native/` reads that path. The only way a pairing file gets in is `idevice.import`
  (`native/sideload/idevice/IDeviceBridge.swift`), called from the Import Pairing File picker in
  `web/app/screens/installroute.js`. That row shows only when `pairState` is "file" (`web/app/core/installroute.js`),
  which is `pairOnPhone` false, which is before iOS 27.
- iOS 27+: This iPhone pairs on the phone (Developer Mode > Pair with iFizBox, 6-digit code). The pairing is RemotePairing,
  kept in the Keychain. The computer's lockdown record is not used, and could not be: `native/sideload/idevice/README.md`
  says lockdown's port 62078 is refused over loopback on iOS 27. A free profile has no Network Extensions, so
  `LocalVPN.viaApp` is true and the Pairing page runs the on-phone pairing through LocalDevVPN.
- Before iOS 27: the file is already in the app's folder. The sideload `Info.plist` has `UIFileSharingEnabled`
  (`native/Info-sideload.plist`), so it should show in Files under On My iPhone > iFizBox, and `importPairing` accepts a
  lockdown record. Neither the setup command's messages nor the app's steps (`core/installroute.js` ~291, "Make a
  pairing file ... (idevice_pair or JitterbugPair)") say that it is already there.
- On iOS 27 the file stays in Documents: a full lockdown credential that nothing uses, visible through file sharing.
- Automatic import on first launch was planned (F254g, `plan/DONE.md`) and dropped from the run. It is not proposed here.

## Wrong in docs/sideload.md (not edited: research task)
- ~line 493: "The pairing file still comes from the one-time computer setup." Same claim in
  `journal/2026-11-26-R104-free-route-loopback-vpn/journal.md` item (e).
- ~line 471: describes the write without saying the app never reads it.
- ~line 477: `pairing=` empty is "for an iOS that pairs by itself". The website never sends an empty `pairing=`.
- The phone result paragraph ("The computer setup (checked on a phone ...)"): "the pairing file ... worked" means it was
  written. No read by the app was tested.

## Not verified
- No phone used. Code reading answers the question.
- On-phone pairing on an iOS 27 free-profile install through LocalDevVPN: not run.
- The Files app showing `pairingFile.plist`, and importing it before iOS 27: not run.
- Whether a lockdown record connects over loopback on iOS 17.4 to 26: not known.
- That lockdown is refused on iOS 27 is taken from the idevice README, not re-measured.

## Filed tasks
- D37: docs/sideload.md follow-up (filed with --force: the duplicate guard matched this research task).
- B504: setup command fix, after D37.
