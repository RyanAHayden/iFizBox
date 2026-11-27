# F452 Install counts for Popular

Done:
- `worker/src/installs.js`: GET /installs {enabled, counts} (cached 5 min), POST /installs/<id> with X-Review-Token.
  Table `installs (pkg, device, at)` in the reviews D1; one row per device+package so reinstalls don't count twice.
  Rate limits are the reviews' own (`allowReviewWrite`: address/token a minute, address a day). Routed in index.js and
  `run_worker_first` of both wrangler tomls. No REVIEWS binding: enabled false / 503.
- `installsApi` in `core/reviews.js` (kept there: a new module would count against app.js's startup import cap),
  `backend.installs` in both backends. Counted after: .deb install with code 0 (backend-native.js) and the install rows'
  `onInstall` (screens/altstore.js installRows: app, sideload, website; not the itms hand-off).
- `rankPopular`: installs first once >= `MIN_INSTALLS` (5), then rating, sources, date, name. catalog.js fetches counts like ratings.
- Tests: `worker/test-installs.mjs` (named so the gate's `worker/test*.mjs` loop runs it; the brief said worker/test/installs.test.js),
  browse-home.test.js (order), reviews.test.js (client).

**Not verified**: a deploy against real D1 and a phone install (no device used); the website install path counts through installRows' onInstall, checked by reading, not run.

Review notes: a repeat from a device that already counted skips the rate limits. Not done: counting plain APT installs
from sources (only linked .debs, which go through backend-native install(), and the app/site install rows); the rows'
count key is `appId || bundleId`, which equals the package id only where the row's id is the bundle id.

Task changed to tiers: `rankPopular` now ranks 1) more than 5 ratings here by average then count, 2) more than 5 installs
by installs, 3) the rest in the old order (rated, sources, date, name). `MIN_TIER` = 5 replaces `MIN_INSTALLS`. Tier 1 reads the
merged rating's count (reviews here, plus a depiction's where it gives one). The F450 test's order changed with it.
