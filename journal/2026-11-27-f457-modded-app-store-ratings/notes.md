# F457: modded apps and the App Store rating in Popular

## Problem

Modded apps keep the original app's bundle ID, so they got the original's App Store rating in Popular's third tier.
Seen with six or more RyukGram variants on Instagram's rating.

## Decision (unattended)

An app gets the App Store tier only when its name is the App Store's whole name or its first words
(`isStoreName` in `web/app/core/applookup.js`). A `+` is part of a word, so "Instagram++" is not "Instagram".

Not chosen: "one row per bundle ID gets the tier". That one row could still be a modded app.

## Changes

- `worker/src/applookup.js`: the batch answer carries `trackName`. The Worker cache key has `/v2/`, so day-old answers
  without names are not served.
- `web/app/core/applookup.js`: `parseBatch` gives `[average, count, name]`. The localStorage key is now
  `ifizbox.storeratings2.<country>`.
- `web/app/core/catalog.js`: `popular()` applies the name check.

## Checked

- Node tests: `web/app/core/catalog.test.js`, `web/app/core/applookup-batch.test.js`, `worker/test-applookup.mjs`.
- A scratch script on the real default app sources with real Apple lookups (US store): 18 candidates, 4 bundle IDs
  rated.
  - Kept "Provenance" (App Store name: "Provenance App").
  - Dropped the RyukGram variants (Instagram), Unbound (Discord - Talk, Play, Hang Out) and YouMod (YouTube).
- RyukGram variants still show lower in Popular's top 30 by the other tie-breaks (sources, date), just without the
  rating.

## Known limits

- A modded app named exactly like the original still gets the rating.
- A genuine app whose source names it differently from the App Store, or a country store with a localised name,
  loses the third tier and ranks with the rest.

## Not verified

- The app's direct call to Apple on a phone (jailbreak or sideload build).
- The deployed Cloudflare Worker (only the fake-cache test).
- Non-US App Store names.
- No browser render of the Popular screen. Ranking is covered by the core tests and the real-data script.
