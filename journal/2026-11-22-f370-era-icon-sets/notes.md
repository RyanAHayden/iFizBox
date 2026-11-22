# F370 Era icon sets for iOS 13 and iOS 26

Built from the approved concept (https://claude.ai/artifact/1jegTGS8DQc5qz1xTjpZh1, branch `concept/era-icons`,
`eraSet`), cleaned up and tested. The concept's Eras app icon group is left out (that's the next task).

## What changed

- `web/app/icons/rowicons.js`: `eraSet(colours, line, tile, tabLine)` derives a full set from iOS 7's drawings:
  rows (every row keeps its glyph, takes the era's system colour of its iOS 6 colour), glyphs (iOS 7's line glyphs at
  the era's weight), guides and home (iOS 7's tiles recoloured, lines weighed), tabs, tabsSelected, tile.
  - iOS 13: iOS 13 system colours, line 2.2/24 (iOS 7: 1.9), tile corners 6.8pt, glyph 19pt.
  - iOS 26: iOS 26 system colours, line 2.4/24, tile corners 7.8pt, glyph 18pt.
  - Tab bars: filled glyphs (iOS 7's chosen-tab shapes with round caps; iOS 26 a 2.2 outline stroke), the chosen
    tab the same glyph in the tint. `tabsSelected` names the same glyphs so F369's native tab bar can read both.
- `ios13.css` / `ios26.css`: the tab glyph tokens (`tabGlyphTokens(style)` and `(style, "tabsSelected")`) and
  Home's tile rules (`homeGlyphRules(style)`) under `html[data-style]`, plus the tile corner/size, green row, cert
  inks and More's blue in the green row, as ios7.css has them. Generated with a scratch script that prints those
  functions' output; rowicons.test.js fails if they drift.
- iOS 7 "looks missing" check: on a fresh launch iOS 7's set shows in Chromium (tab bar, Home, Settings rows; shot
  `before-ios7-settings.png`). What did not follow: a live Theme > Style change. Row tiles already drawn (Settings'
  root under Theme > Style, any page under it) kept the old era's pictures until the page was redrawn, so going back
  from Style showed iOS 6 tiles in iOS 7. Home already repainted its links (`followStyle`); nothing else did.
  Fixed in rowicons.js: `restyleRowIcons(root, style)` swaps every `.row-icon img` it drew for the new era's, and
  `followRowIconStyle()` (started once at import where a document exists) runs it on each `data-style` change.
- `theme-palette.test.js` (outside the task's file list, needed): F202/F203 asserted ios13.css/ios26.css have no
  `--glyph` ("keeps iOS 6's filled tab glyphs"), the old decision this task replaces. Now they check every `--glyph`
  rule there is a `.tab[data-tab]` (or `.active`) rule.

  Checked in Chromium (check.mjs `--probe`: open Settings in iOS 6, set `data-style="ios7"`, read the last row
  tile's corner): main's build `6 -> 6` (the tile stays iOS 6's), this branch `6 -> 6.5` (iOS 7's).

## Decisions

- iOS 26's tab bar: the brief says "outline glyphs in iOS 26's weight, tabsSelected filled"; the approved concept
  (the later instruction: "Build that") draws them filled, chosen tab tinted, as iOS 26's own tab bars do. Built as
  approved; if outline unselected tabs are wanted after all, it's one line in `eraSet` (`tabs` from
  `TAB_GLYPHS_7` at the era's weight).

## Shots

`shots/sheet.png` is the Chromium sheet (tools/concept/check.mjs on a standalone build of this branch, iPhone 16
size): columns iOS 7, iOS 13, iOS 26, each White then OLED Black; Home on top, Settings below, with the tab bar in
each. Both check runs reported "all clean" (no errors, no stray requests). `shots/before-ios7-settings.png`: main's
iOS 7 Settings on a fresh launch, already drawing iOS 7's set.

## Not verified

- On a phone: the web change is checked in Chromium per AGENTS.md (phone only when Chromium can't check); the
  native glass tab bar on iOS 26 (F367) draws the web's glyph masks, so it should pick these up, unchecked on the 15.
- Whether the user's "iOS 7 looks missing" was the live-switch case fixed here or an older app build without F332:
  it can't be asked in an unattended run; on current main a fresh launch draws iOS 7's set.
