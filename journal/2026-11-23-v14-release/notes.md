# V14: release 0.25.0

## What I did
- Minor bump 0.24.1 -> 0.25.0 for the new features since v0.24.1: F387 Share opens each style's own action sheet, and F388 Install Switch runs only on cellular or with another VPN up (Tailscale). Fixes in the same release: B375, B376, B377, B378. B376 (the iOS 13 action sheet drawn as one rounded group) is a look fix covered by the Share bullet, so it has no bullet of its own.
- `release-notes.md` (here) is four summary lines and five bullets, from `release-notes/B375.md`, `B377.md`, `F387.md` and `F388.md`. B378 (a built-in VPN start failure is worded as a route failure, with Check Again or the Signing Server offered and no LocalDevVPN offer) had no release-note file, so I added its bullet from the commit.
- The project has no CHANGELOG.md; its release notes go in the GitHub release (`docs/release.md`), so there was no Unreleased section to move. The version lives in `native/VERSION`, which `tools/publish.sh` bumps in its own commit.
- Ran `tools/publish.sh` in a scratch clone of origin on `main` (scratchpad), as V10–V13 did; the main checkout was not touched. SWIFT_TOOLCHAIN swift-6.4.2-RELEASE, IOS_SDK iPhoneOS27.1.sdk.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- Dry run at d0f9050a: exit 0 (build 4668). Real run: exit 0; main had not moved.
- publish.sh: version commit 52b60232 "Version 0.25.0"; tagged v0.25.0 at 053420ec (build 4669 plus web/app/source.json), merged into main and pushed. `deploy.sh`: "https://ifizbox.com now runs v0.25.0".

**Shipped: 0.25.0** (build 4669), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.25.0>.

## Checks
- `--verify-live` (inside publish.sh): source.json lists 0.25.0 first; Packages lists 0.25.0-4669; "0.25.0 is up".
- `gh release view v0.25.0`: draft=false, prerelease=false, published 2026-11-23T15:05:07Z, 7 assets. `latest/download/iFizBox.ipa` redirects to v0.25.0 (206).
- No GitHub Actions release workflow exists (the build needs the iOS SDK; `docs/release.md`), so `gh run list` has nothing to check; publish.sh's own checks stand in for it.

## Not verified
- No install of 0.25.0 on a phone, and the in-app upgrade row 0.24.1 -> 0.25.0 was not watched on a device: the release is what lets the user test it.
