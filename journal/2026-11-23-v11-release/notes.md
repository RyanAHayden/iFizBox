# V11: release 0.23.0

## What I did
- Minor bump 0.22.0 -> 0.23.0: new features since v0.22.0 (Source Filters, one source page layout, custom installs
  kept in My IPAs, Cellular Shortcuts for the built-in VPN).
- The repo has no CHANGELOG.md. Versioning lives in `native/VERSION`, and release notes in `release-notes/*.md`
  (docs/release.md). So "move the CHANGELOG Unreleased entries" meant writing `release-notes.md` (here) from the
  19 `release-notes/*.md` files that `publish.sh` deleted in its version commit.
- `release-notes.md` (here): 4 summary lines and 6 bullets, from the 19 release-note files (B332, B334, B350,
  B355-B360, B362, B364, B365, B369, F379, F380, F382-F385). The small ones are folded into "Smaller fixes".
  B369, F383 and F385 are website-only and B358 is not named individually, so none of them appear by name.
- Ran `tools/publish.sh` in a scratch clone of origin (`scratchpad/pub`) on `main`, as V10 did. It needs branch
  `main`, and the main checkout must not be touched. SWIFT_TOOLCHAIN swift-6.4.2-RELEASE, IOS_SDK
  iPhoneOS27.1.sdk, both from the shell's environment.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- Dry run at 90f46b80: exit 0 (build 4600). Real run: exit 0. Main did not move between the two.
- publish.sh: version commit fc719dc7 "Version 0.23.0" on 90f46b80; tagged v0.23.0 at df127f54 (build 4601 plus
  web/app/source.json); tag merged into main and pushed, so the tag is on origin/main. `deploy.sh`:
  "https://ifizbox.com now runs v0.23.0". Piracy list current (Canister f517ff676e47).

**Shipped: 0.23.0** (build 4601), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.23.0>.

## Checks
- release.sh: 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.23.0's (206).
- `tools/release.sh --verify-live 0.23.0` (inside publish.sh): Packages listed 0.23.0-4601 at once; source.json
  showed it after about 4 polls (cache). "0.23.0 is up".
- `gh release view v0.23.0`: draft=false, prerelease=false, published 2026-11-23T07:34:30Z (UTC), 7 assets.
- Apt repo history lists 20 versions back to 0.13.0.

## Not verified
- `gh run list` shows no runs. The repo has no GitHub Actions release workflow (docs/release.md: no release on tag
  push in CI, since the build needs the iOS SDK). `publish.sh` is the release workflow, and it passed.
- No install of 0.23.0 on a phone.
- The in-app upgrade row for 0.22.0 -> 0.23.0 was not watched on a device.
