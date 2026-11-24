# V20: release 0.30.0

## What I did
- Minor bump 0.29.0 -> 0.30.0. No CHANGELOG.md or release workflow exists; version is native/VERSION, notes come from release-notes/*.md (one file, B424).
- Dry run, then tools/publish.sh 0.30.0 in a scratch clone of origin main (as V19 did): build 5258, tag v0.30.0, site deployed, verify-live "0.30.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.30.0
- `gh run list` is empty by design (build needs the iOS SDK).

## Not verified
- No install of 0.30.0 on a phone.
