# V5: release 0.19.1 (interim, "release now")

## What I did
- Patch bump `native/VERSION` 0.19.0 → 0.19.1: an interim release of what landed since v0.19.0, no breaking change.
- `release-notes.md` (here): user-facing changes since v0.19.0, most important first (F350 Details page, B306
  add-source links, B289 Home Screen icon by Mode, F353/B301 Tailscale, B303, B297, B294, B302/B300). Left out as
  not user-facing: T68, T70, R48, R57.
- As in T54/V2, not `tools/publish.sh` (it commits to main and merges the tag into main). Its steps ran on
  `task/V5`: `release.sh --check-auth` (RyanAHayden), `deploy.sh --check-auth` (wrangler logged in),
  `--dry-run` (exit 0), then `tools/release.sh --tag-source`, with `GH_TOKEN` set so the piracy-list sync is
  authenticated (T70).
- Tagged v0.19.1 at 652e81f1 (build 3873); `tools/deploy.sh v0.19.1`: "https://ifizbox.com now runs v0.19.1".
- There's no CHANGELOG.md or release workflow here (docs/release.md); the GitHub release is the changelog.

**Shipped: 0.19.1** (build 3873), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.19.1>.

## Checks
- release.sh: 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.19.1's (206).
- `--verify-live 0.19.1`: /repo/source.json and /repo/Packages list 0.19.1 (-3873) first.

## Not verified
- No install of 0.19.1 on a phone: the task asks for the release and the server checks only.
