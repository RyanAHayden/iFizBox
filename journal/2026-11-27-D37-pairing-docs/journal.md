# D37: pairing docs after a Computer Install

Source: journal/2026-11-27-R109-pairing-after-computer-install

## What changed
Docs only, in `docs/sideload.md`:
- "The command" bullet: the app never reads the pairing file the setup writes; only Import Pairing File brings a file in.
- "The code" bullet: `pairing=` empty writes no file; the website never sends it, so `Documents/pairingFile.plist` is written on every iOS version.
- "Free Apple ID without a computer": the pairing after a Computer Install is the on-phone code on iOS 27, and Import Pairing File before iOS 27.
- "Not verified": the computer setup's pairing file is marked as written, not read by the app; a new bullet lists the Files and import check and the on-phone iOS 27 pairing as not run.

No release note (docs only).

## Tried and failed
Nothing failed; no phone was used.

## Not verified
- No phone used. The statements come from reading the code.
- Files showing `pairingFile.plist` and importing it before iOS 27: not run.
- On-phone pairing after a free-profile Computer Install on iOS 27 (through LocalDevVPN): not run.
