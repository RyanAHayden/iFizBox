# F443: one IPAs and Apps row in Installed (jailbreak app)

## What changed

- `screens/installed.js`
  - Jailbreak app: the two rows above the package list (Install IPAs and Apps) are one row, "IPAs and Apps",
    via `ipasAppsRow`. It has the blue install tile, the grey not-installed badge (always shown), and the same
    73 px height as a package row (`packages.css` `.installed-top`, unchanged).
  - Subtitle from `ipasAppsSubtitle`: the counts, e.g. "7 apps · 3 IPAs · 2 not installed". Apps are left out at 0.
    Before the IPA counts are read it shows the app count alone ("Your own IPAs and the apps you install" when there are no apps); with no IPAs it says "No IPAs yet".
  - The row opens `#installed/apps`. That page now has the Install IPAs row at its top in the jailbreak app too,
    as the sideload app's list already did.
  - `refreshAppCount` updates the subtitle in place (no redraw at 0 any more, since the row stays).
    `paintIpaRows` repaints the row when the IPA counts come in. The back-to-root hashchange recount also covers it.
  - `loadApps` counts IPAs in every mode.
  - Removed the old `appsRow` and `appsRowSubtitle`.
- `screens/installed.test.js`: B52's refresh test rewritten for the merged row. New F443 test for the row's link,
  subtitle, badge, and that `topTable` draws one cell.

## Checks

- `node --test web/app/screens/installed.test.js`: 44 pass.
- Headless Chromium with `capture.mjs` and a fake shell (`--native`, a scratch dpkg status of 3 packages, no
  remembered apps, empty IPA library):
  - `root.png`: the one row, 74 CSS px, the same as the package rows (measured 74 for both).
  - Tapping the row opened `#installed/apps`.
  - `apps.png`: the Install IPAs row sits on top of the Apps page. The fake shell's iFizBox Upgrade banner covers
    the top rows in the capture, so it was removed before that shot.

## Tried and failed

- `querySelectorAll` with a selector list (`.install-ipas-row, .ipas-apps-row`) did not match in the tests' fake
  DOM, so it loops over the two classes.

## Decided

- The merged row opens the Apps page, not Install IPAs. Install IPAs is `myipas.js`, which is not in this task's
  files, and the Apps page already shows an Install IPAs row in the sideload app.

## Not verified

- On the iPhone 7 itself. Chromium covers layout and links.
- With real remembered apps and IPAs, the subtitle with counts was checked only in unit tests, not in a shot.
- B460 (pinned letter header on the same page) was not on main when this ran. F443 is queued after it only because
  both change `installed.js`.
