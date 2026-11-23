# B333: the undo bar in the iOS 13 and iOS 26 styles

The bar a row swipe shows ("Install X queued" / Undo, `nav/undobar.js`) had no iOS 13 or iOS 26 rules, so both eras
drew iOS 6's black keyboard-toolbar bar (with the era's own Done button on it).

## What changed

- `style.css`: the undo bar's geometry moved onto five new era hooks, iOS 6's values as defaults (so iOS 6 and 7 are
  unchanged, checked in the shots): `--undo-left`, `--undo-right` (from the screen's sides), `--undo-lift` (gap over
  the tab bar), `--undo-h`, `--undo-pad`. Its starting transform is `calc(100% + lift)` down, so a floating bar still
  slides up from behind the tab bar; same .3 s timing, transform and opacity only, same replace rule (undobar.js
  itself is untouched apart from its header comment). An era sheet may not set layout (`ios6-css.test.js`), so hooks
  were the way to float it.
- `ios13.css`: a 50pt card 8pt in from the sides and 8pt over the tab bar, 13pt corners, near-opaque fill
  (white .97 / #2c2c2e .97 in OLED Black), a hairline ring and a soft shadow, no backdrop-filter (the era forbids
  it). Message 15pt semibold on the left; Undo is the era's text Done button already (tint, semibold).
- `ios26.css`: a 52pt Liquid Glass capsule, as wide as the tab pill plus Search circle and 10pt above them, with the
  tab pill's own tokens (`--i26-glass`, `--i26-glass-rim`, `--i26-glass-shadow`, `--i26-glass-blur`). Undo is drawn
  as iOS 26's text button (semibold tint, no capsule, dims to .3 while held) instead of the tinted Done capsule.
- `theme-palette.test.js`: the F203 test allowed backdrop-filter on two rules only (tab pill, Search circle); the
  undo bar floats over scrolling content the same way, so it is the third, still only through `--i26-glass-blur`.
- `docs/eras.md`: the hooks in the geometry table; the undo bar left the "no hook yet" list.
- `ios7.css` was on the file list but needed nothing: its flat toolbar already matches iOS 7 (shots).

## Checks

- `shoot.mjs` here: headless Chromium, 402x874 at 3x, iPhone UA, a fake jailbreak shell with one apt source of
  seven packages; opens Sources > repo > All Packages, swipes NewTerm 3 left with CDP mouse events (a real queue
  through rowswipe.js), waits for `.undo-bar.shown` and shoots the bottom 260pt. All eight era x tone shots are
  here (`ios6-light.png` … `ios26-dark.png`); the bar's rect, fill, radius and blur are printed per run.
- `node --test web/app/theme-palette.test.js web/app/ios6-css.test.js`: 36 pass.
- `tools/check.sh` through `run done`.

## Tried and dropped

- Nothing failed in the CSS. The shot script first stopped on the source page (the package list is behind
  "All Packages") and is fixed.

## Not verified

- On a phone: per the rules web checks stay in Chromium. The real WebKit backdrop-filter over scrolling content and
  the iOS 26 app's native glass (`data-glass="native"`) were not looked at; the native glass layer covers the tab bar
  and bar buttons only, so the undo bar keeps its CSS glass there.
- The slide itself frame by frame (only the shown state was shot); the timing and transition rule are unchanged.
- Landscape / side safe areas (Chromium's safe-area override did not visibly apply in these shots).
