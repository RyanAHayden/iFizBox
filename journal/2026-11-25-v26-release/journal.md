# V26: release 0.35.0

## What I did
- Minor bump 0.34.0 -> 0.35.0 (7 release-notes files; no CHANGELOG.md or CI release workflow in this repo).
- Dry run, then tools/publish.sh 0.35.0 in a scratch clone of origin main (as V23): tag v0.35.0, site deployed, verify-live "0.35.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.35.0
- gh run list is empty by design (the build needs the iOS SDK).

## Not verified
- No install of 0.35.0 on a phone.
