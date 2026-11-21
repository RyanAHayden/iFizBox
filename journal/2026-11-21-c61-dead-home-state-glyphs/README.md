# C61: drop Home's dead state-tile glyphs

The green row has shown only More Sources for a while, so its old state glyphs were dead.

- `web/app/icons/rowicons.js`: removed `add`, `upgrades`, `current`, `loading` from the iOS 6 and iOS 7 home
  maps and replaced the stateTile comment (that function no longer exists) with one for the certificate tile.
  Kept `failed` (Home's certificate row uses it) and `more`. The shared `GLYPHS_7.check`/`clock`/`plus` stay:
  row icons use them.
- `web/app/home.css`: removed `.glyph-add/-upgrades/-current/-loading` and the `.glyph-loading` opacity; the
  B266 comment no longer talks about "the other state glyphs".
- `web/app/ios7.css`: removed the same four rules.
- `web/app/icons/rowicons.test.js`: new C61 test that the four (and C60's `changes`) are absent from both maps and
  both stylesheets while `failed` and `more` stay; the F339 comment no longer names `.glyph-loading`.
  The F339 tests already keep the maps and the CSS in step.

Found on the way: the home map's `send` glyph has no user in screens/home.js since Home stopped offering Send
Settings. Out of scope here, so I filed it as a follow-up.

Nothing I tried failed.

**Not verified**: I didn't look at Home in a browser. No rendered page uses the removed classes (grep across
web/ found them only in these three files), so the page can't change.
