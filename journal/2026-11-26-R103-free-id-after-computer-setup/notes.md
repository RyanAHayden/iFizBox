# R103: Free Apple ID after a computer setup, on the iPhone 15 Pro

## Goal
Check on the iPhone 15 Pro, after a real computer setup, what B474 promises:
- Settings > Installation & Signing shows the Free Apple ID group.
- Sign In Again, then Refresh Profile, makes and imports a new profile.
- Home's "Profile Expires Soon ... Renew in Signing" tile opens that page.
- The days left match, and read 7 right after setup.

## Status: blocked until V32 ships
- **Not verified**: everything the task checks (the group, Refresh Profile, the tile, the days left). The check has not run.
- On 2026-11-26 at about 20:45 UTC, the live website (`https://ifizbox.com/app.js`, `/websign-job.js`,
  `/screens/free-apple-id.js`) holds no B474 code. It has no `free-id.json` and no `adoptBundledFreeId`.
- The repo has B474 and v1.0.3 is released, but the computer setup downloads an IPA signed on ifizbox.com. A setup now
  would test the old app.
- The next release (V32, held) should deploy the B474 website. This task is blocked until V32 lands and reopens then.

## Ready for the rerun
- The iPhone 15 Pro lock was free today. The spare free Apple ID is in `~/.config/ifizbox-appleid`. Its 2FA needs no
  person (see `~/.claude/ACCESS.md`).
- Warning: the computer setup replaces the 15's paid Lite copy. Back it up first with `signing.export`, see the memory
  note `iphone15-cert-swap-via-bridge`.

## Plan for the rerun
1. `curl` the three live files (`app.js`, `websign-job.js`, `screens/free-apple-id.js`) and confirm they hold B474's code
   (`free-id.json`, `adoptBundledFreeId`). Stop if they do not.
2. Sign in on the phone through the website and get the code.
3. Run the setup one-liner on this Linux desktop.
4. Developer Mode and Trust on the 15 Pro.
5. Run the checks: the group, Refresh Profile, the tile's Renew, and the days left.

## Rerun 2026-11-26 (later)
Rechecked the three live files: still no `free-id.json` or `adoptBundledFreeId`. Still blocked on V32. **Not verified**: all four checks.
