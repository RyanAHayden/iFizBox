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

## Decisions

- **The nav bar's title stays the page's.** iOS 26's title is plain text, not glass, and the large title's fade into
  it is written each frame of a scroll (nav/navbar.js); a native title would need that per frame over the bridge,
  which the brief rules out. "Titles follow each page" holds: the title is the page's own, the buttons follow each page
  over `ui.glass`.
- **The CSS look-alikes stay underneath**, as F345d's scope bar: a push or sheet shows the look-alike sliding, never an
  empty strip, and the glass takes over at rest.
- **iOS 15-25, iOS 6/7/13 and the site**: no `data-controls="native"`, so nothing is loaded or sent; the iPhone 7
  (iOS 15) never gets the hook.
