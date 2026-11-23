# V12: release 0.24.0

## What I did
- Minor bump 0.23.0 -> 0.24.0: a new feature since v0.23.0 (Install Switch, the one Shortcut for installs).
- `release-notes.md` (here): 4 summary lines and 3 bullets, from `release-notes/F386.md` and `release-notes/B361.md`.
  B374 (Install popup's Tweaks pushes the Add Tweaks page) is user-visible but had no release-note file; I added a
  bullet for it from its commit.
- Ran `tools/publish.sh` in a scratch clone of origin (`scratchpad/pub`) on `main`, as V10 and V11 did (needs
  branch `main`; the main checkout must not be touched). SWIFT_TOOLCHAIN swift-6.4.2-RELEASE, IOS_SDK
  iPhoneOS27.1.sdk from the shell's environment.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- Dry run at 52bbca97: exit 0 (build 4617). Real run: exit 0, main had not moved.
- publish.sh: version commit d2e8d8e4 "Version 0.24.0"; tagged v0.24.0 at 898ed7c4 (build 4618 plus
  web/app/source.json), merged into main and pushed. `deploy.sh`: "https://ifizbox.com now runs v0.24.0".

**Shipped: 0.24.0** (build 4618), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.24.0>.

## Checks
- `--verify-live` (inside publish.sh): source.json lists 0.24.0 first, Packages lists 0.24.0-4618; "0.24.0 is up".
- `gh release view v0.24.0`: draft=false, prerelease=false, published 2026-11-23T08:25:43Z, 7 assets.

## Not verified
- No install of 0.24.0 on a phone: the task is the release so the user can test it on their own phone.
- The in-app upgrade row 0.23.0 -> 0.24.0 was not watched on a device.
