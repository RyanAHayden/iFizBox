# B349: modal sheets slid up with a black status-bar strip above their nav bar

## Cause

style.css's `.navbar::before` is the status-bar strip above every nav bar: the top inset tall, painted
`var(--site-strip)` by ios6.css (`#000` in the iOS 6 era, whatever the theme). A sheet's bar
(`header.navbar.sheet-bar`, nav/sheet.js) is a `.navbar` too, so it got the strip: a black band at the top of the
sheet that rode up with it and stayed above its bar once settled. In the card eras (iOS 13, iOS 26:
`--sheet-bar-top: 0`) the same layer sat over the top of the card's bar, painted in the era's strip colour, which
there matches the bar, so nothing showed, but the layer was wrong too.

## Fix (web/app/packages.css only)

- Layout: `:root .sheet > .navbar.sheet-bar::before { height: calc(var(--sheet-bar-top) + 22px); }`: the status
  bar's room in the sheet's bar plus the bar's top half.
- Look (a look-only stretch): `background: inherit` with the bar's four layers repositioned the way ios6.css does
  for the app's iOS 7 and iOS 13 nav bars: the base line and the status-bar fill hidden, the highlight at the very
  top, the gloss twice the layer's height from the top, so its top half fills the layer and meets the bar's own
  gloss at the half. The bar's gradient thus runs up under the status bar, no band, no step.
  Flat era bars (iOS 7/13: hairline + colour) show just their colour; iOS 26's one-gradient bar leaves the layer
  empty (first layer sized 0), so its own bar shows.
- `:root` gives the selector (0,4,1), above the app-era rule `html[data-shell="app"]:is(...) .navbar::before`
  (0,3,2), so no strip rule reaches a sheet's bar in any shell.

nav/sheet.js, nav/statusbar.js and ios6.css needed no change (nothing there draws the band). The console sheet
(queue.css `--console-bar`, four layers) gets the same treatment through `inherit`.

## Test

`web/app/sheet-bar-strip.test.js`: the rule's height and look-only paint, and that its specificity beats every
`.navbar::before` rule in style.css, ios6/7/13/26.css and palettes.css. `node --test` on it, ios6-css.test.js and
nav/sheet.test.js: 34 pass.

## Chromium check

`capture.mjs` here (402x874 @3x, 62/34 safe areas): shell `site` and shell `app` (fake `ifizboxNative` in sideload
mode, `data-shell="app"` as App.swift sets it), eras ios6/ios7/ios13/ios26 × light/dark, opens "Add Tweaks" over
Sources, pauses every animation at 140 ms of 350 (mid-slide), shoots, finishes them, shoots again: 32 shots per
run, before (HEAD's packages.css) and after. Kept here: `before-app-ios6-light-mid.png` (black band above the
sheet bar), `after-app-ios6-light-mid.png`, `after-app-ios6-light-settled.png`, `after-site-ios6-dark-settled.png`,
`after-app-ios7-dark-mid.png`, `after-app-ios13-light-mid.png`, `after-site-ios26-light-mid.png`,
`after-app-ios26-dark-settled.png` (the other 25 per run stay out of the repo for size).
Visible change in iOS 6: under the status bar the sheet now shows the top of the bar's gloss stretched, not the
bar's flat status-bar fill (`#4f698b` light) and not black; that is the brief's "gradient runs up under the status
bar". Every iOS 6 bar background (`--nav-bar`, `--dk-nav-bar` in ios6.css and all six in palettes.css,
`--console-bar`) has the four layers the repositioning assumes.
Probe after: the `::before` is `84px` (62 + 22) with the bar's gradients in full-screen eras, `22px` in card eras;
before: `62px`, `rgb(0,0,0)` in iOS 6.

Tripped on: the first "after" run hit port 8761, already served by another slot's server (old code), so my
server never bound and the shots showed the old band; reran on 18349. Use an unusual port and curl-check the
changed file before trusting a capture.

## Not verified

- The real phones (iPhone 7 jailbreak build, iPhone 15 Pro Lite): CSS-only change that Chromium renders the same
  way; AGENTS.md says phone only when Chromium can't check. The jailbreak shell in the capture is the same fake
  bridge with `data-shell="app"`, not a `mode: "jailbreak"` run; the CSS keys on `data-shell`, not the mode.
- In the capture's app shell `--top-inset` came out 62 px, not the 54 px `--status-bar-bottom` the script set, so
  the iOS 6 app case was shot with the safe-area inset; the rule uses `--sheet-bar-top`, which follows
  `--top-inset` either way.
