# B471: taps just outside Home's About and tiles opened without the pressed look

## What was wrong
On 1.0.3 (after B465 and B467), Home's About bar button and its tiles opened when tapped, but on part of their tap
area the pressed look didn't show.

Cause: iOS's WebKit retargets a tap that lands on nothing clickable to a clickable element nearby. WebCore's
`LocalFrame::qualifyingNodeAtViewportLocation` (read from WebKit's main branch on GitHub) searches with a 15 pt radius
scaled by screen PPI and page zoom. The document itself has click listeners (app.js), so the element under the finger
"qualifies" as the document, and WebKit then tries diagonal steps of 15 px times (-0.3,-0.3), (-0.6,-0.6), (+0.3,+0.3),
(-0.9,-0.9), truncated to 4 px up-left, 9 px up-left, 4 px down-right and 13 px up-left. It clicks the first clickable
element it hits. So a tile or About opens from its grouped table's 1 px edge, from the 10 px gap below a tile, and from
the nav bar around About (up to 13 px below or right, 4 px above or left).

app.js marked only `e.target.closest(PRESSABLE)`, so those taps opened without the pressed look. It was not a guard
and not a press that was too short.

## What I did
- `web/app/nav/tapguard.js`: `reachedControl(doc, x, y, sel)`, with `REACH`, `REACH_STEPS` and `CLICKABLE`, mirrors
  WebKit's steps. A clickable thing under a step (field, switch, plain link or button) ends the search, as in WebKit.
  It lives in tapguard.js, which is already in the startup closure, so module-graph's cap doesn't move.
- `web/app/app.js`:
  - pointerdown marks `pressedBy(e)`: `closest(PRESSABLE)`, or for touch and pen (not mouse) `reachedControl`.
  - pointermove keeps the press while the finger stays within reach.
  - A new document click listener takes a trusted, real click (`detail > 0`) on a PRESSABLE that wasn't marked. It
    gives that control the 140 ms quick-tap pressed look and counts it as `lastPress` (F163 keepSelected). This is a
    safety net for the cases where WebKit's pick and ours differ.
- `web/app/press-hitbox.test.js`: the test helper's selector matcher now reads `[attr]` selectors. New tests cover
  WebKit's constants, a tile's edge and corners, the gap below a tile, the nav bar beside About, a clickable that
  ends the search, and app.js's wiring.

## How it was checked
- Chromium with `probe.mjs`: `node journal/2026-11-26-b471-press-hit-area/probe.mjs [web/app dir] [--touch]`.
  Home as the jailbreak app with the fake bridge, eras ios6, ios7, ios13 and ios26, 390x844.
- For every pixel of About and each of the 6 Home tiles, plus 15 px around each, the probe compares the control WebKit
  would click (its own copy of WebKit's steps) with what app.js marks for a touch pointerdown there.
  - Before (main): all 28 controls differ. Examples: iOS 6 About opens at 2960 px, of which 1331 are unmarked; the Why
    iFizBox? tile has 5622 unmarked of 26942 px; Install IPAs has 5045 of 20845. The same happens in every era.
  - After: 0 unmarked, 0 marked but opening another control, in all eras.
- With `--touch`, real CDP held touches at each control's corners, edge midpoints, 3 px below and 3 px right. All were
  pressed except 2 px in from a rounded corner on iOS 13 and 26 (and About on iOS 26). Those points lie outside the
  rounded shape, and WebKit doesn't open them either; the grid check agrees.

## What failed or was tried
- The first probe run had every era as iOS 6. `Page.navigate` to the same URL with only a hash change doesn't reload,
  so the probe now passes the era as a `?era=` query.
- A first probe server crashed: it called `writeHead` before an awaited `readFile`. Fixed by reading the file first
  and answering 404 in the catch.

## Not verified
- On a real iPhone (the iPhone 15 Pro or 7). The WebKit model was read from current WebKit source, not measured on a
  device, and iOS 15's WebKit on the iPhone 7 may differ in detail.
- Chromium's own touch adjustment is not WebKit's, so the probe compares against a written model, not real clicks.
- The click-time safety net (the flash on an unmarked control that opens) is checked only by a source test, not by a
  real tap. In Chromium every click has a marking pointerdown, so the net never fires there.
- Other screens' rows and buttons get the same reach through the shared press code, but I did not probe them one by one.
- Per the AGENTS.md rule, phone checks are only for what Chromium can't check. The one thing a phone would add is how
  closely iOS's real tap retargeting matches the model here.
