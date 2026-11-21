# F354: native bars follow the iOS 26 era in the app

## Finding

The task's premise doesn't hold in the current code. The app's shell draws no UINavigationBar or UITabBar
(`native/Sources/Bridge.swift`, the R3 (a) choice: one WKWebView, the web bars). `html.native`, the class whose
style.css rule hides the web nav and tab bars, is never set: no Swift, `native/bridge.js` or `web/app` code adds it
(searched for `classList.add/toggle("native")`, `className`, `setAttribute("class", …)`). The app does set
`data-shell="app"`, which is something else (the nav bar's top and the strip).

So the app already shows web/app's bars in every era, and under Theme > Style iOS 26 it shows the floating glass tab
bar with its Search circle (`data-tabbar="float"`, set by theme-boot.js and nav/tabbar.js, which never look at the
shell) and the capsule bar buttons. The spec review of F203 was misled by three stale comments (ios26.css, nav/tabbar.js,
style.css) that said the app draws native bars and hides the web ones.

Other app-only differences for iOS 26, checked in the code:
- The nav bar's top: in the app iOS 26 takes iOS 6's `--status-bar-bottom` (style.css only exempts iOS 7 and iOS 13).
  iOS 26's strip is `--site-strip`, the page's ground (#f2f2f7 / #000), so the strip and the bar read as one ground.
  On the iPhone 15 Pro and notch phones the value is the safe area anyway. Left as is; App.swift's comment now says so.
- Status-bar text: iOS 26 White is palette `white`, in `DARK_TEXT_BARS`, so the shell's status bar goes dark there.
- Glass: ios26.css carries `-webkit-backdrop-filter` beside `backdrop-filter`, so WKWebView on iOS 15+ blurs.

## What changed

- `native/test_web_bars.py` (new, in the gate): fails if the shell makes, subclasses or styles a UINavigationBar /
  UITabBar (Controller), or if anything gives `<html>` the `native` class. Either would take iOS 26's bars (all the
  web bars) out of the app.
- Comments corrected: Bridge.swift, App.swift (TopInset is iOS 6's and iOS 26's), ios26.css header, nav/tabbar.js,
  style.css and packages.css (the dead `html.native` rules, left in place). The web comments are outside the task's
  `native/Sources/**`, but they are what produced this task, so they're fixed here (comments only, no rule changed).

## Tried and failed

Nothing.

## Not verified

- No look at the iOS 26 era in the running app on a phone (iPhone 15 Pro Lite or iPhone 7 .deb). The code shows
  nothing app-specific removes or replaces those bars, and the same web bars draw in the app's other eras, so I
  didn't take a phone lock for a screenshot; switching Theme > Style by WDA taps unattended is also slow and fragile.
  The glass's 120 Hz cost on the iPhone 7 is F203's check, not this task's.
