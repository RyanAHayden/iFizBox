# K5 Share sheet per era (concept)

Page: https://claude.ai/artifact/UoxRAw1NLezW5t99ybLEVR (source: concept.html here)

User: the Share button's sheet is iOS 6's black metal grid in every era. Each era should get its own share sheet,
and the tokens should split so ios7/ios13/ios26.css only swap values.

Where it lives today:
- `showShareSheet` in web/app/nav/sharesheet.js draws the sheet. Styles are the `.share-*` tokens in ios6.css,
  layout in style.css.
- Callers (screens/handoff.js `showShareFor`, screens/browse.js `showPackageShare`) already pass two kinds of item:
  actions (glyph: copy, qr) and apps (letter, color or image).
- iOS 7 and later already show these apart: an apps row, with the actions under it.
- The action sheet and alert were already split the same way. Layout hooks sit in style.css and packages.css, look
  tokens in ios6.css, and the eras set the values (docs/eras.md).
- docs/eras.md lists "the share sheet's grid" under "No hook yet".
- JS already reads layout hooks with getComputedStyle (nav/switch.js `--sw-travel`, nav/sheet.js).

Options:
- A: repaint the iOS 6 grid with tokens only. CSS only, but no iOS after 6 has a 3x3 grid, so every era would
  still look like iOS 6.
- B (recommended): a `--share-layout` hook (`grid` or `rows`) that sharesheet.js reads when the sheet opens.
  `grid` is today's code, unchanged. `rows` gives a title and close button (iOS 13/26), a scrolling apps row,
  and actions as an icon row (iOS 7) or list rows with the glyph on the right (iOS 13/26). iOS 6 and 7 keep Cancel.
  About 12 style.css hooks. The iOS 26 glass goes through `--i26-glass-blur`.
- C: hand the items to the existing action sheet with an icon slot. This reuses a finished component, but it is a
  menu, not a share sheet, and it changes a shared component.

Why B: it is the only option where each era looks like its own iOS. It keeps the rule that eras add no layout,
and the iOS 6 path stays the code that runs today.

Sketch check: the page renders at 420px wide in headless Chromium and fits. The sketch row and the table scroll
sideways inside their own boxes.

**Not verified**:
- The sketches are hand-drawn HTML at about half size, not renders of the app's CSS.
- AGENTS.md says concepts go through .claude/skills/concept (the live web/app). That was skipped here, because the
  choice is about structure across three eras and building three live variants is most of the build. The build
  task should make a live concept for each era before it lands.
- The iOS 7/13/26 measurements (icon 60pt, radii 10/38pt) come from memory of those iOS versions. No reference kit
  in ref/ covers them.
- The 3x iOS 6 pixel diff is a requirement for the build, not checked here.

**Page:** https://claude.ai/artifact/UoxRAw1NLezW5t99ybLEVR

**Page:** https://claude.ai/artifact/UoxRAw1NLezW5t99ybLEVR
