# V16: release 0.26.0

## What I did
- Minor bump 0.25.0 -> 0.26.0 for the new features since v0.25.0: F390, F391, F392, F394 and F397. Fixes in the same release: B379-B387, B389, B390, C69 and C70. B388, D30, T76, T77 and the R tasks are internal and not user-visible, so they are left out of the notes.
- `release-notes.md` (here) is four summary lines and six bullets, from the 16 `release-notes/*.md` files. C69 (the website is iOS 6 only) had no note file, so I added its bullet from the commit.
- The project has no CHANGELOG.md; its release notes go in the GitHub release (`docs/release.md`). The version lives in `native/VERSION`, which `tools/publish.sh` bumps in its own commit.
- V15 (the plan's own auto release, which waits for all tasks) is still open. V16 is the critical release, run with `--now`.
- Ran `tools/publish.sh` in a scratch clone of origin on `main` (scratchpad), as V10-V14 did; the main checkout was not touched. SWIFT_TOOLCHAIN swift-6.4.2-RELEASE, IOS_SDK iPhoneOS27.1.sdk.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- Dry run at 1638a1a6: exit 0 (build 4856). Real run: exit 0; main had not moved.
- publish.sh: version commit 862018f7 "Version 0.26.0"; tagged v0.26.0 at be240914 (build 4857 plus web/app/source.json), merged into main and pushed. `deploy.sh`: "https://ifizbox.com now runs v0.26.0".

**Shipped: 0.26.0** (build 4857), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.26.0>.

## Checks
- `--verify-live` (inside publish.sh): source.json lists 0.26.0 first; Packages lists 0.26.0-4857; "0.26.0 is up".
- `gh release view v0.26.0`: draft=false, prerelease=false, published 2026-11-23T20:17:26Z, 7 assets. `latest/download/iFizBox.ipa` redirects to v0.26.0 (206).
- No GitHub Actions release workflow exists (the build needs the iOS SDK; `docs/release.md`), so `gh run list` is empty; publish.sh's own checks stand in for it.

## Not verified
- No install of 0.26.0 on a phone, and the in-app upgrade row 0.25.0 -> 0.26.0 was not watched on a device: the release is what lets the user test it.
