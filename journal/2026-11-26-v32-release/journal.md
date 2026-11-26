# V32: release 1.0.4

## What I did
- Patch bump 1.0.3 -> 1.0.4 for the 8 waiting release notes (F447 and B469-B476), merged into 5 bullets.
- Dry run, then tools/publish.sh 1.0.4 --notes FILE in a scratch clone of main (same toolchain paths as the V30 release).
- Tag v1.0.4, site deployed, verify-live "1.0.4 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v1.0.4
- This project has no release workflow in CI (docs/release.md): publish.sh is the release.

## Not verified
- No install of 1.0.4 on a phone.
