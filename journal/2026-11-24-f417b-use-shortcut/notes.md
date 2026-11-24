# F417b: Use Shortcut on On Cellular, the popup and Check Connection

## What I did
- `web/app/signing/cellularsetup.js` (new): adds, checks and runs Cellular Installs for the page and the popup
  (`setUpShortcut`, `repairShortcut`, `checkFailed`, `popupShortcut`, `readShortcut`).
- `web/app/core/cellular.js`: the Use Shortcut row, the popup's buttons and failure texts (`cellularQuestion`,
  `shortcutWhy`, `needsAdding`), and the ran flag in localStorage.
- `web/app/signing/cellular.js`: the popup runs the Shortcut when picked, up to 2 runs per install, then asks.
- `web/app/screens/installroute.js`: three rows (two without the Shortcut), Add Shortcut Again, and Check Connection's
  Shortcut check after the phone answers.
- Tests: `web/app/signing/cellularsetup.test.js`, `web/app/signing/cellular.test.js`, `web/app/core/cellular.test.js`,
  `web/app/screens/installroute-cellshortcut.test.js`.
- `release-notes/F417b.md`: one line.
- `docs/settings.md`: On Cellular's three rows and the Check Connection passage.
- `docs/sideload.md`: the popup paragraph, the Use Shortcut setting, the code list, and the two "no button calls it" lines.
- `GLOSSARY.md`: On Cellular (Use Shortcut on screen and in the meaning), Cellular Installs (cellularsetup.js in code).

## Decisions
- The new module `signing/cellularsetup.js` is reached by `import()`, because the startup module cap
  (`module-graph.test.js`, 120) is full.
- Adding is confirmed by `cellular.check` on the page. Shortcuts never says it was added, and the check also takes iOS's
  Allow early, so the popup goes straight to the run after it.
- How the last run or check went is in localStorage (`ifizbox.cellularShortcut`) and wins over the shell's `added`,
  which only follows checks.
- Where the Shortcut isn't at fault (`not_opened`, `busy`, `vpn_off`, `ran_out`), the offer is Use Shortcut or Try Again,
  not Add Shortcut Again: adding it again would leave two same-named Shortcuts, and neither would run.
- A failed run stays on the popup until one of its buttons is tapped.
- Cap: 2 runs per install, then `ran_out`.
- Without the Shortcut available: the old two rows and the old "Airplane Mode or server." subtitle.
- No Shortcut check in quiet checks. On cellular a tapped Check Connection still checks it: it touches no data.
- The popup sets On Cellular to Use Shortcut right after adding, as the concept does, not after a run that passed.

## Checks
- Chromium (fake bridge, iOS 6 style): the three rows; Use Shortcut spins while adding; a failed check says Shortcut
  Didn't Run, Add Shortcut Again then passes, the row is picked, its footer and Add Shortcut Again slide in; the popup
  with Set Up Shortcut. That was before the review fixes; `node --test` covers those.

## Review
Fixed: Check Connection on cellular checks the Shortcut; used from then on right after adding; a deleted Shortcut that a
run didn't find counts as not added; the spinner is on the tapped row. Kept, against the letter: Use Shortcut instead of
Add Shortcut Again where the Shortcut isn't at fault, and the check after adding (only it tells that it was added).

## Not verified
- Dark and the other eras in Chromium.
- Real cellular (no SIM).
- The Shortcut run itself from the popup on a phone (F417a2 checked the shell's run, not the page's).
- The share-sheet round trip from the page on a phone.
- The 4 s wait when the share sheet goes elsewhere.
