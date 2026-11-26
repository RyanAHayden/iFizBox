# V28: release 1.0.1

## What I did
- Patch bump 1.0.0 -> 1.0.1. Notes file: one bullet, "UI fixes and improvements." (the notes check demands a full stop, so the brief's line got one).
- Dry run, then tools/publish.sh 1.0.1 --notes FILE in a scratch clone of main (as V26/V27). The first real run pushed the version commit, then release.sh stopped on a Canister 502 (piracy list refresh); the script is idempotent, so a second run published: tag v1.0.1, site deployed, verify-live "1.0.1 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v1.0.1
- The two waiting release-notes files (B459, B464) were deleted by the version commit.
- The first dry run died when its scratch clone disappeared mid-build; a fresh clone worked.

## Not verified
- No install of 1.0.1 on a phone.
