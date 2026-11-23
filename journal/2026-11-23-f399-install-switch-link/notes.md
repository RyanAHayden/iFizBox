# F399: Install Switch iCloud link

## What was done

- No code changed. The link is still null: `SHORTCUT_LINKS.switch` in `web/app/core/installroute.js` is the one
  place to set it.
- The owner has to make the link. It publishes the Shortcut from the owner's iCloud account, so an agent must not
  make it (same as F392).
- No existing link was found in `web/`, `docs/` or `journal/`. The only one is a dummy in
  `installroute-b359.test.js`.
- The wizard `.runner/wizards/F399.sh` (main checkout) walks the owner through it: add main's raw GitHub copy of
  `web/app/shortcuts/Install Switch.shortcut` to Shortcuts, then Copy iCloud Link. It writes `SWITCH_LINK` to
  `.runner/wizards/F399.env` in the main checkout. It passes `bash -n`; it has not been run.

## Finding: the live site serves a different file

- On 2026-11-23, `https://ifizbox.com/shortcuts/Install%20Switch.shortcut` had md5
  `66403dd230114c131b04f4ee306ba1b0`.
- Main's `web/app/shortcuts/Install Switch.shortcut` (re-signed in F394, commit `e0e07268`) and its
  raw.githubusercontent.com copy both had md5 `e7ee904c53a6e6bf66ca02a4806a71bb`.
- The cause is not checked. It is probably a deploy that has not happened since F394. A link made from the site's
  file could be out of date, so the owner should use main's raw GitHub file.

## Next session

- Read `.runner/wizards/F399.env` in the main checkout (or the answer on the task) for `SWITCH_LINK`.
- Check that the link opens the current Install Switch (md5 `e7ee904c...` once imported, or by its contents).
- Set `SHORTCUT_LINKS.switch` in `web/app/core/installroute.js`.
- Update `docs/sideload.md`, which says the link is "null today".
- Add `release-notes/F399.md`.
- On the iPhone 15 Pro (it was listed by `ios list` today), check Add from the link. Check that "Share Shortcut File"
  shows with a real link.

## Not verified

- Add from the link on the 15 Pro.
- "Share Shortcut File" shown with a real link.
- The owner's steps on iPhone. The Safari download of the raw file opening in Shortcuts was not tried.
- Why the live site's file differs from main.
