# V24: release 0.34.0

## What I did
- Minor bump 0.33.0 -> 0.34.0 (no CHANGELOG.md or release workflow; version is native/VERSION, notes from the 3 release-notes files: B442, B450, F426d).
- Dry run, then `tools/publish.sh 0.34.0 --notes` in a scratch clone of origin main (as V23): build 5681, tag v0.34.0, site deployed, verify-live "0.34.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.34.0
- `gh run list` is empty by design (the build needs the iOS SDK).

## Not verified
- No install of 0.34.0 on a phone.
