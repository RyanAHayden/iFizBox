# B346: Liquid Glass nav bar buttons flicker during the back transition

## What repainted them

Measured in headless Chromium with `probe.mjs` (here): a fake shell that answers `ui.glass` the way
`NativeGlass.swift` does (one glass view per button id; ids left out are removed, new ones created; `buttonsHidden`
hides them all), with each message landing LAT ms after it was sent. Every frame it samples the look-alike bar buttons
(effective opacity incl. visibility, rect) and the fake glass.

Before (HEAD), at both LAT 8 and LAT 30, back tap and back swipe:

- **Glass re-created after every slide.** Hidden for the slide, the snapshot sent `buttons: []`, so the shell removed
  every glass button and made a new one at the slide's end (`created 1` per transition): iOS draws a new glass view
  in while its look-alike goes.
- **The look-alike vanished in one frame** (`jump 1`): opacity 1 -> 0 the frame the shell answered, with the new
  glass view over it for a frame or more before that (the two processes don't commit together).
- **Per-frame traffic during the swipe** (`sent 18`): the swipe's per-frame inline styles on the page shade and the
  opened row's fading copy weren't "quiet", so each frame sent the moving button rects, reconfiguring the hidden
  `GlassButton`s.
- **The glass stood still over a moving look-alike** for a frame at LAT 30 (`still 1`): the hide went out on the
  next animation frame after the slide began.
- **Swipe start, all styles:** `begin()` marks the pair `.is-moving` (which makes the page below's nav item visible)
  but only the first `move()`, on the next animation frame, sets its progress. When a frame painted in between, the
  page below's nav item showed at full opacity over the current one (Home's back button over Settings'). Caught
  once in Chromium (frame 6 of a swipe run before the app.js fix); timing dependent.

## Fix

- `nav/glass.js`: button ids are places in the bar (`l0`, `r0`, `r1`), so the shell keeps its views across slides
  and only retitles/moves them; while hidden the snapshot keeps the last shown buttons (`st.held`), so nothing is sent
  while a slide moves; a nav item gaining `.is-moving` syncs at once in the observer's own turn; style changes inside
  an `.is-moving` element are quiet; a bar button's look-alike fades out over 150 ms (Web Animation, cancelled when
  the glass hides) instead of popping. The fade is a Web Animation because era stylesheets may not hold transitions
  (`ios6-css.test.js` C44, `theme-palette.test.js` F203); a first try with a CSS transition in ios26.css failed those.
- `app.js` (outside the task's file list, one line): `begin()` pins the swipe pair at p = 1 right after marking it
  moving.

After, LAT 8 and LAT 30: `created 0, sent ≤ 1, still 0, jump 0.18, blank 0, twice 0` for both the tap and the swipe.
`node --test web/app/` 3169 pass; `tools/smoke/smoke.mjs` passed. New tests in `nav/glass.test.js`.

## Not verified

- **On a real iOS 26+ phone with the real UIKit glass.** Not checked: Chromium has no UIKit glass, so the
  probe models the shell's timing (LAT 8/30 ms) rather than measuring it. Whether an iOS glass button that is
  retitled and unhidden in one update draws in without animating, and whether the 150 ms fade looks right under
  real glass, needs the 15 Pro (`tools/ui-15.sh`, a screen recording of a back swipe and a back tap in ios26). I
  didn't take the phone in this run: the fix changes only web code, and the gate and Chromium cover it.
- The "glass still while the look-alike moves" frame at slide start can't be fully removed from the page: the hide
  needs one bridge hop. It now leaves before the slide's first frame (was one frame later).
