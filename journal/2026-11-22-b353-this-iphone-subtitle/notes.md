# B353: This iPhone subtitle truncates in the iOS 26 style

## What was wrong

Install Apps With's rows (Installation & Signing) keep `padding-right: 80px` on the row text for the USE / ACTIVE
button. At 393px (iPhone 15 Pro) in the iOS 26 style that leaves 187px for the subtitle. Measured in the 15's own
web view (pymobiledevice3 webinspector, a hidden `.cell-subtitle` span in the iOS 26 style, 13px `-apple-system`),
"Works offline - no install popup" is 189.1px in SF, so it ended in "...". In Chromium (Helvetica Neue) it is
187px and just fits, which is why the Chromium shots never showed it.

## What changed

- `settings.css`: the row's gap, vertical padding and the subtitle's wrapping go through three tokens, with every
  other era's current values as the fallbacks: `--route-use-gap` (80px), `--route-row-pad-y` (0px),
  `--route-sub-wrap` (nowrap). Era stylesheets may not set layout (C44, `ios6-css.test.js`), so the layout stays in
  settings.css and ios26.css sets only the tokens. My first try put the layout rules in ios26.css and failed C44.
- `ios26.css`: 72px gap (the button starts 61px into the row text, so 11px stays clear), 6px above and below, and
  the subtitle wraps (`white-space: normal`).

Result: in the iOS 26 style at 393px the subtitle has 195px, so the 189px SF line fits on one line. A longer subtitle,
or a wider font, wraps to a second line and the row grows (62px); a one-line row stays at its 48px. First try
without the vertical padding: the row grew only to 50px and the second line touched the divider.

## Checks

- Chromium, `capture.mjs` (copied from F372's journal, with `W=` for the viewport width), `--mode sideload`,
  393px, `script.json` (iOS 26) and `script-ios6.json` (iOS 6): measures the subtitle and the row, then widens the
  subtitle (`letter-spacing: .08em`, a stand-in for a wider font) and measures again.
  - iOS 26: subtitle 195px, one line, 15px tall; widened: 30px tall (two lines), row 62px, nothing over the divider
    (checked in the screenshot).
  - iOS 6: unchanged (row 43px, 217px for the subtitle, one line, "..." if it doesn't fit, as before).
- iPhone 15 Pro: SF width of both subtitles in the installed app's web view (189.1px and 160.1px). The installed
  build is 0.21.0, which has no USE buttons yet, so I measured the text, not the row.
- `node --test` in web/app: 3246 pass.

## Not verified

- The full row with USE / ACTIVE on the 15 Pro itself: the installed 0.21.0 doesn't have them, and building and
  installing a new IPA for a CSS padding change wasn't worth it. The row's geometry is CSS px and font-independent
  except for the text, and the text width was measured on the phone, so 189px in 195px is the expected result.
- iOS 7 and iOS 13 styles: they keep settings.css's fallbacks (unchanged); not shot.
