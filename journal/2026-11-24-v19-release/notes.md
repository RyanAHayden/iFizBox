# V19: release 0.28.0

## What I did
- Minor bump 0.27.0 -> 0.28.0 (F368, F406, F407 are new behaviour; B413-B415 fixes). No CHANGELOG.md exists; notes go in the GitHub release (`docs/release.md`), version in `native/VERSION`.
- Notes written from the six `release-notes/*.md` files. Ran `tools/publish.sh 0.28.0` (dry run first, exit 0) in a scratch clone of origin main, as V16 did; the main checkout was untouched.
- Result: build 5117, tag v0.28.0 pushed, site deployed, `--verify-live`: "0.28.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.28.0
- No GitHub Actions release workflow exists (build needs the iOS SDK), so `gh run list` is empty; publish.sh's checks stand in.

## Not verified
- No install of 0.28.0 on a phone. B415 shipped although its phone test was not run (it was blocked before).
