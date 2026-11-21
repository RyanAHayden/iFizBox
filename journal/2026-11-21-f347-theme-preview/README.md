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
- tools/concept/check.mjs over light:classic, light:metal, dark:gunmetal, ios7 light/dark, ios13 light, ios26 light
  (see results below).

## Tried / failed

- The first drag probe pressed below the pane (the sample's group was off screen at 283px): moved the press point
  into the body. A tap right after a fling only stopped the glide (as on iOS): waited it out.

## Not verified

- On a phone (iPhone 15 / 7): not run; the drag and the pressed looks were checked in Chromium with the concept
  shell's mouse-as-finger only. Real iOS touch (pointer capture on the top bar, :active) not seen.
- SPLIT_PEEK stays 100px as in the approved concept: the peek now shows the grip, the nav bar and a part of the
  search bar (the top bar is 113px). Left as approved.
- The Home header's icon in the concept shell showed a broken image (the shell has no app icon files); unrelated to
  this change.
