# B379: the install log's sheet slid up with B349's gloss under the status bar

## Cause

B349 gave every sheet's bar the status-bar layer of `.navbar::before` (packages.css `:root .sheet > .navbar.sheet-bar::before`),
so a sheet's bar carries its gradient up under the status bar. The install log (nav/progress.js `openProgress`, the
`.console` sheet, queue.css `--console-bar`) is a sheet too, so it lost iOS 6's plain black strip above its bar and showed
that gloss there instead. In the iOS 7, 13 and 26 eras the console bar is already flat black, so nothing showed there.

## Fix (web/app/queue.css only)

- Layout, outside the look-only stretch: in the iOS 6 era (`html:not([data-style="ios7"]):not([data-style="ios13"]):not([data-style="ios26"])`),
  `.sheet.console > .navbar.sheet-bar::before { height: var(--sheet-bar-top); }`. That is the status bar's room only, so a
  card sheet (`--sheet-bar-top: 0`) gets no strip.
- Look, inside the look-only stretch: the same selector gets `background: var(--site-strip);`, black in ios6.css. The
  shorthand resets B349's position and size longhands, so the layer is a plain fill.
- Specificity: the `html:not(...)` chain outranks packages.css's `:root .sheet > .navbar.sheet-bar::before`.
- The strip is part of the sheet's bar, so it slides up with the sheet. Other sheets keep B349's layer.
- iOS 7, 13 and 26 are left alone: their console bar is already flat black.

web/app/packages.css was on the task's file list but needed no change: B349's rule stays as it is and the console's
override wins on specificity.

## Test

`web/app/sheet-bar-strip.test.js` gained two B379 tests:
- the console rule's height is `var(--sheet-bar-top)`, its paint sits in one look-only stretch as
  `background: var(--site-strip)`, and `--site-strip` is `#000` in ios6.css;
- the console selector outranks the B349 sheet layer, and no other `.sheet-bar::before` rule in queue.css, packages.css or
  progress.css reaches a sheet's bar.

`node --test web/app/sheet-bar-strip.test.js web/app/ios6-css.test.js`: 26 pass.

## Chromium check

`capture.mjs` here, adapted from B349's: 402x874 at DPR 3, safe areas 62 top / 34 bottom, served by python http.server on
127.0.0.1:18379. It opens `openProgress` with a few log lines (or an "Add Tweaks" sheet for contrast) with the fake bridge
for the app shell. It runs eras ios6 and ios7, shells site and app, light and dark, each shot mid-slide (animations paused
at 140 ms) and settled.

Probe, iOS 6 console `::before`: 62 px tall, `background-image: none`, colour `rgb(0, 0, 0)`, in both shells, mid-slide
and settled. The plain iOS 6 sheet keeps its 84 px gloss layer. The iOS 7 console is unchanged (84 px, flat black).

Kept here:
- `after-app-ios6-light-console-mid.png`
- `after-app-ios6-light-console-settled.png`
- `after-site-ios6-dark-console-settled.png`
- `after-app-ios6-light-sheet-mid.png` (a plain sheet, for contrast)

By eye: a black strip above the console's bar, then the bar's hairline and gloss below it.

## Not verified

- No device check on a real phone. The iPhone 7 runs iOS 6-era jailbreak builds, but web checks stay in Chromium per the
  project rule.
- No ios13 or ios26 shots: the rule does not apply there.
- No "before" shot for the console: B349's before/after shots cover the old look.
