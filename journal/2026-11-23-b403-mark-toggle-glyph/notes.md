# B403 Installed mark toggle glyph in the iOS 7, 13 and 26 styles

The Installed mark toggle (`.mark-toggle`, beside Install on the Details page) had only altstore.css's iOS 6 white
embossed glyph. On a light bar in iOS 7, 13 and 26 it was nearly invisible, as the queue toggle was in B402.

1. Added per-style mask rules after the queue toggle's rules in ios7.css, ios13.css and ios26.css. Painted in
   `--i7-tint` (iOS 7), `--i13-tint` (iOS 13) and `--i26-label` (iOS 26).
   - Not marked: an outline circled check.
   - `.is-marked`: a filled circle with the check cut out. The cut-out is an SVG mask inside the mask image.
   - iOS 7 uses thinner strokes (1.3 outline).
   - altstore.css's 19px box is kept: no layout in the style sheets.
   - iOS 6 is unchanged.

2. `share-button-eras.test.js` now loops over both toggles (queue and mark). It also checks that the on-state does not
   bring `background-image` back.

Checks: B402's `probe.mjs` rerun, unchanged, in Chromium at 375 and 320 pt, in four styles, light and dark. It mounts
markToggle off and on. `after.png` in this folder is the 375 pt render: rows iOS 13, 26, 6, 7, dark on the left.
Only the 375 pt renders were looked at.

The probe runs with the jailbreak build's fake bridge and mounts the toggle directly, not a sideload Details page.

Tried and failed: none.

Not verified:
- On a phone or in WebKit (Chromium, per the phone rule). This includes the nested SVG mask inside a CSS mask image on iOS 15.
- iOS 26 native glass buttons: the glass code draws the mask as a template, as for Share. Not seen.
- The toggle on a real sideload Details page, beside Install.
