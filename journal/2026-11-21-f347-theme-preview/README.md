# F347 Theme > Light / Dark preview, as approved in the concept

Ported the approved concept (branch concept/theme-preview) into the app, with the brief's changes.

## What changed

- `screens/settings.js` themePreview: the pane is a top bar (`.theme-preview-top`: the divider, the sample's nav bar
  and its search bar, read-only) over the sample (`.theme-preview-body`), which is no longer inert. splitPane hangs
  the drag on the whole top bar. The sample works: the bar buttons press (app.js's PRESSABLE), the store buttons press
  through a small `pressable()` helper (`.is-pressed`), the segmented control marks the tapped segment, the Checked row
  toggles its mark (`toggleCheck`, exported for the test), the rows press and do nothing. A Remove / Install / Done
  row of bar buttons; sources.css is loaded for Done's blue.
- `settings.css`: the top bar's styles; the divider strip dark like its tab (#333435 under a #5a5b5d top row,
  #121212 bottom line); the store buttons' pressed look (packages.css's `a:active .store-btn`); the no-strip rule
  over the sample bar made heavier (`html[data-shell] .theme-preview .navbar.theme-preview-bar::before`) so it beats
  `html[data-shell="app"] ... .navbar::before` whatever the load order.
- `ios6.css`: `--lt-green*` tokens at the end of :root (the brief's Add Icon (green) colours) and
  `.bar-button.green` rules beside the red ones. One set for both tones, as the blue Done; it keeps its edges when
  pressed, as Done does.
- `ios7.css`, `ios13.css`: green text, no box (tokens to none/transparent), as their red. `ios26.css` (not in the
  brief's file list, but the brief says to check every era; without it iOS 26 drew the iOS 6 gloss inside its
  capsule): the glass capsule with `--i26-green` text, as its red.
- `palettes.css`: Brushed Metal's dark-text rule skips `.green` too.
- `settings.test.js`: two F347 tests (the pane's structure, the colours row, toggleCheck; the CSS tokens and rules).

## Checks

- `node --test web/app/screens/settings.test.js`: 26 pass.
- Concept build of this worktree, `#/settings/theme/lightTheme`, headless Chromium (scratch script modelled on
  tools/concept/check.mjs, mouse as finger): drags up on the nav bar title, the search bar and the grip each grow the
  split by ~60px; a drag in the sample scrolls it 0 -> 236 with the split unchanged; a tap on Checked takes the mark
  off; `::before` content on the sample bar is `none`. Shot looked at: dark strip, pinned bars, the three buttons.
- The same probe holds Edit (in the top bar), Install and a store button: each shows its pressed class and art.
- Shots with the split dragged tall, every palette and era: light Classic / Sepia / Solarized / Legal Pad / Metal,
  dark OLED / Gunmetal / Wood (from the Dark list), iOS 7 / 13 / 26 light and dark. iOS 6: green gloss button with
  white text (Metal included); iOS 7 / 13: green text; iOS 26: green text in the glass capsule.
- tools/concept/check.mjs (jailbreak + site, light:classic, light:metal, ios7/ios13/ios26 light): see the last line.

## Review fixes

- Divider strip: flat #333435 under the 2px lighter top row (was fading on to #2a2b2c).
- The sample keeps aria-hidden (it is a picture of the controls; only its touch behaviour changed).
- Store buttons pressed: app.js's pointerdown takes `.is-pressed` off everything it did not press itself, so the
  store buttons use their own `.preview-pressed`.
- A press on the sample's Back / Edit lost its pressed look when the sample was scrolled: dragSplit laid the pane out
  tall on the press, the resize scrolled the sample, and app.js lets go of a pressed button on any scroll. The tall
  layout now waits for the first move.
- Kept, though the review listed them as not asked: the rows' press (no-op onClick) and the small style extras come
  from the approved concept; ios26.css because the brief asks every era to be checked.

## Tried / failed

- The first drag probe pressed below the pane (the sample's group was off screen at 283px): moved the press point
  into the body. A tap right after a fling only stopped the glide (as on iOS): waited it out.
- A first check.mjs run that included dark themes on #/settings/theme/lightTheme reported 14 failures (its output
  was cut by a tail; opening the Light list switches Mode to light, so a dark theme can't match there, F231). Re-run
  with light themes only; dark ones were shot from the Dark list instead.

## Not verified

- On a phone (iPhone 15 / 7): not run; the drag and the pressed looks were checked in Chromium with the concept
  shell's mouse-as-finger only. Real iOS touch (pointer capture on the top bar, :active) not seen.
- SPLIT_PEEK stays 100px as in the approved concept: the peek now shows the grip, the nav bar and a part of the
  search bar (the top bar is 113px). Left as approved.
- The Home header's icon in the concept shell showed a broken image (the shell has no app icon files); unrelated to
  this change.
