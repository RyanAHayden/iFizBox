# F367: real Liquid Glass bars in the app on iOS 26+

User, 2026-11-21: the iOS 26 style on iOS 26+ isn't real Liquid Glass. F203 draws the floating tab bar, the Search
circle and the capsule bar buttons in CSS (backdrop-filter blur, no refraction); F354 found the shell draws no UIKit
bars, so F345's plan row "glass bars drawn by the shell as UIGlassEffect views on iOS 26+" was never built.

## Research: the cleanest shape

The build links against the iOS 27.1 SDK (`IOS_SDK`), so `UIGlassEffect`, `UIGlassContainerEffect`,
`UIButton.Configuration.glass()/.prominentGlass()` and `UIView.cornerConfiguration` are all in the headers and compile
behind `@available(iOS 26.0, *)`; the deployment target stays iOS 15.

| | A real `UITabBar` (and bar button items) | UIGlassEffect views laid over the web's rects (chosen) |
|---|---|---|
| Glass | UIKit's own, with the selection lens drag | UIKit's own material (`UIGlassEffect`, interactive), refraction and lensing included; no lens drag between tabs |
| Search circle | only `UITabBarController` with a `UITab` of role `.search` separates it; a bare `UITabBar` has no such API | its own glass circle, joined to the pill by a `UIGlassContainerEffect` so they blend like iOS's |
| Layout | UIKit's, which would have to be matched by the web (or the web would move under it) | the page's own: every rect comes from the CSS look-alike, so the CSS bar under it and the glass line up to the half point, in every size |
| Badges | number only | number, or the Sources spinner |
| Nav buttons | a `UINavigationBar` would also own titles, back history and the push animation, against the one-WKWebView design (docs/native.md R3 (a)) | glass `UIButton`s at the buttons' rects; the title stays the page's |
| Pushes, sheets, popups | the bar would sit over the page's own sheets (they are web) | hidden whenever the page's own sheet, popup or slide is over or moving it, as F345d's scope bar |
| Shell rules | breaks `native/test_web_bars.py` (no UIKit bars) | keeps it |

So: **glass views over web rects**, the F345d pattern (`ui.segments`) grown to the bars. One bridge call `ui.glass`
(open / update / close, a stream for `ready` and taps), one watcher in the page.

## What I did

- `native/Sources/NativeGlass.swift` (new), registered in `Bridge.swift`:
  - `GlassBars`, a full-size view on the web view that lets every touch through except on its glass.
  - The tab bar: a `UIGlassContainerEffect` view holding the pill and the Search circle, each a
    `UIVisualEffectView(UIGlassEffect(style: .regular))`, interactive, `cornerConfiguration = .capsule()`. In them one
    `TabItem` (a `UIControl`) per tab with the page's glyph, label and badge at the page's rects, and the chosen tab's
    capsule behind it, coloured from the page's computed styles (`--tab-text`, `--tab-text-active`, `--tab-active`).
  - The nav bar's buttons: `UIButton.Configuration.glass()` (`.prominentGlass()` for Done), the page's title, font and
    colour; Back gets ios26.css's chevron (drawn from the same path); icon buttons (Share, the app page's toggles) the
    page's glyph.
  - Below iOS 26 it answers `unsupported:`; a page load closes it (as `NativeSegments`).
- `web/app/nav/glass.js` (new): the watcher, loaded only where the bridge takes calls (`nav/tabbar.js`
  `createTabbar`, a dynamic import, so the startup module count doesn't grow):
  - **When**: the bridge, `<html data-controls="native">` (F345a: the app on iOS 26+ under ios26) and the floating
    tab bar (`data-tabbar="float"`).
  - **What it sends**: the pill's and circle's rects; each tab's id, rect, chosen, glyph, label and badge; each bar
    button of the top nav item (id, rect, kind back/done/plain, title, font, colour, glyph); `dark`; the colours;
    `buttonsHidden` and `tabbar.hidden`.
  - **Glyphs**: the CSS glyph (`::before`'s mask, else its background image) drawn once into a PNG at the screen's
    scale on a canvas, sent once per open by key; masks go as template images the shell tints.
  - **Hidden** while: a popup is up; the page's own sheet or page covers it (hit test at its middle); its nav item
    slides (`.is-moving` on push, pop and the edge swipe, inline transforms, Web Animations on transform). The tab bar
    stays during a push; the buttons hide for its 0.35 s and come back at rest.
  - **The look-alikes**: `<html data-glass="native">` while the glass is up, and `data-glass-shown` on each look-alike
    it covers right now, set on the shell's answer and taken off at once whenever the glass stops covering it.
    ios26.css makes those see-through (`opacity: 0`). The nav bar's ground under the hook is iOS 26's scroll edge (the
    page's ground fading from the status bar to nothing at the bar's foot), so the content under the buttons is there
    for the glass to bend.
  - **Taps**: `{tap: "tab:<id>"}` / `{tap: "button:<id>"}` click the look-alike, so tab switch, reselect (Search
    focuses its field: `FocusKeyboard` lets a focus from script show the keyboard), Back and each button's action run
    their own handlers.
  - **120 Hz**: the glass never moves while the page scrolls; the watcher skips mutations inside `.page-body` and
    `[data-scroller]` and the large title's per-frame opacity writes, and sends only when the snapshot changed.
  - **Fallback**: `unsupported` (below iOS 26) or `unknown method` (an older shell) keeps the CSS bars for good; other
    errors try again a second later.
- `web/app/nav/glass.test.js` (new): the hook's conditions, open payload, no resend when nothing changed, titles /
  badge / chosen tab updates, a push hides only the buttons, a popup and a covering sheet hide it, taps click the
  look-alikes, closing when the hook goes off, both refusals, the Swift handler's shape, and ios26.css's hook.
- ios26.css: the `data-glass` rules; its header and `nav/tabbar.js`'s comment now say the app on iOS 26+ lays glass
  over the CSS bars.

## Checked in Chromium

A harness (headless Chromium, 393x852 @3x, the app's fake bridge recording `ui.glass`, `app.info` iOS 27,
`ifizbox.style` ios26) on the real layout, light and dark: Home opens the glass with the pill (14, 776, 293x64), the
circle (314, 777, 64x62), five tabs with their glyph PNGs drawn and sent, About / Reload; a `{tap: "tab:sources"}`
switched to Sources and the buttons became Refresh / Add / Manage; a push hid the buttons (`buttonsHidden`, the CSS
ones shown) and kept the tab bar; at rest Back came; a `{tap}` on Back popped to Home. No page errors. With `app.info`
iOS 15.8.8 (the iPhone 7's case) nothing is sent, `data-glass` never set, the CSS tab bar stays at opacity 1.
`tools/smoke/smoke.mjs` passes.

## Checked on the iPhone 15 Pro (iOS 27.0.1)

The Lite IPA from this branch, installed with `tools/ui-15.sh` under its lock; `ifizbox.style` set to ios26 through
`pymobiledevice3 webinspector cdp` and the page reloaded, so the real hook (F345a) turned on from `app.info`. Shots
(gitignored, iOS's status bar): `ref/15/screens/f367-{home,sources,app}-{light,dark}.png`, `f367-changes-light.png`,
`f367-sheet-dark.png`. Afterwards the style and Mode were put back to iOS 6 / Light.

- **Real glass**: the pill, the Search circle and every bar button are UIKit's Liquid Glass. With content under them
  (Home scrolled, the iFizBox app page scrolled to "More Information" under the pill) the glass bends it at its edges
  and frosts it inside, in light and dark.
- **Real taps on the glass** (WDA touches, not script): Sources on the pill switched tabs, Back popped the app page,
  Changes switched tabs. Titles and buttons followed each page: About / Reload, Refresh / Add / Manage, Refresh /
  Upgrade (9), "‹ Changes" / Modify; the Changes badge (9) and the chosen tab's capsule are drawn.
- **120 Hz**: two finger scrolls of 700 px on the app page with `ui.glass` calls counted: 0.
- **A sheet** (`showSheet`) over the bars: the glass hid at once (no glass over the sheet); closed, it came back.
- **Fixed after the first look**: the glass container's spacing (12) drew a liquid bridge between the pill and the
  circle (iOS keeps them apart): 0 now. The back button's insets were wider than the CSS button's and cut "Changes"
  to "Chan…": tightened, it fits.
- iOS's own "You have changed the icon" alert (F323's theme-following icon) came up on the switch to Dark and took
  the first tap; dismissed, the dark shots were taken again.

## Decisions

- **The nav bar's title stays the page's.** iOS 26's title is plain text, not glass, and the large title's fade into
  it is written each frame of a scroll (nav/navbar.js); a native title would need that per frame over the bridge,
  which the brief rules out. "Titles follow each page" holds: the title is the page's own, the buttons follow each page
  over `ui.glass`.
- **The CSS look-alikes stay underneath**, as F345d's scope bar: a push or sheet shows the look-alike sliding, never an
  empty strip, and the glass takes over at rest.
- **iOS 15-25, iOS 6/7/13 and the site**: no `data-controls="native"`, so nothing is loaded or sent; the iPhone 7
  (iOS 15) never gets the hook.

## Tried and failed

- The first phone install failed: the copy of the IPA to the scratchpad was chained behind the phone lock, which
  P301b held; installed from `native/build` (the gate's build of the same commit) once the lock came free.
- The startup module budget (`module-graph.test.js`, under 117) failed with a static import of `nav/glass.js` from
  `nav/tabbar.js`: it is a dynamic import now, only where the bridge takes calls.

## Not verified

- **The iPhone 7 on the device.** Not run there: on iOS 15 the native controls hook is never on (F345a, node tests),
  so `nav/glass.js` isn't even loaded, and the Swift answers `unsupported` below iOS 26. Checked in Chromium with
  `app.info` iOS 15.8.8 (nothing sent, the CSS bars as before); AGENTS.md's "phone only when Chromium can't check".
- **The edge swipe by finger on the 15 Pro**: the buttons hide on `.is-moving` (set for the swipe too, app.js
  `setMoving`); covered in Node and Chromium (push), not swiped by finger.
- **Frame-accurate hand-over** at a push's start and end (glass off, CSS on): shots are too slow; no screen recording.
- **Interactive glass feel** (the press glow and stretch of `isInteractive`) was not filmed, only tapped.
- **iOS 26.0-26.x**: the only iOS 26+ phone here runs iOS 27.
- **Rotation / iPad**: the iPhone app is portrait only; the `resize` listener re-sends rects, not tried.
- **Icon-only bar buttons** (Share, the app page's Installed / queue toggles): the glyph path is the same as the
  tabs' (`::before` mask drawn to PNG) and ran for the tabs; no page with one was opened on the phone.
