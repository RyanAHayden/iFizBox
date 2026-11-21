# B304: the Running page in the iOS 7 and iOS 13 eras

The Running page (nav/progress.js, the queue run) drew iOS 6 in every era: the glossy black bar and bar buttons, the
UISegmentBarBlackButton Packages | Log, the glossy UIProgressView rows, Cydia's white-ring foot bar and the black
gloss finish button.

## What changed

- `progress.css`: the last literal paints of these parts became tokens in its first look-only `:root`, at their iOS 6
  values: `--progress-finish-text`, `--progress-track`, `--progress-track-edge`, `--progress-fill`,
  `--progress-seg-text`. Listed in docs/eras.md's table.
- `ios7.css` / `ios13.css`: one block each at the end. The console stays black in both themes (it is a terminal, as
  on every iOS); its parts take the era's dark controls (OLED Black's), so White and OLED Black draw it the same:
  - iOS 7: flat black bar under a #262626 hairline, text buttons in the dark-ground tint #0a84ff, the tinted outline
    segmented control (13pt, 4pt corners, chosen segment filled), the kit's 2pt UIProgressView (#b7b7b7 track, tinted
    fill) drawn centred in the rows' 9pt box and the foot's track (no layout change, `background` only), the finish
    button as the action sheet's Cancel on dark (#1c1c1e, 3pt corners, 21pt semibold tint).
  - iOS 13: black bar under a #38383a hairline, tinted text buttons, the grey track (#1c1c1e) with a #636366 pill,
    4pt progress bars (#3a3a3c track, tint fill), the finish button as the dark action sheet's Cancel (#2c2c2e, 13pt
    corners, 20pt semibold tint), the system font on the control, status and button.
  - Both: the console's title white (ios7/ios13 light set `--nav-title` black, which would vanish on the black bar).
- `queue.css` and `nav/progress.js` needed no change: the console bar and buttons already read `--console-*` tokens.

Tokens on `html[data-style=…][data-theme]` (outweighs progress.css's and queue.css's `:root`, and the palettes).

## Checks

- `node --test web/app/theme-palette.test.js web/app/ios6-css.test.js web/app/palettes.test.js
  web/app/screens/queuerun.test.js web/app/progress-finish.test.js web/app/ios13-*.test.js`: all pass.
- Chromium shots (390x700 @2x) from `run.html` here (a scratch page next to a symlink `app -> web/app`: runQueue over
  a fake backend that hangs one download at 35% and one install, or finishes all; `single=1` opens the one-package
  page with a help line): iOS 6 Classic/Gunmetal, iOS 7 White/OLED, iOS 13 White/OLED, running and complete.
  `ios7-ios13-light.png`, `ios6-ios7dark-ios13dark.png`, `single-install-ios7-ios13.png`.
- iOS 6 unchanged: the same shots against a main worktree, `magick compare -metric AE`: 0 px on Complete; ~80 px on
  Running, all in the indeterminate sweep bar, and main against main differs by as much (animation phase).

## Tried

- The concept tool has no sample run (B224 / B303 also used a scratch page), so the shots come from the scratch page,
  not a published concept. Headless Chromium's `--virtual-time-budget` left era sheets half slid in; the page ends
  every Web Animation at once.

## Not verified

- Real device: Chromium only (web check, per the repo's rule); no SF font on this Linux box, so iOS 13's system font
  renders as the fallback.
- iOS 13's 4pt row bars have square line ends (the line is drawn as a centred background in the 9pt box; rounding it
  would need a geometry hook for the bar's height).
- iOS 26 era: not in the task; it still draws the iOS 6 console.
