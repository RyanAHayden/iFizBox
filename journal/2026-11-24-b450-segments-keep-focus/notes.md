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
  `WKWebView` itself, and nothing in `native/Sources` resigns first responder. The phone check (see Phone) confirms it.

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
- The 15 Pro (Lite, iOS 27) ran the Lite IPA with the change, on Search, 2026-11-25. Chromium has no keyboard and no
  native control, so this is the only check of both.
- iOS 26 style (WDA's tree shows a real `UISegmentedControl`):
  - Unfocused, a tap on Apps picks it and no keyboard comes up.
  - Field focused and empty, a tap on Apps: the keyboard stays.
  - Typed "a", tap All then Apps: the keyboard stays and the results change. Typing "b" then goes into the field
    ("ab").
  - So a tap leaves the web view first responder. `NativeSegments.swift` needed no change.
- iOS 6 style (CSS bar): same results. Its unfocused tap ran with the Filter panel open, because a stray tap of the test
  had opened it. No keyboard came up.
- The style was set back to iOS 26, and the phone was unlocked via `ui-15.sh`.
- The old build's behaviour was not re-tried on the phone.

## Not verified

- Installed's scope bar in Chromium: its list never drew with the fake bridge. It runs the same `segments()` code.
- Changes' and Installed's scope bars on the phone: same code, not tried.
- The iOS 7 and iOS 13 styles on the phone: not tried.

## Gate

- The first two `done` runs failed on `web/app/core/blocked.test.js`: its fixed date fell out of Changes' 7-day window
  when the day rolled over to 2026-11-25. Main already had the fix; the same edit is made here so this branch's gate
  passes and the hunks merge.
