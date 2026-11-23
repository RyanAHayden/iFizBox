# B356: Sources, Install IPAs and the Wish List delete with the full-row swipe

## What changed

B332 gave Installed's apps list a full-row swipe (nav/rowswipe.js `full` option, `fullSwipeEra`). The other three
delete-by-swipe lists now use the same helper, no copy:

- `screens/sources.js` `attachDeleteSwipe`: on `.source-row` (tweak sources too), not the built-in source, not while
  editing or while a red Delete shows. Commit is the old `remove()`, which now answers `false` when the backend
  refuses (its alert shows, the row springs back) and `true` once the source is gone (the row collapses as before).
- `screens/myipas.js` `attachDeleteSwipe` (Install IPAs' rows): commit is `on.delete` (the page's `swipeDelete`, no
  sheet, as the red button's); a file in `failed` springs the row back. The SIGN/INSTALL price button sits outside
  the row's content, so it fades out while the row swipes (`myipas.css`), rather than staying over the red strip.
- `screens/installed.js` `attachWishSwipe` (the Wish List lives here, not in browse.js): commit is `removeWish`. The
  rows are pooled (vlist), so `decorateWish` resets the swipe on a recycled row.
- In all three, the old swipe-then-red-Delete starts only outside `fullSwipeEra` (iOS 6). Edit mode's red minus and
  red Delete button are unchanged in every era.
- `sources.css`: `.source-row.swiping` shows packages.css's `.row-swipe` strip and lifts the content over it, with
  the table's ground (`--table` grouped, `--plain` plain) so the strip doesn't show through. Wish rows are
  `.pkg-row`s, already covered by packages.css.

## Checked

Chromium, `probe.mjs` here (from B332's): jailbreak app with a fake shell for Sources (one source in apt's own
`test.list`, which the backend refuses to remove, one in `ifizbox.sources`, removed through a fake helper) and the
Wish List (three wished packages); the website for Install IPAs (two IPA links). CDP touch events, 390x844 @2x.

- iOS 7 light/dark, 13 light/dark, 26 light/dark (each list in at least two of these): a short swipe springs back
  and keeps the row; a long swipe slides the row off red with the white minus and the row goes (localStorage /
  the source list confirm it); a refused source removal shows its Error alert and the row comes back at rest.
- iOS 6 (light, and dark for Install IPAs): the same swipes show the red Delete button and remove nothing.
- Shots: inset grouped tables (13/26) clip the strip to their rounded corners; the price button is hidden mid-swipe.
- `node --test`: `screens/b356-full-swipe.test.js` (Install IPAs per era through `libraryGroup`, iOS 6, managing,
  short swipe; Sources' and the Wish List's wiring by source text), `b136-swipe.test.js` (B315 still passes: the fake
  DOM has no era, so it is iOS 6's path), `installed.test.js`, `nav/rowswipe.test.js`, then the whole web/app suite.

Retake: `node probe.mjs ../../web/app <outdir> ios13 dark sources|wish|myipas`.

## Tried and dropped

- Moving the price button with the content: rowswipe.js only transforms `.cell-inner`; fading the button is the
  smaller change and matches what the row does when armed or managing.

## Not verified

- A real phone: web-only change, checked in Chromium (AGENTS.md: phone only when Chromium can't check). The gesture
  code is B332's, already used on Installed.
- Sources and the Wish List have no DOM-level unit test of the drag (their screens need the backend and catalog);
  their wiring is checked by source text and the drag by the Chromium probe.
- Install IPAs in the jailbreak / sideload app (native library calls): checked on the website only; the swipe's commit
  is the same `swipeDelete` the red button already calls in every mode.
- Removing the last source (the page draws its empty note): not driven in the probe; `remove()`'s path for it is
  unchanged.
