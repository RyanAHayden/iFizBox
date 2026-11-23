# F381: each era draws its own spinner (2026-11-23)

Before this, iOS 7, 13 and 26 all showed iOS 6's spinner, only recoloured. Now `nav/spinner.js` draws one set of
images per era (`ERA_SPINNERS`, `spinnerSVG(kind, era)`, `spinnerURL(kind, era)`), and each era stylesheet sets
`--spinner-white`, `--spinner-gray` and `--spinner-large` on `html[data-style="…"]`. Those tokens cover the reload
bar, pull to refresh, the HUD, loading rows, the source row, the tab badge and Home's Reload. iOS 6's images have not
changed.

## Where the measurements come from

- **iOS 13-26: Apple's iOS 27 UI Kit** (`ref/apple-ios27/Apple iOS 27 UI Kit.sketch`, page "Progress Indicators",
  symbols `Progress Indicators/{Light,Dark}/Indeterminate Spinner - Regular` (20 pt) and `- Large` (35 pt)). These
  are vector rectangles, which beats sampling a screenshot:
  - Regular: 8 spokes of 2.67 x 6.67 pt with corner radius 1.5 (so fully round). Spoke 0 sits at x 8.67, y 0, which
    puts it from r 3.33 to 10. As a line with round caps, that is width 2.67 and centre line r 4.665-8.665.
  - Large: 8 spokes of 5 x 13 pt with corner radius 2 (not quite round), from r 4.5 to 17.5. Drawn as `<rect rx=2>`,
    centred in the HUD's 37 pt box.
  - Opacity by spoke, clockwise from 12 o'clock: `1, .15, .27, .39, .51, .63, .75, .87`. The brightest is at 12 and
    the tail trails counter-clockwise behind it, so the turn is clockwise, like `hud-spin`.
  - Colour: the symbol's fill is secondaryLabel, `#3c3c43` at 0.6 (Light) or `#ebebf5` at 0.6 (Dark). That gives
    `gray` and `grayDark`. `white` (`#fff`) is UIKit's old `.white` style mapped onto `.medium`, and it is used on
    the red tab badge. The HUD keeps iOS 6's dark box, so `large` is white.
  - iOS 26 uses the same images as iOS 13 (`ERA_SPINNERS.ios26 = ERA_SPINNERS.ios13`).
- **iOS 7-12: the Teehan+Lax iOS 7 kit** (`ref/teehanlax/ios7/sheet.svg`, the "Loading spinner" group, mask_686).
  It has 12 vector spokes 4 px wide (@2x) from r 10 to 20 px, so 2 pt wide from r 5 to 10 pt. That is the same as
  iOS 6. Its alpha bitmap (`img/579.png`) is flat: the kit draws every spoke at the same alpha, so the fade is not in
  the kit. The iOS 8 kit has the same layer. Following the brief ("thinner, shorter spokes with a smooth fade"), I
  drew width 1.75 pt from r 4.6 to 9.4 (centre line 5.5-8.5). The large one is 2.75 pt, r 8.6-16.9. The fade is
  linear, from 1 at the brightest down to 0.27 (iOS 6's white floor) at the spoke just ahead of it. The brightest is
  at 9 o'clock, as in iOS 6. Grey is `#8e8e93` (iOS 7's system grey).

## 8 spokes need a 45-degree turn

`hud-spin` turns 30 degrees per hold. An 8-spoke image turned that way would land between spoke positions and
jitter. So `style.css` gets `@keyframes hud-spin-8` (8 holds of 45 degrees) and a hook,
`animation-name: var(--spinner-turns, hud-spin)`, on every spinner selector, each prefixed with `:root` so it beats
the `animation:` shorthands in the component sheets that load after it. `ios13.css` and `ios26.css` set
`--spinner-turns: hud-spin-8`. An era stylesheet can't set `animation-name` or hold keyframes itself:
`ios6-css.test.js` (C44) counts both as layout. That is why the hook lives in `style.css`, which is outside the
task's file list. Duration and timing are unchanged (.96 s, linear, no steps(): F166's rule).

## Also changed

- The ios13/26 reload bar on the dark theme now takes `--spinner-gray`, which is secondaryLabel's dark value there,
  instead of pure white.
- Home's Reload (`.bar-button.is-reloading::after`) drew the white spinner, which can't be seen on the light bars
  of iOS 7, 13 and 26 (the first harness shot showed an empty button there). Each era now gives it `--spinner-gray`
  in a look rule.

## Checks

- `nav/spinner.test.js`: each era sheet's tokens equal `spinnerURL(kind, era)` (dark grey too); iOS 7's spokes are
  thinner and shorter with a strictly falling tail; iOS 13's geometry and alphas match the kit; `hud-spin-8`'s holds
  are right; every `animation: hud-spin` selector has its `:root` rule taking the hook. All web/app node tests pass
  (1038).
- `images-zoomed.png`: rsvg-convert at 3x, each @3x pixel drawn 4x. Rows are iOS 6, 7 and 13; columns are grey on
  white, white, large, and iOS 13's dark grey.
- `eras-3x.png`: headless Chromium at deviceScaleFactor 3, made by
  `python3 journal/2026-11-23-f381-era-spinners/shots.py web/app OUT`. It uses the real stylesheets with each
  overlay's markup, and animations are paused at frame 0. Rows are iOS 6, 7, 13 and 26; columns are light and dark.
  Each shot shows the HUD, a loading row, the tab badge, Home's Reload, pull to refresh (refreshing) and the reload
  bar.
- `eras-zoomed.png`: the same Chromium shots with each spinner cropped and every 3x pixel drawn 3x3. There is one
  row per era and theme (iOS 6 light, iOS 6 dark, … iOS 26 dark). Columns are the HUD, loading row, tab badge,
  Home's Reload, pull to refresh and reload bar.

## Not verified

- **No real iOS 7-12 spinner was measured.** There is no device or simulator with iOS 7-12 here (the 4S runs iOS 6,
  the 7 runs iOS 15, the 15 Pro runs iOS 27), and the only iOS 7/8 reference here, the Teehan+Lax kit, has flat
  spokes at iOS 6's size. So the iOS 7 width, length and fade follow the brief's description, not a measurement.
  Compare against a real iOS 7-12 screenshot if one turns up.
- **iOS 13-18 vs the iOS 27 kit**: the kit is iOS 27's. I took iOS 13's indicator to be the same drawing (8
  spokes since iOS 13), but did not compare it against the iPhone 7 (iOS 15) or a screenshot from the 15 Pro. A
  vector kit from Apple was a better source than a screenshot, and driving a phone was outside "Chromium/local
  first".
- **The 8-step turn on a real WebKit**: checked in desktop Chromium (paused frames) only, not on iOS 15 WebKit, where
  F166 found that steps() stands still. `hud-spin-8` uses the same hold-keyframes approach as `hud-spin`, which F166
  proved turns on iOS 15. Not looked at on a phone.
- **No grey large style.** UIKit has `.large` in grey too, but nothing in the app draws a large spinner except the
  HUD. The HUD keeps iOS 6's dark box in every era (restyling it is not this task), so only a white large one is
  drawn. If an era's HUD turns light, add a grey `large` to `ERA_SPINNERS` then.

## Spec review

A fresh reviewer read the diff and the brief.
- Fixed: the Chromium shots weren't zoomed, and pull to refresh wasn't in them (`eras-zoomed.png`, `shots.py`). The
  harness path came from a hard-coded worktree; it now comes from an argument.
- Kept, with the reason: the `style.css` hook (the only way the 8-spoke images can turn 45 degrees: era sheets
  can't set `animation-name`), `grayDark` and the ios13/26 dark reload bar (secondaryLabel's dark value is what
  iOS 13+ draws), and Home's Reload taking the grey spinner (it is one of the era's spinners, and white on a light
  bar can't be seen).
- Left as written down above: no real iOS 7-12 measurement, and iOS 13 taken from the iOS 27 kit.
