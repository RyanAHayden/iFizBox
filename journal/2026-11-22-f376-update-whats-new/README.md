# F376: What's New on top of an app's Details when an update is out

## What changed

- `web/app/screens/altstore.js`:
  - `updateNewsShown(app, installedVersion)`: the rule. True only when the installed version is set, the newest
    version (`versions[0]`) has notes, and `compareVersions(newest, installed) > 0`.
  - `updateNewsGroup(app, record, history)`: the existing `whatsNewGroup` card (title + date, notes, Version History
    row in the same card) for the app's installed record, or null.
  - `updateNewsSlot(app, history)`: an empty slot filled from the real installed record (`core/installed.js apps()`),
    drawn again on `onAppsChange` (Mark as Installed at an older version, an install, a forget), through
    `slideChange` so the card slides in rather than jumping.
  - `renderApp` appends the slot first in the Details pane: above Add Tweaks and Preview. Only the malicious-report
    card (prepended later) can sit above it. More Information keeps its own What's New (`appInfoNodes` untouched).
- `web/app/screens/storepage.js`: unchanged; `whatsNewGroup` already did what was needed.
- Test: `web/app/screens/altstore-updatenews.test.js` (older -> card; same, newer, none, empty, no notes -> no card;
  another app's record -> none; the slot redraws when the list changes).

## Decisions

- The concept faked the installed version; this uses only the stored record, as the brief says.
- The slot follows `onAppsChange` so the page stays right after the nav bar's mark toggle or an update finishes,
  without a full redraw.

## Spec review

- Fixed: the first draw no longer waits on the page body being attached (`alive` only unsubscribes now); notes that
  are only whitespace count as no notes.
- Kept, though the review flagged them as not asked: the redraw on `onAppsChange` and the slide. The nav bar's mark
  toggle changes the record while the page is open (B338 redraws the page for it), and the user's rule is that size
  changes slide. Without these, the card would be wrong until the page reopened.
- Kept: the malicious-report card still goes above this one, since a safety warning comes first.

## Checks

- `node --test` on the new test and the altstore/storepage/handoff/marktoggle tests: pass.
- Chromium shots (`harness.html` renders the real `renderApp` with a sample app; site mode, headless Chromium over CDP,
  390 wide @2x): `older.png` (installed 2.1.2, newest 2.1.3: card at the top) and `current.png` (installed 2.1.3: no
  card). A not-installed render was also checked (no card) and not kept.
- Tried first: `chromium --headless --screenshot` with `--virtual-time-budget`/`--timeout`: the module never ran
  (blank page, no error); driving Chromium over CDP worked.

## Not verified

- The sideload build's Add Tweaks row in the shot: the harness runs in site mode, where Add Tweaks isn't drawn. The
  slot is appended before it in code, so it sits above it; not seen in a picture.
- No phone check: a web-only change, checked in Chromium (AGENTS.md rule).
