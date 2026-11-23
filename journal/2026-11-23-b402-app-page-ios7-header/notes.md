# B402 Details page header and queue toggle in the iOS 7, 13 and 26 styles

Two fixes on the Details page for an app, in the four styles (iOS 6, 7, 13, 26).

1. The queue toggle (`.queue-toggle` in altstore.css) had only iOS 6's white embossed glyph. On a light bar in iOS 7,
   13 and 26 only its emboss showed, so the add-to-queue button was nearly invisible. Added per-style mask rules after
   the Share rules in ios7.css, ios13.css and ios26.css: the plus, and an X while queued. They are painted in
   `--i7-tint` (iOS 7), `--i13-tint` (iOS 13) and `--i26-label` (iOS 26, the label colour, as its Share button).
   iOS 6 is unchanged.

2. The header's rating row was `nowrap` and overflowed the text column under Share, in all four styles.
   `packages.css` `.store-head-rating` is now running text that wraps (`min-height: 15px`).
   `.store-head-text:has(> .store-head-rating)` has `margin-bottom: -16px`, so a second line goes into the 30px
   bottom padding and the header height is unchanged: 117 px before and after at 375 pt.
   When the count wraps, the version line moves down 15 px. nav/slide.js watches `.page-body`, which is what is
   meant to slide it.
   Why wrap rather than ellipsis: "on the App Store" must stay readable. At 320 pt an 8-digit count takes three
   lines in all and the header grows by 25-26 px.

Checks: `probe.mjs` mounts the real storeHeader, queueToggle, markToggle and Share button in Chromium at 375 and 320 pt,
in all four styles, light and dark. `before.png` and `after.png` are the 375 pt renders: rows iOS 13, 26, 6, 7, dark
on the left. New tests in `web/app/share-button-eras.test.js`.

Found and filed, not fixed: the Installed mark toggle (`.mark-toggle`) has the same white glyph. Filed as its own task.

Not verified:
- On a phone (web-only, Chromium per the phone rule).
- Real iOS fonts (Chromium substitutes fonts).
- The slide of the version line was not watched.
- iOS 26 native glass buttons: glass.js draws the mask as a template, as for Share; not seen.
- On iOS 15.0-15.3 there is no `:has()`, so there the header grows by a line when the count wraps.
- `:has` support is from knowledge, not tested.

Tried and failed: an 18 pt glyph box in the era sheets (the C44 test allows no layout there); the glyphs fit
altstore.css's 16x17 box instead.
