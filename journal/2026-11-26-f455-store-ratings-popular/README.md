# F455: App Store ratings as Popular's third tier

- Worker: `worker/src/applookup.js` `appLookupBatch`, route `GET /api/applookup-batch?bundleIds=a,b&country=us` (1 to 100 ids).
  One Apple request for the ids not cached; each id cached a day at the edge (an unknown id too). Answers only
  bundleId, averageUserRating, userRatingCount.
- Core: `core/applookup.js` `batchLookupUrl`, `parseBatch`; `core/catalog.js` `rankPopular` tier 3 = `store` rating
  (average, then count), the rest is tier 4; `popular({ store })` counts it for IPA apps only (tweaks fall through).
- App: `web/app/catalog.js` `storeRatings` asks in batches of 100 (Worker on the site, Apple directly in the app),
  kept per session, waits at most 3 s.
- Tests: worker/test-applookup.mjs, two F455 tests in core/catalog.test.js.

## Not verified
- Real Apple answers and the app's direct call on a phone (only fakes were run).
