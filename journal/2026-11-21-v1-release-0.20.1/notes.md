# V1: release 0.20.1

## What I did
- Patch bump `native/VERSION` 0.20.0 → 0.20.1. Only two user-facing changes landed since v0.20.0 (F367 real
  Liquid Glass bars on iOS 26+, B323 Open Tailscale by bundle ID); 0.19.1 set the habit of a patch for a small
  batch, feature included. No breaking change.
- `release-notes.md` (here): those two, most important first. Left out as not user-facing: R72 (research only).
- As in V5/V6, not `tools/publish.sh` (it commits to main and merges the tag into main). Its steps ran on
  `task/V1`: `release.sh --check-auth` (RyanAHayden), `deploy.sh --check-auth` (wrangler logged in), pushed
  task/V1, `--dry-run` (exit 0, build 4137), then `GH_TOKEN=… tools/release.sh --tag-source`.
- Tagged v0.20.1 at 3c651c1a (build 4137, the build's commit plus `web/app/source.json`); task/V1 already held
  that commit, so the fast-forward to the tag was a no-op. `tools/deploy.sh v0.20.1`: "https://ifizbox.com now
  runs v0.20.1".
- No CHANGELOG.md and no release workflow in this repo (docs/release.md: the build needs the iOS SDK, so there
  is no CI release); the GitHub release notes are the changelog and `gh run list` is empty. The version bump
  reaches main when the runner merges task/V1.

**Shipped: 0.20.1** (build 4137), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.20.1>.

## Checks
- release.sh: 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.20.1's (206).
- `--verify-live 0.20.1`: /repo/source.json and /repo/Packages list 0.20.1 (-4137) first.
- `gh release view v0.20.1`: draft=false, prerelease=false, published 2026-11-22T04:36:10Z; `gh release list`
  shows it as Latest.

## Not verified
- No install of 0.20.1 on a phone: the task asks for the release and the server checks only.
- `gh run list` passing: there is no release workflow to pass (see above).
