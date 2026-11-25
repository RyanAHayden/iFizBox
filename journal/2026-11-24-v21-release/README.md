# V21: release 0.31.0

## What I did
- Minor bump 0.30.0 -> 0.31.0 (no CHANGELOG.md or release workflow exists; version is native/VERSION, notes from release-notes/*.md, written by hand from the 9 files).
- Dry run, then tools/publish.sh 0.31.0 in a scratch clone of origin main (as V20): build 5437, tag v0.31.0, site deployed, verify-live "0.31.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.31.0
- gh run list is empty by design (build needs the iOS SDK).

## Not verified
- No install of 0.31.0 on a phone.
