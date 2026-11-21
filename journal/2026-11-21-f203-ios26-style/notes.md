# F203 iOS 26 Liquid Glass style (era) in the theme menu

## What was done

- `web/app/ios26.css` (new): started as a copy of `ios13.css` (inset grouped on #f2f2f7, system font, uppercase
  headers, segmented control, switch, alert, price button, Manage) with the era renamed, then changed where iOS 26
  differs, after the mockup's "iOS 26" phone (theme concepts artifact):
  - tables and Home's tiles with 22pt corners, rows 48pt, headers and footers 20pt in;
  - nav bar with no bar: the page's ground (#f2f2f7, black in OLED Black) fading out over its last 12pt, no hairline;
  - bar buttons as 38pt capsules (translucent white fill, white rim, soft shadow; #1c1c1e in OLED Black),
    label-coloured 15pt medium text; the back button the same capsule with its chevron in ios6.css's border-image
    slot; Done (also in the reload, undo and banner bars) the tint capsule with white text; search field a capsule;
  - the floating tab bar: a 64pt glass pill (translucent fill + `backdrop-filter: blur(14px) saturate(1.8)`, rim,
    float shadow) 14pt in from the sides, the chosen tab a grey capsule with the tint, and Search its own glass circle
    8pt to the right, glyph only; card sheets with 22pt corners.
- The hooks were already there (C52 floating tab bar in `style.css` + `nav/tabbar.js setFloatingTabbar`, C54 large
  titles, card sheets), so the audit's "needs tab-bar and layout code" came down to turning them on:
  `core/settings.js` `STYLE_HOOKS.ios26 = { nav: "large", sheet: "card", tabbar: "float" }` (and `hooksOf` returns a
  `tabbar` key), `screens/settings.js` `applyStyleHooks` calls `setFloatingTabbar` (tabbar.js is already in app.js's
  startup set, so module-graph is unchanged), `theme-boot.js` sets `data-tabbar="float"` and `data-sheet="card"`
  before first paint so the bars don't jump.
- `core/settings.js`: Style's fourth option `iOS 26`, `STYLE_PALETTES.ios26` = White / OLED Black, footer names it.
- `index.html`: links `ios26.css` after `ios13.css`, before `wide.css`.
- Tests: theme-palette.test.js (themeState and theme-boot.js agree for iOS 26 in every Mode/system/preview, with
  card sheets and the floating tab bar; no other era floats; ios26.css linked in order, every selector scoped, nothing
  animated, backdrop-filter only on the pill and the circle and only through `--i26-glass-blur`, 22pt tables, capsule
  buttons); screens/settings.test.js (iOS 26 row, Themes rows hidden, data-style/palette, all three hooks on, iOS 13
  drops only the tab bar, iOS 6 drops all). ios6-css.test.js's "era stylesheet sets no layout" passes on ios26.css.

## Glass and the frame budget (iPhone 7, real WebKit)

In the app the shell draws native bars (`html.native` hides the web nav and tab bars), so the glass only paints on
the website and the Home Screen app. So the measurement ran in Safari on the iPhone 7 (iOS 15.8.8): the site served
from this worktree through `ssh -R` to 127.0.0.1, and `f203-harness.html` (here) loading the real app in a
same-origin iframe on Changes, moving its scroller 7px every frame for 5 s with the blur on and with
`--i26-glass-blur: none` (the fallback), in White and OLED Black, reading rAF intervals. Result
(`iphone7-glass-timing.png`):

| run | fps | p50 | p95 | max | frames > 25 ms |
|---|---|---|---|---|---|
| glass 1 | 59.9 | 17.0 | 17.0 | 45.0 | 2/302 |
| solid 1 | 60.0 | 17.0 | 18.0 | 31.0 | 2/303 |
| glass 2 | 60.0 | 17.0 | 18.0 | 33.0 | 2/303 |
| solid 2 | 59.8 | 17.0 | 18.0 | 33.0 | 2/302 |
| glass dark | 60.1 | 17.0 | 17.0 | 33.0 | 2/303 |
| solid dark | 60.1 | 17.0 | 18.0 | 31.0 | 2/304 |

Glass costs nothing measurable here, so the blur stays; the fallback is one token per tone if a phone ever shows
otherwise. An earlier run gave the same numbers (all 59.9–60.0 fps).

## Screenshots (3x, 402x874, headless Chromium)

`shots/`: White and OLED Black of Home (top and scrolled), Changes (top and scrolled: rows under the pill), a
package page (openMX: capsule back, check and Install), Settings, Settings > Theme and Search. Taken with
`journal/2026-11-18-t12-readme-shots/capture.mjs` against `worker/node.mjs`, steps in `steps.json`.

## Tried and fixed

- Moving the back chevron's path right (to sit inside the capsule) put it past the 26px left slice of the
  border-image, so its tail was stretched across the whole button; the path stays where ios13.css has it.
- The capsule's inset ring drew a seam inside the back button's 13px border slot; the back button uses an outer ring
  (`--i26-back-shadow`).
- `setFloatingTabbar` called on a test fake without `removeAttribute` threw in three old tests; `applyStyleHooks`
  calls it only on an element that has it.

## Choices

- Bar buttons get no backdrop-filter: they sit on the nav bar's opaque ground, where a blur shows nothing and only
  costs. Blur only where the page scrolls under (pill, circle).
- Label-coloured (black/white) bar button and tab text, as iOS 26 and the mockup; the tint marks the chosen tab and
  Done.
- The nav bar is the grouped ground (#f2f2f7) on every page, also over plain white lists (Changes): iOS 26 shows the
  page's own colour there, which needs per-page knowledge (a `:has()` on the root, not in iOS 15.0–15.3).

## Not verified

- **120 Hz**: the iPhone 7 is a 60 Hz panel; the run shows glass and solid equal at 60 Hz. No ProMotion phone runs
  the website with this build in a test (the 15 Pro's app hides these bars; Safari on it was not tried).
- **Touch scrolling**: the harness moves `scrollTop` from rAF (main thread), not a finger's compositor scroll; that
  repaints the blurred area every frame, so it should be the heavier case, but a real fling was not timed.
- **In the app**: native bars are drawn by the shell and do not follow iOS 26 (pill, capsules); the native launch
  set for iOS 26 falls back to the White/OLED keys (no `STYLE_LAUNCH.ios26`), so the splash may not match exactly.
- **Card sheets, alerts, action sheet, pressed states** under iOS 26: not opened or pressed in a capture; they keep
  iOS 13's look apart from the sheet radius and Done capsule.
- **Leftovers still iOS 6 / iOS 13** (as listed in F202's notes, tracked by F331): HUD, share sheet, package rows'
  bold names.
