# V10: release 0.22.0

## What I did
- Minor bump 0.21.0 -> 0.22.0: new features since v0.21.0 (built-in VPN for This iPhone installs, Installed Apps
  with Decrypt in the jailbreak app, swipe back from anywhere, What's New on top of Details).
- `release-notes.md` (here): from `release-notes/*.md` (B330, B339, B351, B352) and `git log v0.21.0..origin/main`,
  cut to 4 summary lines and 6 bullets. Left out as internal: T74 (phone tools), C66 (runner), D27/D28 (docs,
  release tooling), R73 (research), C65 (SideDrop server branch, not deployed), B327's sign-log lines.
- Unlike V1-V7 (which ran publish.sh's steps on the task branch), this one ran `tools/publish.sh` itself, as the
  task asked. It must run on branch `main`, which the main checkout holds, so it ran in a scratch clone of
  origin (`scratchpad/pub`, made by the stopped first attempt, fast-forwarded to origin/main).
  SWIFT_TOOLCHAIN / IOS_SDK came from the shell's environment (~/.bashrc): swift-6.4.2-RELEASE, iPhoneOS27.1.sdk.
- Logins: `release.sh --check-auth` RyanAHayden; `deploy.sh --check-auth` wrangler logged in.
- The first attempt's dry run was killed mid-build (make: Terminated); nothing was published by it.
- Dry run in the clone: exit 0 (build 4403 at 318ce4de). Real run: exit 0.
- Main moved between the dry run and the real run (B353, F378 landed), so the version commit a06bdc2c sits on
  2ba90457 and the release carries them too: B353 (This iPhone subtitle wraps in iOS 26) and F378 (Confirm's
  Refresh Sources row) are small fixes not named in the notes; B353's release note was deleted with the others.
- publish.sh: version commit a06bdc2c pushed; tagged v0.22.0 at ef87b824 (build 4410 plus web/app/source.json);
  tag fast-forwarded into main and pushed; `deploy.sh v0.22.0`: "https://ifizbox.com now runs v0.22.0".

**Shipped: 0.22.0** (build 4410), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.22.0>.

## Checks
- release.sh: 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.22.0's (206).
- `tools/release.sh --verify-live 0.22.0` (inside publish.sh and again on its own): source.json and Packages
  list 0.22.0 (-4410) first.
- `gh release view v0.22.0`: draft=false, prerelease=false, published 2026-11-23T04:30:37Z (UTC); body = notes.

## Not verified
- No install of 0.22.0 on a phone (release only; features were phone-checked in their own tasks).
- The in-app upgrade row in Changes for 0.21.0 -> 0.22.0 was not watched on a device.
