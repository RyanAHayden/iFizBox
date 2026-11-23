# F390 Swipe between Details, Reviews and Related

## What changed

- `web/app/nav/tabswipe.js` (new): `tabPager`, one segmented control's panes (the finger's drag, the slide, a tap's
  slide, `rubber`). Only transforms move; layout is read at a drag's start, when a neighbour comes in and on release.
- `web/app/nav/tabswipe.test.js` (new): 11 tests.
- `web/app/nav/swipe.js`: `attachTabSwipe` (the touch side, on the same passive stream as the page swipe),
  `tabSwipeDecide`, `tabSwipeTakesBack`, `tabPagers` (page body -> its pager) and `TAB_SWIPE_SKIP`.
  `attachPageSwipe` takes the decide/clamp/begin/move/end options that the tab swipe uses.
- `web/app/nav/slide.js`: `stillChange(node, change)`, so the slide watcher doesn't fade a pane that is only moved.
- `web/app/screens/storepage.js`: `storeTabs` runs its panes through `tabPager`; `swipeOn(body)` attaches the pager once
  the page's nodes are in place. `screens/altstore.js` and `screens/browse.js` call `swipeOn` for the same pages.
- `web/app/app.js`: `attachTabSwipe` on the screens (blocked by popups), `dropPress` (the row's blue goes at the swipe's
  start), and the page swipe refuses a touch whose rightward drag is the tabs' (`tabSwipeTakesBack`).
- `web/app/packages.css`: `.store-pane { display: flow-root }`, so a pane lifted out of the flow keeps its margins.
- `docs/native.md`: a "Tab swipe" bullet after the page swipe. GLOSSARY: "Tab Swipe". `release-notes/F390.md`: one line.

## Decisions

- **Pager split.** The touch side is in `swipe.js` and the panes in `tabswipe.js`: a new startup module pushed the startup
  module budget past its 118, so the touch side goes with the swipe code that is already at start (app.js), and the
  panes load with their pages.
- **The neighbour is absolute and clipped at the screen's bottom,** so it never lengthens the page. The chosen pane stays
  in the flow, so the page's height is always its own.
- **A shorter pane is shown where it will be.** Its scroll is set as it is chosen, and the header above slides from where it
  was (FLIP), so nothing jumps.
- **`.store-pane` is `display: flow-root`.** It adds no space, as `--seg-margin` has no bottom.
- **`stillChange`,** so the slide watcher doesn't fade panes (they only move).
- **A drag or tap takes a running slide over where it is.** A tap across two tabs slides the whole track, the pane between
  passing by (and filling), so an interruption never drops a pane that shows.
- **The tabs refuse a touch in the edge strip's 20 px** (`.edge-swipe`'s width, not attachEdgeSwipe's 24), so no band
  beside the strip does nothing.
- **Reduced motion** moves nothing under the finger; the tab switches on release.
- **Rightward on Details is swipe back's, not the tabs',** so the page swipe still does its job there. On the website a
  rightward swipe on Details still does nothing (the page swipe is off there).

## Tried and failed

- The website refuses APT sources, so package pages were probed in the fake-bridge app; app pages were probed on the site.

## Checks

- `node --test web/app/nav/tabswipe.test.js`: 11 tests pass.
- The whole web/app suite (`node --test` over every `web/app` `*.test.js`): 3409 tests pass.
- `journal/2026-11-23-f390-tab-swipe/probe.mjs` passes for ios6, ios7, ios13, ios26, app and `--site`, and with `--reduced`.
- `node tools/smoke/smoke.mjs` passes.
- `shots/` has mid-drag shots for iOS 6, 13 and 26 (app and site: the drag to Reviews, the drag to Related, the Related end,
  and a drag on a scrolled page).

## Spec review

Fixed: a depiction's tabs block by their bar only, not their content; the dead 20-24 px band; a tap during a slide hid a
pane still showing, and a two-tab slide ended at once when touched; a test of storeTabs.swipeOn and its two callers.

## Not verified

- **iOS WebKit on a phone:** the frame rate, and setting `scrollTop` right after a drag. The task didn't take it to a phone
  unless WebKit behaves differently there.
- **Sideload mode in the browser:** same code path as the app, with the native bridge.
- **Safari's own edge gestures** on the website.
- **Dark themes and wide/iPad layouts:** not shot.
- **The real gallery:** an injected overflow-x gallery was used at both ends and mid-scroll, not the real one.
