# V15: release 0.27.0

## What I did
- Minor bump 0.26.0 -> 0.27.0 for the new features since v0.26.0: F389, F398, F399, F400, F401, F402 and F403. Fixes in the same release: B391-B412 that are user-visible, plus C64 (the Tailscale route and LocalDevVPN are removed, and This iPhone draws Set Up from the first frame). F399 has a note file but is left out of the published notes, and B411 and B412 have no note file, so they are left out too. B408 and C64 had no note file; their bullets were written from their commit and journal.
- All of V15's `--after` tasks had landed. The plan's own edit history says "C64 and lower follow-ups are not waited for", so the release did not wait for C64; C64 had already landed on main by the time it ran, so it ships.
- `release-notes.md` (here) is four summary lines and six bullets, from the `release-notes/*.md` files. It is final and published; this file does not change it.
- Known at release: F405 is open (the owner's new iCloud link is not in yet), so the app's direct Add/Update link gives the Install Switch without B398's one-trip fix. F389's idle-VPN fix is in. The notes tell users to use Share Shortcut File for B398.
- The project has no CHANGELOG.md; its release notes go in the GitHub release (`docs/release.md`). The version lives in `native/VERSION`, which `tools/publish.sh` bumps in its own commit.
- Ran `tools/publish.sh` in a scratch clone of origin on `main` (scratchpad), as V10-V16 did; the main checkout was not touched. SWIFT_TOOLCHAIN swift-6.4.2-RELEASE, IOS_SDK iPhoneOS27.1.sdk.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- Dry run at 69fa9b61: exit 0 (build 5026). Real run: exit 0; main had not moved.
- publish.sh: version commit d4e13a9d; tagged v0.27.0 at 138219ca (build 5027 plus source.json), equal to origin main. `deploy.sh`: "https://ifizbox.com now runs v0.27.0".

**Shipped: 0.27.0** (build 5027), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.27.0>.

## Checks
- `--verify-live` (inside publish.sh): source.json lists 0.27.0 first; Packages lists 0.27.0-5027.
- `gh release view v0.27.0`: draft=false, prerelease=false, published 2026-11-24T01:09:18Z, 7 assets. `latest/download/iFizBox.ipa` redirects to v0.27.0.
- No GitHub Actions release workflow exists (the build needs the iOS SDK; `docs/release.md`), so `gh run list` is empty; publish.sh's own checks stand in for it.

## Not verified
- No install of 0.27.0 on a phone, and the in-app upgrade row 0.26.0 -> 0.27.0 was not watched on a device: the release is what lets the user test it.
