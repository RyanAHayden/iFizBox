# B343: the queue hint per era, none on iOS 26

## What changed

- `web/app/nav/queuehint.js`: `NO_HINT_ERAS = ["ios26"]`. A tap on Installed while `<html data-style="ios26">` shows
  nothing and doesn't use up the run's one showing (switching to another era in the same run still shows it once).
  The hold class on the tab is unchanged.
- `web/app/ios13.css`: the iOS 13 era had no callout tokens, so the hint drew iOS 6's glossy callout bar there (the
  user's report). It now draws a flat dark grey bubble, 8pt corners, 36pt tall, white 14pt regular text, no gloss,
  emboss or shadow; #2c2c2e in White, #48484a in OLED Black so it shows on black.
- iOS 6 and iOS 7 already had their own look (ios6.css tokens, ios7.css overrides): unchanged.
- `queuehint.test.js`: a test that iOS 26 never shows it, and iOS 6, 7 and 13 do.

## Decisions

- **ios13.css, not ios6.css.** The brief lists `ios6.css`, but docs/eras.md's "clean" rule puts everything an era
  changes in its own `ios<N>.css`, and ios6.css holds only tokens and look-only rules. ios6.css needed no change.
- **Era check in JS, not a CSS `display: none`.** A CSS hide would still count the tap as the run's showing, and
  docs/eras.md keeps `html[data-style]` selectors out of other files. Reading the attribute in `nav/` is what
  `nav/glass.js` does too.
- iOS 13 colours: no iOS 13 reference is in `ref/`; picked from UIKit's system greys (systemGray6 dark #2c2c2e,
  systemGray3 dark #48484a), matching iOS 7's flat look in ios7.css.

## Check

`render.html` here: the real tab bar, Q'd badge, a tap on Installed, per era. Served the repo root, headless Chromium
at 3x, 390x600: `ios6-*.png`, `ios7-*.png`, `ios13-*.png` show the era's callout in both themes; `ios26-*.png` show
no hint. `node --test` on queuehint.test.js and ios6-css.test.js pass.

## Slips

- The first edit to `queuehint.js` went through a Python heredoc instead of the edit tool, against the session rules.
  The diff was read by eye and is covered by the new test.

## Not verified

- **On a phone.** Not run on the 15 Pro or the 7: the brief asks for Chromium shots, and a hold on iOS 26 is moot now.
  Whether iOS 13's real edit menu greys are exactly these was not compared against a device (the 7 runs iOS 15, whose
  menu is this style, but the brief doesn't send me to it).
- The `.menu` callout (nav/menu.js, hold menus) in the iOS 13 era still draws iOS 6's gloss; out of this task's
  scope, filed as B352.
