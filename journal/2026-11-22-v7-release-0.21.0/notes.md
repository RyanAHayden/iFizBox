# V7: release 0.21.0

## What I did
- F370 (era icon sets), F371 (era app icons with dark modes, Match Theme fix) and F369 (real iOS 26 tab bar)
  are all on main, so the release ships them, plus B324, B325, B326 that landed since v0.20.1.
- Minor bump `native/VERSION` 0.20.1 → 0.21.0: three new features, as V6 did for a feature batch.
- `release-notes.md` (here): user-facing changes, most important first. Left out as not user-facing: T73
  (concept page tooling).
- As in V1/V6, not `tools/publish.sh` (it commits to main and merges the tag into main). Its steps ran on
  `task/V7`: `release.sh --check-auth` (RyanAHayden), `deploy.sh --check-auth` (wrangler logged in), pushed
  task/V7, `--dry-run` (exit 0, build 4195), then `tools/release.sh --tag-source`.
- Tagged v0.21.0 at be195d11 (build 4195, the build's commit plus `web/app/source.json`); task/V7 HEAD is that
  commit. `tools/deploy.sh v0.21.0`: "https://ifizbox.com now runs v0.21.0".
- No CHANGELOG.md and no release workflow in this repo (docs/release.md); the GitHub release notes are the
  changelog. The version bump reaches main when the runner merges task/V7.

**Shipped: 0.21.0** (build 4195), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.21.0>.

## Checks
- release.sh: 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.21.0's (206).
- `--verify-live 0.21.0`: /repo/source.json and /repo/Packages list 0.21.0 (-4195) first.
- `gh release view v0.21.0`: draft=false, prerelease=false, published 2026-11-23T02:04:07Z (UTC).

## Not verified
- No install of 0.21.0 on a phone: the task asks for the release only; the features were phone-checked in
  their own tasks.
