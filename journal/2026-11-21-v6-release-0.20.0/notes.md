# V6: release 0.20.0

## What I did
- Minor bump `native/VERSION` 0.19.1 → 0.20.0: since v0.19.1 a lot of new behaviour landed (iOS 26 style
  F203 and its native controls F345a-d, Add Tweaks F352, Manage > Sources F355, Lite signing up front F359,
  Use the Signing Server F366, Report an Issue F362, ...) on top of B319-B322, so a patch number would undersell it.
- `release-notes.md` (here): user-facing changes since v0.19.1, most important first. Left out as not
  user-facing: R/T/D/C tasks, B317/B319 (remote-15.py tooling).
- As in V2/V5, not `tools/publish.sh` (it commits to main and merges the tag into main). Its steps ran on
  `task/V6`: `release.sh --check-auth` (RyanAHayden), `deploy.sh --check-auth` (wrangler logged in),
  `--dry-run` (exit 0, build 4115), then `GH_TOKEN=… tools/release.sh --tag-source`.
- Tagged v0.20.0 at 46666ee2 (build 4115); task/V6 fast-forwarded to the tag (it adds `web/app/source.json`);
  `tools/deploy.sh v0.20.0`: "https://ifizbox.com now runs v0.20.0".
- No CHANGELOG.md and no release workflow in this repo (docs/release.md: the build needs the iOS SDK, so there
  is no CI release); the GitHub release notes are the changelog. `gh run list` is empty for that reason.

**Shipped: 0.20.0** (build 4115), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.20.0>.

## Checks
- release.sh: 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.20.0's (206); `gh release list`
  shows 0.20.0 as Latest.
- `--verify-live 0.20.0`: /repo/source.json and /repo/Packages list 0.20.0 (-4115) first.

## Not verified
- No install of 0.20.0 on a phone: the task asks for the release and the server checks only.
