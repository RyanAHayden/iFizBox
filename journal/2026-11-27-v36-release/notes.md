# V36: release 1.0.7

## What I did
- Patch bump 1.0.6 -> 1.0.7 in native/VERSION. The 3 waiting release notes (B498c, B501, F458) became 2 bullets; B501's is folded into the sign-in bullet. F459 and B498d had no release note of their own (F459's journal says nothing new users see).
- The task named CHANGELOG.md and a release workflow; this repo has neither. The release is tools/publish.sh (docs/release.md).
- The first dry run was started from the task worktree. publish.sh works on the repo of the current directory, so it stopped at its checks and changed nothing. Re-ran from inside a scratch clone of main (publish.sh requires main), with SWIFT_TOOLCHAIN/IOS_SDK from ~/.local/share: a dry run, then tools/publish.sh 1.0.7 --notes FILE. The scratch clone was deleted afterwards.
- Release commits on origin/main: 3e7e1e0d "Version 1.0.7" and 8f180559 (AltStore source). This branch holds only the journal.
- Tag v1.0.7, site deployed from the tag, verify-live "1.0.7 is up". gh release view shows v1.0.7, not a draft, 7 assets: https://github.com/RyanAHayden/iFizBox/releases/tag/v1.0.7
- gh run list shows no runs (no CI workflow).

## Not verified
- No install or upgrade to 1.0.7 on a phone.
- Free Apple ID sign-in and App Refresh were not exercised against Apple with the released build.
