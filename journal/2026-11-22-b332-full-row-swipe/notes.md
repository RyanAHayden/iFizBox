# B332: Installed's Delete as a full-row swipe; the row swipe's look per era

## What changed

- `nav/rowswipe.js` (the swipe Browse's package rows queue with) takes an optional `full(row, action)`: a full-row
  swipe that follows the finger 1:1 to the row's left edge (no rubber band), is armed past `FULL_ARM` (half the row),
  and on an armed lift slides the content off and only then calls `commit`. A `false` back from `commit` (a sheet's
  Cancel, an error) springs the row back. `fullSwipeEra()` says whether the page's era uses it. Same helper, no copy:
  the spring-back queue swipe is unchanged.
- `screens/installed.js`: `attachDeleteSwipe` puts that swipe on the apps list's rows under iOS 7, 13 and 26.
  `deleteSwipeAction` (Delete / Remove from List, full except "Still Installed", which only explains, so that row
  springs back after the swipe) and `swipeDelete` (Remove from List: the row collapses with `nav/ui.js collapse`, so
  the rows under it slide up, then the record goes; Delete: its sheet, Cancel or a failed uninstall bring the row
  back). iOS 6 keeps the swipe that shows the red Delete button (`attachRowGestures` now starts only there).
- `packages.css`: the strip shows on Installed's rows too; iOS 7, 13 and 26 draw it as their own swipe actions: one
  flat colour behind the row (`--swipe-add` green, `--swipe-remove` red, `--swipe-cancel` grey, UIKit's system
  colours per era) and a plain white plus / minus / x glyph, with none of iOS 6's rim, gloss, shadow or
  pinstripes. That is the queue swipe's icon fix: before, those eras showed iOS 6's glossy control on pinstripes.
  iOS 6 is unchanged.

## Tried and dropped

- Dark-tone values for iOS 13/26 (systemGreen #30d158, systemRed #ff453a) in `packages.css`:
  `theme-palette.test.js` refuses fixed colours in a dark rule there. They would belong in `ios13.css` / `ios26.css`'s
  dark blocks, which are not this task's files; the light values read fine with white on them in dark (checked in
  the dark shots), so both tones use them.
- `display: none` on the glyph's gloss inside the look-only stretch: `ios6-css.test.js` (C44) counts it as layout, so
  that one rule sits just above the stretch.

## iOS 6: why it keeps the red Delete

iOS 6 Mail deletes with a swipe that shows a red Delete button, then a tap on it; the full swipe-off came with
iOS 8. The Teehan+Lax iOS 6 kit has that button as "Email Delete" (`ref/teehanlax/ios6/sheet.svg`). The 4S's Mail has
no account set up (memory: no Edit mode or message list to try), so I could not swipe a message there; the kit and
iOS 6's documented behaviour are clear enough that iOS 6 counts as "clearly differs". So iOS 6 keeps its pattern.
(iOS 7 Mail also used a reveal-then-tap swipe; the task asks for the full swipe on every other era, so 7 gets it.)

## Checked

Chromium, the jailbreak app with a fake shell (`probe.mjs`: a made-up apt source, two installed tweaks, three
remembered apps; CDP touch events), iOS 6 / 7 / 13 / 26, light and dark, 390x844 @2x:

- Installed > Apps: a short swipe springs back and keeps the row; a long swipe on a gone app (Remove from List)
  slides it off red and the row goes, the rows under it sliding up; a long swipe on an installed app (Delete) slides
  off, its sheet ("Delete Deletable" / Cancel) opens, and Cancel brings the row back. iOS 6: the same swipe shows the
  red "Remove from List" button and removes nothing.
- Queue swipe: Changes' upgrade row (green +), Installed's package row (red minus, Remove), the queued row (grey x),
  in every era and tone; the undo bar ("Upgrade Charlie queued", Undo) shows and Undo takes it back out.
- `node --test` for `nav/rowswipe.test.js`, `screens/installed.test.js`, `screens/rowswipe-*.test.js`, then the
  whole `web/app` suite.

Retake: `node probe.mjs ../../web/app <outdir> ios7 dark [installed|queue|all]`.

`browse.js`, `ios6.css`, `ios7.css`, `rowswipe-original.test.js` and `rowswipe-jailbreak.test.js` are unchanged:
the queue swipe's logic (what a swipe queues) did not change, and the era colours sit with the swipe's other look
rules in `packages.css`, so the new checks went into `nav/rowswipe.test.js` and `installed.test.js`.

## Not verified

- A real phone: Chromium with the fake bridge covers this web-only change (AGENTS.md: phone only when Chromium
  can't check). WebKit's touch handling on the iPhone was not exercised for the new full-row path; the gesture code
  around it (pointer events, no capture) is the queue swipe's, already used on the iPhone 7.
- The 4S's Mail swipe itself (no Mail account there): see above.
- "Still Installed" (sideload app, iOS still has the app) through the swipe in Chromium: covered by the unit test
  only (the fake shell is jailbreak mode).
