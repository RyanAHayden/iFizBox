# F373 Swipe back from anywhere on the page

## What changed

- `web/app/nav/swipe.js`: `attachPageSwipe` (the page swipe), `pageSwipeDecide` (the decide-to-start rule) and
  `pageSwipeBlocked` (where it steps aside). The edge strip's `attachEdgeSwipe` is untouched.
- `web/app/app.js`: the edge swipe's canStart/begin/move/end became one `backSwipe` object; the edge strip and the page
  swipe both use it, so the page swipe runs the same `swipeCommits`, the same slide and the same B148 refresh. The page
  swipe's `begin` also takes the blue off the row the drag started on (UIKit cancels a cell's highlight when the pop
  starts). `blocked` adds popups (`nav/popups.js popupOpen`) and the pairing page's running step
  (`screens/installroute.js pendingStep`, already in the startup closure through settings.js).
- `web/app/style.css`: only the comment on `.page-body`'s `touch-action: pan-y`.
- `docs/native.md`: a line on the page swipe. GLOSSARY: "Swipe Back".

## Decisions

- **Touch events, passive, not pointer events.** The page body is `touch-action: pan-y`, so a sideways drag on plain
  content would keep its pointer stream; but in a gallery (`.dep-shots` is `pan-x pan-y`) the browser takes the drag
  for its own pan and ends the pointer stream with pointercancel, even at the gallery's start. Touch events keep coming
  after the browser starts a pan (Chromium and iOS WebKit), so "swipes back once the gallery is at its start" works.
  Passive listeners mean no scroll ever waits on us; nothing changes `touch-action`.
- **Opt-outs are checked once, at touchstart** (walking from the target up to `#screens`): PAGE_SWIPE_SKIP selectors
  (text inputs, range, select, contenteditable, `.switch`, `.roulette-wheel`, `.section-index`, Settings' theme
  split `.theme-preview-grip/.theme-preview-top`, `.crop-stage`, `.shot-zoom`, `.edge-swipe`, dialogs), any element
  with computed `touch-action: none` (catches custom drags generally), an `overflow-x: auto|scroll` element that
  overflows and has `scrollLeft > 0`, a list with `:scope > .armed` (a row showing Delete), and a non-empty selection.
  A touchmove some handler `preventDefault`ed also stops it. A second finger (pinch) cancels a swipe under way.
- **Row swipe actions**: sources.js, installed.js (apps and wish list), myipas.js and signed-apps.js open Delete with a
  left swipe and close it with a right swipe (≥30 px). With a row armed, the page swipe steps aside in that list, so
  the right swipe only closes it. With nothing armed, a right swipe goes back; their handler's `arm(li, false)` at
  30 px is a no-op then. nav/rowswipe.js (F193 queue swipe) is left-only and already leaves rightward drags alone
  ("none"). appicon.js's cell Delete is left-only (rowswipe's swipeDecide) and its crop stage is `touch-action: none`.
- **installroute.js's guard**: it holds the edge strip and asks "Stop Setting Up?". The page swipe does the same
  without touching installroute.js (another task's file): `held: pendingStep`, and once the drag is a swipe
  `onHeld` asks with installroute's own `askLeave` and Leave goes Back. Nothing is dragged while it asks. (First
  version just stepped aside there; the spec review called that out as not "the same", so it now asks.)
- **Web build**: unchanged. `canStart` keeps `!webBack`, so the page swipe is off on the website with the edge strip.

## Checks

- `node --test web/app/nav/pageswipe.test.js` (new): the decide rule (slop, direction, 45° is a scroll), every opt-out,
  passive listeners, a pinch, touchcancel/blur. Also swipe.test.js, module-graph.test.js, installroute-leave.test.js.
- Chromium, `node journal/2026-11-22-f373-page-swipe-back/probe.mjs web/app` (from tools/smoke/smoke.mjs; fake bridge
  answering `apt.sources` with two sources; CDP touch events). Passes 3 runs out of 3; against main's web/app (a
  scratch worktree) it fails the 7 swipe-back checks, so it tests the change:
  - a rightward drag from x=170 on a pushed Settings page pops, with the slide;
  - a vertical drag scrolls the page (scrollTop ~520) and starts no swipe;
  - a right drag on an overflow-x gallery at scrollLeft 500 scrolls it (-> 318) and doesn't pop; at 0 it pops;
  - Sources rows: a left swipe shows Delete and a right swipe puts it away, on the tab root and with the real list
    moved into a pushed page (no pop while closing); with no Delete showing a right swipe on a row pops, and no row
    is left blue;
  - a real Details page (Installed > a package from a fake `dpkgStatus()`): a mid-page drag pops, with the slide;
  - `--site`: a mid-page drag does nothing.
- `node tools/smoke/smoke.mjs` and `--site`: pass (edge swipe still pops).

## Tried and failed

- The probe's first version picked `.page.is-top` (the Home tab's hidden top page came first in the DOM) and moved the
  Sources list into it; scoping to `.tab-stack.is-active > .page.is-top` fixed it.
- A drag that ended short of half the width failed now and then in headless Chromium (the last 80 ms of samples lost
  their speed under load); the probe drags past half now. The app's commit rule is unchanged.

## Spec review

- Fixed: the pairing page's running step now asks "Stop Setting Up?" from a page swipe, as from the edge strip; the
  probe now checks a real Details page; the probe's header describes the probe (it was smoke.mjs's).
- Kept, though not named in the brief: taking the blue off the pressed row when the page swipe begins (without it the
  row the drag starts on stays highlighted through the whole slide: a bug the page swipe would bring), the
  blur/visibilitychange cancel (the edge swipe's own fix for iOS taking the touch away), GLOSSARY "Swipe Back" (the
  run's rule) and the docs/native.md line (docs follow the current state).

## Not verified

- **The 120 Hz feel and iOS WebKit's touch stream on the iPhone 7.** Chromium can't show the device's frame rate or how
  iOS WebKit delivers touchmoves during its own pans. Not taken to the phone: the page swipe drives the same
  per-frame path as the edge swipe (one `setProgress` per rAF), which already holds 120 Hz there (docs/native.md);
  the only new work is one ancestor walk with getComputedStyle at touchstart. A .deb build and install also races
  the other slots' installs on the 7. Worth a look on the next phone pass: a gallery at its start may rubber-band
  while the page slides (iOS draws the bounce; Chromium doesn't).
- **The pairing-page ask in the browser**: unit-tested (held/onHeld) only; reaching a running pairing step needs the
  native idevice calls.
- **Zoomable views other than `.shot-zoom`**: a pinch is caught by the second finger (it cancels a swipe under way)
  and custom zoom areas by `touch-action: none` (the icon crop); a zoom view with neither isn't. None exists today.
- **The real Preview galleries / featured strips / Sileo tab views**: checked with an injected overflow-x gallery with
  `.dep-shots`' touch-action and overscroll, not the real ones (they need data).
- **installed.js, myipas.js, signed-apps.js rows** in the browser: only sources.js rows were driven; the other three
  share the same arm-on-swipe pattern and `.armed` class (read, and covered by the unit rule).
