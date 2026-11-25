# B450: a tap on a scope bar segment keeps the search field's focus

## Code

- `segments()` in `web/app/nav/ui.js` prevents `pointerdown` and `mousedown` on each segment button, so a tap moves no
  focus. The `click` still picks.
- This applies to every Scope bar: Search, Changes, Installed, Browse. Installed's nav-bar User | Expert | Recent is the
  same `segments()` control.
- Aria, keyboard use and the Filter button code are unchanged.
- Test: `web/app/nav/ui-segments-focus.test.js`. It passes with the existing segments tests.
- Release note: `release-notes/B450.md`.
- `native/Sources/NativeSegments.swift` is not changed. By reading, a `UISegmentedControl` is a subview of the
  `WKWebView` itself, and nothing in `native/Sources` resigns first responder. Not proven until the phone check.

## Chromium

- Scratch script derived from `tools/smoke/smoke.mjs`, fake bridge, real CDP touch and mouse events.
- Search and Changes: focus kept with the text `""` and with `"a"`. Picks land. An unfocused field gains no focus. Enter
  on a focused segment picks. All pass.
- The same script on main: 16 focus checks fail.
- Failed try: the first Installed failures were an artefact. The script picked a hidden page's field. Fixed with a hit
  test.
- Browse's scope bar has no search field above it, so there is nothing to keep focus.

## Phone

- The 15 Pro was held by B443, then by B445 when tried.
- The Lite IPA is built: `native/build/iFizBox.ipa`, with the change.

## Not verified

- The keyboard on the 15 Pro (Lite): the iOS 26 style with its native control, and the iOS 6 style. Pending; the phone
  is busy.
- Installed's scope bar in Chromium: its list never drew with the fake bridge. It runs the same `segments()` code.
