# V23: release 0.33.0

## What I did
- Minor bump 0.32.0 -> 0.33.0 (no CHANGELOG.md or release workflow; version is native/VERSION, notes from the 15 release-notes files).
- Dry run, then tools/publish.sh 0.33.0 in a scratch clone of origin main (as V22): build 5654, tag v0.33.0, site deployed, verify-live "0.33.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.33.0
- gh run list is empty by design (the build needs the iOS SDK).

## Not verified
- No install of 0.33.0 on a phone.
