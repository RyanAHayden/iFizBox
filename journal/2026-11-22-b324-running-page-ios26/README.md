# B324: the Running page in the iOS 26 style

Under iOS 26 the Running page (nav/progress.js, the queue run, the app run) still drew iOS 6: the glossy
UISegmentBarBlackButton Apps | Log, glossy blue-on-white UIProgressView rows, Cydia's white-ring foot bar, the grey
x stop discs, the black gloss bar buttons and finish button.

## What changed

- `ios26.css`: one block at the end, through the tokens B304 made (`--console-*`, `--progress-*`, `--qr-*`) plus
  look-only rules (no layout: ios6-css.test.js passes):
  - **Decision: the page follows the theme** (White: the #f2f2f7 ground, black step lines, grey raw output; OLED
    Black: black), unlike iOS 7's and iOS 13's always-black console. The brief asks for "dark and light", and
    iOS 26's light controls (white capsules, the white segment pill) would sit wrongly on a black page in White.
    Written down here so a person can ask for the black terminal back (then: the OLED tokens on both tones).
  - nav bar as every iOS 26 page's (`--nav-bar` / `--dk-nav-bar`: the ground fading out, no hairline); Cancel, Hide,
    Close are the glass capsules (`--console-btn*` = `--i26-capsule`, rim, pressed).
  - Apps | Log: the era's segmented control (grey track, the chosen segment a pill 1pt inside, 13pt, semibold when
    chosen), the same tokens as the store and scope segments.
  - Rows' and foot's bars: a 4pt capsule, the tint on a grey track (#e3e3e8 White / #3a3a3c OLED); the rows' 9pt
    box narrowed with transparent 2.5pt borders, as iOS 13's.
  - The rows' stop: the App Store's stop glyph (a rounded square in a thin ring) in the tint, through a mask.
  - Finish button (Return to …): a prominent tint capsule, 17pt semibold white.
  - System font on every part; warnings #c66b00 in White (yellow is unreadable on light), #ffd60a in OLED.
- `nav/progress.js`: `rowBar()`, a row's bar: WebKit's `<progress class="qr-progress">` under the native controls
  hook (no value = WebKit's indeterminate bar), else the drawn `.qr-bar` / `.qr-fill`. The foot already used
  `<progress>` under the hook (F345a). `screens/apprun.js` and `screens/queuerun.js` build their rows' bars through
  it (outside the brief's file list, but the brief names apprun.js and asks for `<progress>` where the hook is on;
  the rows' bars are built there). `progress.css`: `.qr-progress` layout. ios26.css gives native bars `accent-color`
  the tint.
- `nav/progress-rowbar.test.js`: rowBar both ways, and the two rows pages use it.

## Checks

- `node --test` ios6-css, theme-palette, palettes, queuerun, apprun*, progress-finish, native-controls,
  price-btn-eras, import-cycles, progress-rowbar: all pass.
- Chromium shots, 390x700 @2x, from `run.html` here (B304's scratch page plus `controls=` and the card-sheet hook,
  and a fixed fake `runLogs.start`; served beside a symlink `app -> web/app`): `ios26-light.png` and
  `ios26-dark.png` (running, complete, Log tab, the one-job page running and complete), `ios26-rows-3x.png` (rows,
  stop, segmented control at 3x), `native-hook-and-ios6.png` (left: data-controls=native, Chromium's own
  `<progress>` in place; right: iOS 6 unchanged).

## Tried

- Nothing failed beyond the scratch page needing `runLogs.start` (queuerun's F363 API came after B304).

## Not verified

- Real device: Chromium only (a web check, per the repo's rule). WebKit's native `<progress>` under the hook, and
  whether it takes `accent-color`, are only seen on an iOS 26+ phone; Chromium draws its own bar there.
- No SF font on this Linux box: the system font renders as the fallback.
- The app run (screens/apprun.js) was not shot: it shares the rows, bars and stop with the queue run (same classes,
  same rowBar); its tests pass.
- F367's real glass over the bar buttons on iOS 26+ (the shell's) is not in Chromium.
