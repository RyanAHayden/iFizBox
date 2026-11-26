# B483: an app page from another source reads as installed

## Goal
An app page from another source that lists the same bundle ID as the installed app read as installed. Example: fastsign's
modded X while AppTesters' X is installed. The page showed the Installed section, a nav Modify button, and a sheet offering
Upgrade, even though the installed copy came from AppTesters.

## Finding
`screens/altstore.js` found the installed record by bundle ID only, through `core/installed.js` `recordOf`. Nothing checked
which source the record came from.

## What I did
- `core/installed.js`: new `pageInstall(records, id, signed, key)`. The record counts only when `ownKey(record)`
  (`core/altstore.js`) equals the page's key. iFizBox's signed record (`signing.installed`) counts by its credit's source
  when it has one, otherwise it follows the record it stands for.
- Decision: a record or signature with no source of its own, or a page with no key, keeps counting. Nothing says it is
  another app, and this avoids hiding older marks.
- `screens/altstore.js` uses `pageInstall` in `trackingSection`, `appPageAction` (Modify), `appPageJob`,
  `toggleMarked`, `sectionMarkNotInstalled`, and `markedOrSigned` (the mark toggle's on/off state).
- `appVersionInstalled` takes an optional `key`.
- On a foreign page the mark toggle reads outline. A tap marks this source's app, which replaces the other source's record
  of that bundle ID.

## Tests
- New `screens/altstore-installed.test.js`:
  - fastsign page with AppTesters' X installed: Install, no Installed Version row, a fresh job without the Modify sheet;
  - AppTesters page: Modify with Upgrade;
  - signed credit;
  - the mark toggle;
  - `pageInstall` cases.
- `screens/altstore.test.js` and `screens/altstore-marktoggle.test.js` still pass, 40/40.

## Tried and failed
- The first test expectation said "Upgrade" for the nav label. Installed apps read "Modify" there, so the expectation was
  corrected.
- One edit was made with a python heredoc by mistake instead of the edit tool. The result was checked by the tests.

## Follow-up
- Version History (`screens/browse.js`) called `appVersionInstalled` without the page's key. I first filed this as B485, but the spec review counted it as part of this task, so I fixed it here (`{ key: history.key }`) and dropped B485.
- The review flagged the mark toggle's source filter as not asked for. I kept it: the toggle sits in the nav, and a filled toggle on another source's page contradicts "the nav reads Install". Tapping it there marks this source's app and replaces the other source's record for that bundle ID, the same way Install does.
- Not changed: the toggle's `markedRecord` matches the bundle ID exactly, so it doesn't follow B358's custom-ID lookup. That was already the case before this task.

## Not verified
- No phone check. The change is pure JS state, covered by the node tests, so the iPhone 15 was not used.
- The full `tools/check.sh` run was not done at this point. It is still to run before done.
