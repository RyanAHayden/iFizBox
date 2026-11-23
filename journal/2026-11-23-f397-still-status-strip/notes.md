# F397: the iOS 6 status-bar strip stays still while sheets slide under it

## Request

User wants, in the iOS 6 era only:
- a fixed black status-bar strip;
- every sheet (install log, Add Tweaks, Confirm) sliding up and down under it;
- no strip on the sheet itself;
- no bar gradient under the status bar.

## Fix (web/app/packages.css, web/app/queue.css)

- packages.css, era-scoped (`html:not([data-style="ios7"]):not([data-style="ios13"]):not([data-style="ios26"])`):
  `.sheet { clip-path: inset(var(--sheet-bar-top) 0 0 0) }`, and the sheet's bar `::before` is `display: none`.
- The strip seen is the page's own `.navbar::before` (`--site-strip`, #000), which does not move.
- The clip moves with the sheet's transform, so the clipped top edge is always the sheet's own top edge.
- Chosen over shortening the sheet (`--sheet-top`): the bar backgrounds position their layers from `--top-inset`
  (highlight, wood-theme stitch), and the `--nav-h` paddings inside sheets would all need changing. A clip leaves the
  layout identical.
- queue.css: B379's console rules removed. The general rule covers the console too; the console used to carry its
  strip up with it.
- nav/sheet.js, nav/statusbar.js and ios6.css needed no change.

## Test

- `web/app/sheet-bar-strip.test.js`: B379's two console tests replaced by two F397 tests. B349's tests are kept for
  iOS 7, 13 and 26.
- A shell slip (a stray `cat` waiting on stdin) cost 2 minutes.

## Chromium check

`capture.mjs` here: console, Add Tweaks and Confirm sheets (Confirm is the scaffold with its title and class, empty
body), shells site and app, eras iOS 6/7/13/26, light and dark, mid-slide up, settled and mid-slide down: 144 shots,
run on this branch and on the code before it.
- iOS 6 (36 shots): the top 54 pt is pure black in every one, and the first non-black row is at 62 pt: the page's bar
  mid-slide, the sheet's once settled. `grid.png` shows the app shell (rows console, Add Tweaks, Confirm; columns
  light then dark, each up, settled, down).
- iOS 7, 13, 26 (108 shots): 104 pixel-identical to before; 4 differ by a pixel in the page's Search Sources
  placeholder behind a console sheet (text snapping at a paused frame), nothing in the sheet or its bar.
- The fake bridge gives no list data, hence the red error lines on the Sources page. The iOS 6 app shell came out with a
  62 pt top inset, not the 54 pt the script sets; the clip follows `--top-inset` either way.

## Not verified

- Real phones not checked. The repo rule is Chromium first.
- WebKit's own compositing of `clip-path` on a moving sheet (and its feel at 120 Hz) is only reasoned about. The clip
  is a static rectangle and only `transform` animates.
