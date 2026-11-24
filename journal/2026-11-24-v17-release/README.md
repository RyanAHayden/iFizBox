# V17: release 0.29.0

## What I did
- Minor bump 0.28.0 -> 0.29.0: new behaviour in F409, F410a/b, F412, F413, F414, R91; fixes B416-B420, B423. No CHANGELOG.md exists; the notes go in the GitHub release (`docs/release.md`) and the version is `native/VERSION`.
- Notes written from the 13 `release-notes/*.md` files (4 summary lines, 6 bullets).
- Ran `tools/publish.sh 0.29.0 --notes ...` in a scratch clone of origin main (dry run first, exit 0), as V16 and V19 did; the main checkout was untouched.
- Result: build 5241, tag v0.29.0, site deployed ("ifizbox.com now runs v0.29.0"), `--verify-live`: source.json and Packages list 0.29.0, "0.29.0 is up". https://github.com/RyanAHayden/iFizBox/releases/tag/v0.29.0
- No GitHub Actions release workflow exists (the build needs the iOS SDK), so `gh run list` is empty; publish.sh's own checks stand in.

## Not verified
- No install of 0.29.0 on a phone, and the in-app upgrade row was not watched on a device.
