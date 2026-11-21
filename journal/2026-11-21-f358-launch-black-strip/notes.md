# F358 Launch screen: the iOS 6 sets draw the black status-bar strip

F356 made the page's iOS 6 era draw a plain black strip, `--top-inset` tall, with the 44 pt nav bar under it. The
launch storyboard still stretched the bar's gloss up through the strip, so the hand-over showed the strip go black.

## What changed

- `native/launch/LaunchScreen.storyboard`: a new image view `Lss` (`LaunchStatusStrip`) from the screen top to the
  safe area top, right above the pinstripes in z-order and under every nav bar view. `LaunchNavTop` now starts at the
  safe area top (22 pt, the bar's first half), and the nav highlight `Lnh` moved from the screen top to the safe area
  top (the bar's first point), as ios6.css puts it at `--top-inset`.
- `native/launch/make.py`: `LaunchStatusStrip@2x/@3x` (1 px wide, 1 pt tall, one colour). Black (`STATUS_STRIP`,
  ios6.css `--site-strip`) in every iOS 6 set. The iOS 7 and iOS 13 sets (`white`, `white13`, `oled7`, `oled13`) give
  their bar's flat colour as `strip`, so they draw what they drew before: their page runs the flat bar up through
  the strip, and their highlight colour is the bar's own, so moving `Lnh` changes nothing there.
- The new image is in all three file lists that must agree: `launch_check.IMAGES`, `Splash.files` in
  `native/Sources/Launch.swift`, `helper_launch_files` in `native/helper/launch.h` (the helper copies the theme's
  files over the bundle's). These files weren't in the task's file list, but the tests require them to agree.
- Reran `make.py` and `storyboard.sh mba` (the MBA compiled it, no ibtool warnings), then `make.py` again so every
  theme's nib is the newly compiled one with its colours rewritten.
- `native/test_launch_grounds.py`: `test_f358_status_strip_is_black_in_ios6_sets` checks the CSS (`.navbar::before`
  is `--site-strip`, black; the app-shell gloss override only for iOS 7/13), every set's strip pixels, and the
  storyboard's pins and z-order. `css_theme` gives the era sets `strip` = their bar colour.
- `docs/native.md` Launch screen: intro, table rows, and the safe-area caveat below.

## Why an image, not a colour view

`make.py` finds each colour view in the compiled nib by Classic's colour and rewrites it per theme. A black strip
view would have the same colour as the tab bar's black view (`Ltb`, Classic `000000`), so `theme_nib` couldn't tell
them apart. An image needs no nib rewrite, and each set gets its own colour from it.

## Known gap

The storyboard can only pin to the safe area. The page's strip is `--top-inset`: the status bar's bottom on a Dynamic
Island phone whose status bar clears the island by 6 pt (F356's `TopInset`), otherwise the safe area. On such a phone
the page's bar starts a few points higher than the splash's. On the iPhone 15 Pro, notch phones and Home-button
phones the two are the same. Written in docs/native.md.

## Simulator check

B180's harness (`journal/2026-11-20-b180-launch-strips/sim/run.sh`), copied with the new storyboardc, images and
`web/app` (minus `app.js`) to the MBA as `~/f358sim` (deleted after), `APP_ID=com.example.f358launch1`, on iPhone 17,
iPhone 16e and the "B180 SE" simulator. The harness sets no `--status-bar-bottom`, so the page uses the safe area,
the same height the storyboard pins to. Column x = 8 px, first non-black row / nav bar bottom edge row:

| device | splash | page | cover |
|---|---|---|---|
| iPhone 17 (1206x2622) | 186 / 315 | 186 / 315 | 186 / 315 |
| iPhone 16e (1170x2532) | 141 / 270 | 141 / 270 | 141 / 270 |
| B180 SE (750x1334) | 40 / 126 | 40 / 126 | 40 / 126 |

The strip is black down to the safe area top in all three, the highlight and gloss start on the same row and the
bar ends on the same row. The system splash's blue is a few levels more saturated than the in-app render, the
Simulator shift B180 already wrote down; the cover matches the page.

## Not verified

- Only Classic was seen in the Simulator (the bundle's own storyboard). The other sets' nibs are the same compiled
  nib with colours rewritten, and their strip images are checked by `test_launch_grounds.py`, but none was rendered.
- No real phone: the jailbreak splash on the iPhone 7 and the cover on the iPhone 15 Pro weren't checked. The task
  asked for the Simulator check, and per the repo's rules phone time is for what the Simulator can't show.
- A Dynamic Island phone where F356's `TopInset` picks the status bar's bottom (not the 15 Pro): the splash's bar
  would sit a few points lower than the page's ("Known gap"). No such simulator was run with the shell's
  `--status-bar-bottom` set.
