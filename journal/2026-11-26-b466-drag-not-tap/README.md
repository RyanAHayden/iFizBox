# B466: a drag that scrolled a list could open a row

A scroll that starts and ends on a tappable item (row, cell or button) opened that item as if it had been tapped. iOS does not do that: a drag is never a tap.

## What changed

- `web/app/nav/tapguard.js`: new export `cancelDragTaps(doc, { onDrag })`, next to the B48 tap guard. It follows each touch or pen pointer (the mouse is ignored). A touch counts as a drag when:
  - it moves more than 10 px (`pointermove` or `touchmove`);
  - a pane holding its target scrolls while it is down;
  - it is cancelled;
  - it goes down within 100 ms of a scroll of a pane holding its target (the list is still gliding, and the touch only stops it).

  A click that ends a drag is eaten at the window capture phase, before any handler runs. This holds for every list and control.
- The switch, the banner and form fields are exempt. They follow the finger themselves and settle on the click that ends their own drag.
- Scrolls of an unrelated pane (a carousel elsewhere) do not count. Clicks with `detail` 0 (keyboard, `el.click()`) always run.
- `web/app/app.js`: creates the guard once with `onDrag` set to `dropPress`, so the pressed look goes at once when a drag starts. The press handler does not add `.is-pressed` while a drag is in progress, so a touch that only stops a glide shows no pressed look.
- `web/app/scroll-tap.test.js`: new node test for the cases above, plus the `app.js` wiring.

The code first went in a new module, `nav/scrolltap.js`. That took the static import closure of `app.js` to 120 modules, and `web/app/module-graph.test.js` (cap: under 120) failed. `tapguard.js` is already in that closure, so the code moved there.

## How it was checked

- `node --test web/app` passes in full, including the new `scroll-tap.test.js`.
- Chromium probe, [probe.mjs](probe.mjs), built from the B465 probe and the `tools/smoke` setup. Run it with `node journal/2026-11-26-b466-drag-not-tap/probe.mjs web/app`. It loads Settings with its row groups cloned 12 times so the list scrolls, and sends CDP touch events with touch emulation on.
  - Case 1: drag a row up 120 px and back, then lift on the same row. The list scrolled (22 scroll events), the pressed look was gone mid-drag, and nothing opened.
  - Case 2: fling, then tap a row while `scrollTop` is still moving (344 to 388). No pressed look, nothing opened.
  - Case 4: a 14 px sideways drag on a row, then lift on the row. That is past our 10 px but inside Chromium's own tap slop; rows are `pan-y`, so nothing scrolls. Nothing opened.
  - Case 3: a plain tap shows the pressed look and opens Console Logs.
  - All four pass with the fix.

## What failed

- The same probe against `main`'s `web/app` (from `git archive`): cases 1 and 2 already passed there. Chromium drops the click itself after a scroll gesture, or after a tap that stops a fling, so it cannot reproduce the iOS long-drag case.
- Case 4 failed on `main`: the row opened, so a click reached the handler. That is the bug, reproduced in Chromium. It passes with the fix.

## Not verified

- On a real iPhone (15 Pro or iPhone 7). The iOS-only case, WebKit sending a click after a drag that scrolled and came back, or after a tap that stopped momentum, was not reproduced on a device. The fix's logic is covered by the node test and by the Chromium short-drag case. The project rule is that web checks stay in Chromium and real-device checks are only used when Chromium cannot do the job. This one would need the phone, so it is left for normal use or a later phone pass.
- The iOS 26 style's native `UITabBar` (not web, untouched by this change).
- Controls with their own drag other than the switch and the banner (section index, settings reorder grip, roulette wheel, app icon stage) use `pointerup`, not `click`, so they are unaffected. They were not exercised in Chromium.
