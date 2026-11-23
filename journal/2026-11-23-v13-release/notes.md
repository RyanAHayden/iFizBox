# V13: release 0.24.1

## What I did
- Patch bump 0.24.0 -> 0.24.1: the only user-visible change since v0.24.0 is a fix. T75: the Install Switch Shortcut deletes the stored previous VPN before its final Set VPN, so an iOS 27 Set VPN error no longer leaves it behind. The re-signed Shortcut ships in `web/app/shortcuts/`. R77 was research only. This is the run's idle auto release.
- No `release-notes/*.md` files existed (T75 added none), so `release-notes.md` (here) was written from T75's journal. It is one summary line and one bullet.
- The project has no CHANGELOG.md; its release notes go in the GitHub release (`docs/release.md`), so there was no Unreleased section to move. The version lives in `native/VERSION`, which `tools/publish.sh` bumps in its own commit.
- Ran `tools/publish.sh` in a scratch clone of origin on `main` (scratchpad), as V10–V12 did; the main checkout was not touched. SWIFT_TOOLCHAIN swift-6.4.2-RELEASE, IOS_SDK iPhoneOS27.1.sdk.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- Dry run at 5cc82ae7: exit 0 (build 4627). Real run: exit 0.
- publish.sh: version commit 6bacb72f "Version 0.24.1"; tagged v0.24.1 at b9db1f41 (build 4628 plus web/app/source.json), merged into main and pushed. `deploy.sh`: "https://ifizbox.com now runs v0.24.1".

**Shipped: 0.24.1** (build 4628), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.24.1>.

## Checks
- `--verify-live` (inside publish.sh): source.json lists 0.24.1 first; Packages lists 0.24.1-4628; "0.24.1 is up".
- `gh release view v0.24.1`: draft=false, prerelease=false, published 2026-11-23T08:58:27Z, 7 assets. `latest/download/iFizBox.ipa` redirects to v0.24.1 (206).
- No GitHub Actions release workflow exists (the build needs the iOS SDK; `docs/release.md`), so `gh run list` has nothing to check; publish.sh's own checks stand in for it.

## Not verified
- No install of 0.24.1 on a phone, and the in-app upgrade row 0.24.0 -> 0.24.1 was not watched on a device: the release is what lets the user test it.
