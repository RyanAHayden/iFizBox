# F405: Install Switch link is still blocked

## Status

- Blocked on the owner. A new iCloud link of the Install Switch has to be made by the owner. Agents don't publish it
  (same as F399).
- No product code changed.

## Checked on 2026-11-23

- The record behind today's `SHORTCUT_LINKS.switch` in `web/app/core/installroute.js`
  (`https://www.icloud.com/shortcuts/733163d13cc04d469e36a6c85c66f32e`) is APPROVED and has 92 actions.
- Main's `tools/shortcuts/install-switch.plist` has 104 actions. The link's record is not the same Shortcut as main.
- Main's signed file `web/app/shortcuts/Install Switch.shortcut` and its raw.githubusercontent.com copy
  (`RyanAHayden/iFizBox`, `main`) have the same sha256, `034a2b19…`.
- `ifizbox.com` serves a different file, sha256 `67e84e79…`. The wizard therefore points at the raw copy.
- `ssh mba` timed out on port 22, so nothing was signed or published from the MBA.

## Wizard

- `/home/ryha/repos/iFizBox/.runner/wizards/F405.sh` saves `SWITCH_LINK` to `.runner/wizards/F405.env`.
- It refuses a link whose action count differs from main's plist.
- It was only checked with `bash -n`. It has not been run.

## Next, once the owner has a link

1. Set `SHORTCUT_LINKS.switch` in `web/app/core/installroute.js`.
2. Compare the record's actions to the plist's, one by one, not just the count.

## Not verified

- The new link, its record, and Add with it. There is no link yet.
- The wizard run itself.
- Why `ifizbox.com`'s file differs from main's signed file.
