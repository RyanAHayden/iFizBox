# F450: Rating sort, Sort row icons, Popular best rated first

The Filter panel's Sort gets a Rating choice and icons on its rows. Popular lists the best rated packages first.
Ratings come from one Worker request, so the lists do not ask for each package.

## What was done

- `web/app/screens/listfilter.js`: `listSorts` drops "Most Sources". The rows are the list's own order, then Name,
  Newest and Rating.
- `web/app/icons/rowicons.js`: new row tiles `sortName`, `sortNewest`, `sortRating`, `sortFeatured`, `sortPopular`,
  `sortUpdated` and `sortDefault`. `SORT_ICONS` maps each sort to its tile.
- `web/app/screens/filterpanel.js`: `choiceGroup` draws a row's `icon` when the row has one.
- `web/app/catalog.js`: `refine` with sort "rating" runs the worker filter with no sort, then ranks with
  `rankByRating` from `web/app/core/ratingsort.js`. That puts the highest average first, then the most ratings, then
  name. Unrated packages come last, by name.
- `worker/src/reviews.js` (`allRatings`): new `GET /reviews`. It answers every rated package in one response,
  `{enabled, ratings: {id: [average, count]}}`. Hidden reviews are left out. It sends `Cache-Control: max-age=300`.
- `web/app/core/reviews.js`: `reviewsApi().ratings()` returns `{}` on any failure.
- `web/app/catalog.js`: keeps the `/reviews` answer for 5 minutes and waits at most 3 s for it. If it is late, the
  list is drawn unrated that time.
- `web/app/core/catalog.js`: `popular({ratings})` uses `rankPopular`. Rated packages come first, then unrated ones by
  source count, newest, then name. Unrated packages keep the source-count order and are not sorted alphabetically.
  With few packages rated, an alphabetical "Popular" would mean nothing. This order also applies to Browse's Top 25
  and to Tweak of the Day's pool, since both use `catalog.popular`.
- `web/app/screens/home.js` (`LIST_VIEW`) names the Popular list's own order "Popular". `web/app/screens/browse.js`
  (`filterView`) does the same for Top 25.
- Footers: Browse lists say "Popular: the best rated first, then what the most sources list." Top 25 says "Ranked by
  rating, then by how many of your sources list each package."
- Glossary: the Sort entry in `GLOSSARY.md` is updated.
- Release note: `release-notes/F450.md`.

## Split off

F450a is the depiction (Sileo) ratings fallback. Depiction stars need each package's Sileo JSON fetched one at a time,
because catalog rows do not carry the SileoDepiction URL. That needs its own design (caps, a Worker query). Ours
arrive in one request.

## Checks

- `node --test web/app/core/browse-home.test.js web/app/screens/browse-listfilter.test.js web/app/core/ratingsort.test.js web/app/icons/rowicons.test.js`: pass.
- `node worker/test.mjs`: pass, including the new `GET /reviews` case.
- Chromium, with `capture.mjs` (copied from F382's journal, plus a `panel:<text>` tap that looks inside the open
  `.filter-drop`; settings in `panel.json`), against `node worker/node.mjs` with a scratch reviews DB:
  - After rating iFly 5 (twice) and Provenance Alpha 4, Popular shows them first: `popular-rated-first.png`.
  - The Filter panel shows Popular, Name, Newest and Rating, each with its icon: `panel.png`.
  - Rating sort shows iFly, then Provenance Alpha, then the rest A to Z: `rating-sort.png`.
- Reading the virtual list's `innerText` gives DOM order, not screen order. The screenshots are the check.

## Not verified

- The jailbreak app and the Lite build on a phone. This is a web-only change, checked in Chromium per the phone rule.
- The deployed Worker's D1 answer for `GET /reviews`. It was tested on Node's SQLite D1 stand-in.
- The iOS 6 and iOS 13 looks of the new tiles. Only the default style was shot.
- The depiction fallback (F450a), which is not built.

## Review

- The fallback to depiction ratings is missing. It is split off as F450a (see above).
- Re-ranking Popular best rated first was flagged as not asked. It is kept, because the user asked for it in a note on the task.
- The Name tile looked like the Sources tile (blue list). It is now indigo, and a test checks it.
- Kept as known limits:
  - Popular can wait up to 3 s for the review server, once every 5 minutes.
  - When the ratings can't be read, Rating shows A to Z and says nothing about it.
