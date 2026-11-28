# V37: release 1.0.8

## What I did
- Patch bump 1.0.7 -> 1.0.8 in native/VERSION, as earlier releases did (no versioning rule in the repo says otherwise).
- The 18 waiting release notes were merged into 6 bullets.
- The task text named CHANGELOG.md and a release workflow; this repo has neither. The release is tools/publish.sh (docs/release.md).
- Ran tools/check.sh in the worktree first (passed). Then, from a scratch clone of main (publish.sh requires main), a dry run and then tools/publish.sh 1.0.8 --notes FILE, with SWIFT_TOOLCHAIN/IOS_SDK from ~/.local/share. The scratch clone was deleted afterwards.
- Release commits on origin/main: 6a25ebf8 "Version 1.0.8" (also Tweak Index and Donate page counts) and 7312c05a (AltStore source). This branch holds only the journal.
- Tag v1.0.8, site deployed from the tag, verify-live "1.0.8 is up". gh release view shows v1.0.8, not a draft, 7 assets: https://github.com/RyanAHayden/iFizBox/releases/tag/v1.0.8
- gh run list shows no runs (no CI workflow).

## Not verified
- No install or upgrade to 1.0.8 on a phone.
- The free Apple ID changes were not exercised against Apple with the released build.
- One PowerShell parse test was skipped by the gate: no PowerShell on this machine.
