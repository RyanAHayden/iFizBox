# F345d: the pinned scope bar as a native UISegmentedControl (ui.segments)

Plan: `journal/2026-11-21-f345-ios26-native-controls/README.md` ("Segmented controls that stay put").

## What I did

- `native/Sources/NativeSegments.swift` (new): bridge call `ui.segments`, one method with an `op`:
  - `open {key, items, selected, rect, hidden}`: a `UISegmentedControl` added to the web view at `rect` (CSS px are
    the web view's points, as for `ui.menu`). The call streams `{ready: true}` once the control is in place and
    `{pick: i}` on each tap of another segment (`.valueChanged`), and settles only when the bar is closed, so its
    stream lives as long as the control.
  - `update {key, items?, selected?, rect?, hidden?}`; `close {key}` (removes the control and settles the open call).
    Opening a key that is already open replaces it.
- `Bridge.swift`: registers it.
- `web/app/nav/ui.js` `segments()`: in the app (the bridge takes calls) every scope bar is marked
  `data-native-segments` and one watcher keeps the shell's bars in step with the page, once per frame at most:
  - **Which bars**: only under `<html data-controls="native">`, and only a bar inside `.search-root` but not in its
    `.search-results` scroller (`nav/searchbar.js` `pinned`). Browse's bar and any other bar in a scroller stay CSS.
  - **What it sends** (`segmentsSnapshot`): the shown segments' labels (`seg.show()` hides some on Search), the
    selected one's index among them, the bar's rect (minus the visual viewport's offset) and `hidden`.
  - **Hidden** while: a popup is up (the `nav/popups.js` selector, inline), a slide runs (a running, finite Web
    Animation on `transform`, which is how `nav/transition.js` and the sheets move; or an inline `transform` on the
    bar or its page, which is the edge swipe), or something of the page's own covers the bar (hit tests at its middle
    and both ends land outside it: a pushed page, a sheet). A tab switch hides it (its box is empty).
    While hidden, a new place alone sends nothing.
  - **Closed** when its element leaves the page or the hook goes off; reopened if it comes back.
  - **The CSS bar stays underneath**: it goes see-through (`opacity: 0`) only once the shell says the native one is
    there (`ready`, or the update's answer), and is back at once whenever the native one hides. So a push or sheet
    shows the CSS look-alike sliding, never an empty strip.
  - **A tap** on the native control maps the index back to the shown segment and runs the same path as a click:
    `select(value)` and the page's `onPick`, nothing when it was already selected. `seg.select()` / `seg.show()` from
    code update the native bar.
  - **Fallback**: an `open` that is refused (a shell without `ui.segments`, no window) marks the bar failed and it
    stays the CSS bar for good; the site and every other style never send anything.
  - **When it re-checks**: a MutationObserver on the body (nodes, `class`/`hidden`/`style`/`role`/`aria-modal`;
    records inside a `[data-scroller]` are skipped, so a list's rows coming and going as it scrolls cost nothing),
    the `data-controls` attribute, `resize`, and the visual viewport's `resize`/`scroll` (the keyboard). After a
    slide it re-checks when the animations finish.
- `web/app/nav/segments-native.test.js`: open (items, selection, rect, see-through on ready), select/show updates,
  native picks mapped to the shown segment and onPick, hidden for a popup / a covering page / a slide / the edge
  swipe (not for an infinite spinner), no update for a move while hidden, close on leave and hook off and reopen,
  only pinned bars, none on the site, the old-shell fallback, and the Swift handler's shape.
- `docs/eras.md` "Native controls": a row for the scope bar. `GLOSSARY.md`: "Scope bar".

## Checked in Chromium

`tools/smoke/smoke.mjs`'s setup with a recording fake bridge (`app.info` says iOS 27, `ifizbox.style` = ios26):
Search opens a native bar (hidden during the tab's slide in, shown at rest), a fake pick selects Tweaks and calls
onPick, a `role=dialog` over it hides it and it comes back, a push (`#/search/package/bash`) hides it from its first
frame and it stays hidden under the pushed page, Back shows it again at rest. No page errors. `smoke.mjs` itself
passes (no layout property animated).

## Checked on the iPhone 15 Pro (iOS 27)

The Lite IPA from this branch, installed with `tools/ui-15.sh` under its lock; `ifizbox.style` set to ios26 in the
app's localStorage and the page reloaded, so the real hook (F345a) set `data-controls="native"` from `app.info`.
`ifizboxNative.call` wrapped over `pymobiledevice3 webinspector cdp` to log `ui.*` calls with times. Shots in the
worktree's `ref/15/screens/f345d-*.png` (gitignored: iOS's status bar). Afterwards the style was set back to ios6.

- **Search** (`f345d-search.png`): the native UISegmentedControl (All | Apps; Tweaks/Themes are hidden in the
  sideload build) sits exactly on the CSS bar's rect (5, 206, 324.5x30), beside the CSS Filter button. The CSS bar
  under it is `opacity: 0`.
- **A tap on the native Apps** (`f345d-apps.png`): `{pick: 1}` arrived, the page's segment went selected (onPick ran:
  Search re-filtered), and the update back to the shell carried `selected: 1`.
- **Filter's inline panel**: not a sheet, the bar stays; it hid for the panel's 0.3 s slide and came back.
- **A CSS sheet** (`showSheet` from script, `f345d-css-sheet-mid.png`): hidden 5 ms after the sheet opened; no native
  bar over the sheet. Closed: shown again once the sheet had left (one update).
- **The keyboard** (`f345d-keyboard.png`, typing "music"): nothing moved and nothing was sent; the bar stays aligned
  (the page's layout viewport doesn't scroll in the app).
- **A native action sheet** (tapping a Canister result, `f345d-pushed.png` before the push): UIKit's popover is
  presented above the native bar, as expected for a presented controller.
- **A push** (View Repo): the first update after the action sheet's answer, 19 ms later, already had the page moving
  (x -2) and `hidden: true`; it stayed hidden under the pushed page. **Back**: hidden through the pop, shown 360 ms
  later once the slide ended.
- **A tab switch** (Home): hidden.

### Lag and placement

- **Placement**: none off: the native control lands on the CSS bar's rect to the half point.
- **Lag on hide**: the hide goes out on the first frame the page moves (the first mutation), then crosses the bridge;
  a frame or two (the 19 ms above includes the action sheet's own answer) where the native bar may sit still while
  the page starts to slide. Not visible in the shots (too slow to catch it); not filmed.
- **On show** the native bar appears once the slide has fully ended and the shell answered, so for a moment after a
  pop the CSS bar shows, then the native one takes over in place: the two look nearly the same (ios26.css's capsule).

## Tried and failed

- My first Chromium run showed no calls at all: the app put the style back to iOS 6 (nothing saved), so the hook was
  off. Setting `ifizbox.style` before load and answering `app.info` with an iOS version fixed the harness.
- Two Node test bugs of mine (a slide set before the "back from the push" check; a bar left open by the previous test
  closing first): fixed in the test.

## Not verified

- **Rotation**: the iPhone app is portrait only (`Info.plist` `UISupportedInterfaceOrientations`), so it can't
  rotate on the 15 Pro. The `resize` listener moves the bar after an iPad rotation or Split View resize; no iPad here.
- **Dark mode on the phone**: not shot. The control follows the window's interface style, which the shell sets from
  the page's theme (`Bridge.swift` Theme), as the native menus do.
- **The edge swipe on the phone**: covered in Node (an inline transform on the page hides it) and by the smoke run's
  swipe passing; not done by finger on the 15 Pro.
- **A shell without `ui.segments`** on a real phone: no older build installed; covered by the Node test.
- **Frame-accurate lag**: shots are too slow to catch one or two frames at a slide's start; no screen recording.
- **iOS 26.0–26.x**: the only iOS 26+ phone here runs iOS 27.
- **The jailbreak build on the iPhone 7**: iOS 15, where the hook is never on; the gate's native build compiles both.
