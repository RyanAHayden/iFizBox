# T54: release 0.19.0

## What I did
- The task was written at 0.18.0, asking for a minor bump and notes "since 0.17.1". Since then V-tasks
  released 0.18.1–0.18.4, each with its own notes. So I bumped `native/VERSION` 0.18.4 → 0.19.0 (the minor bump
  the task asks for, from where VERSION is now) and wrote `release-notes.md` (here) for what landed since v0.18.4:
  everything before that is already in a published release's notes. Most important first: Glass app icon (F324),
  wide package rows (F348) and Install IPAs row (B291), This iPhone copy reconnect and speed summary (B292, B293),
  Home's More Sources row (B295), fixes (B290, B298, B288). Left out as not user-facing: R45, R48, R53, T67, T69.
- All of the task's `after` tasks were on origin/main; `task/T54` was at origin/main (4878d9da).
- As in T40/V2, `tools/publish.sh` was not used: it commits VERSION to main and merges the tag into main, which
  this session may not do. Its steps ran on `task/T54`: commit 71b881ac (VERSION + notes) pushed;
  `tools/release.sh --check-auth` (RyanAHayden) and `tools/deploy.sh --check-auth` (wrangler logged in);
  `--dry-run` (exit 0); then `tools/release.sh --tag-source --notes …`.
- release.sh tagged v0.19.0 at 4f1a4144 (the build's commit plus `web/app/source.json`, subject is release.sh's
  own, "iFizBox's AltStore source: 0.19.0") and left `task/T54` there; pushed. The runner merges it into main.
- `tools/deploy.sh v0.19.0`: "https://ifizbox.com now runs v0.19.0".

**Shipped: 0.19.0** (build 3788), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.19.0>.

## Checks
- release.sh's own check: all 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.19.0's (206).
- `tools/release.sh --verify-live 0.19.0`: https://ifizbox.com/repo/source.json lists 0.19.0 first;
  /repo/Packages lists com.ryha.ifizbox 0.19.0-3788 first, older releases below it.
- https://ifizbox.com/build.json: version 0.19.0, build 3788.

## Tried and failed
- The first real `tools/release.sh` run stopped before building: `tools/sync-piracy-list.py` got
  `HTTP 403: rate limit exceeded` from api.github.com (anonymous limit, 60/hour for this machine, used up by other
  slots; reset was 34 minutes away). Fix: fetched the same two API answers with `gh api` (authenticated) into the
  scratchpad and passed them through release.sh's `IFIZBOX_PIRACY_SYNC_ARGS="--tree … --commits …"`. The list
  came out unchanged (Canister f517ff676e47, current). Filed T70 so the script sends the token itself.

## Not verified
- No install of 0.19.0 on a phone, and no in-app check that Changes offers it: the task asks for the release and
  the server check only, and phone checks need a task that says so.
