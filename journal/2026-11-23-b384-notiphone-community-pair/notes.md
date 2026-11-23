# B384: GitHub | Discord on the Not-an-iPhone page

## What
- `web/app/screens/notiphone.js`: new `communityPair()` draws Home's pair (the GitHub | Discord tiles) between the
  hero and "Scan With Your iPhone". Same classes and markup as `home.js` `tile()` / `tileRow("pair")`.
  `home.js` is not imported because this page draws before the app starts, so the markup is repeated.
- The wrapper carries class `home`, because `home.css` and the eras set the tile tokens (`--tile-edge`,
  `--tile-radius`, …) on `.home`. `home.css` is a static `<link>` in `index.html` before `notiphone.css`,
  so it is loaded by the time this page draws.
- `web/app/core/appoffer.js`: `DISCORD_URL` moved here from `home.js`, beside `REPO_URL`. Both screens import it.
- `web/app/notiphone.css`: 13px under the pair, so the next header sits as far from it as from a table
  (the first shots showed it too tight).
- Links open with `target="_blank"` and `rel="noopener"`; the page stays up.
- Test: `notiphone.test.js` new test (place, href, target, rel, page still up after clicks).

## Checks
- `notiphone.test.js`: 4/4 pass.
- `capture.mjs` (Chromium over CDP, as mac/pc/android × light/dark × 1280/390 px): no sideways scroll; the tiles
  line up with the tables. Shots: `phone.png`, `desktop.png` in this folder.
- Real mouse clicks on the Mac tile open `https://github.com/...` and the Discord invite in new tabs, with the
  page still up.

## Not verified
- Real Mac, PC or Android browsers. Only Chromium with their user agents.
- The iOS 7, 13 and 26 eras on this page. They were not shot, since the task asked for light and dark only.
