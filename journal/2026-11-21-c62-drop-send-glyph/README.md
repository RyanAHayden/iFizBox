# C62: drop Home's dead send tile glyph

## What I did
- grep across web/, native/ and tools/ for `send` as a glyph name (`glyph: "send"`, `.glyph-send`, `home.send`):
  the only hits were the two ICON_SETS home entries in `web/app/icons/rowicons.js` and the `.glyph-send` rules
  in `web/app/home.css` and `web/app/ios7.css`. `screens/home.js` only mentions Send Settings in comments.
- Removed all four.
- Added a C62 test to `web/app/icons/rowicons.test.js`: `send` is absent from both home maps and both stylesheets,
  and `screens/home.js` names no `glyph: "send"` tile. The existing F339 test still checks every glyph Home names
  is in both maps. `node --test web/app/icons/rowicons.test.js`: 19 pass.

## Tried and failed
Nothing.

## Not verified
- No visual check in Chromium: no tile uses the glyph, so nothing on screen changes.
