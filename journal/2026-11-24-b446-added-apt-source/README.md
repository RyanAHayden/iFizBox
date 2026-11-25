# B446: a source just added loads at once in the jailbreak app

## What
- Cause: `core/sources.js` `firstLoadFilter` takes only AltStore sources. An added APT source got no `apt-get update`,
  though its packages showed (`net.packages`).
- Fix, in `backend-native.js`: the jailbreak source's calls remember the keys just added (`backend.addedSources`,
  in memory) until an `apt-get update` covering them starts.
- `core/sources.js`: `addedFilter` and `loadNeverLoaded` load those keys in `loadNew`'s run. One key goes by retry
  (`update-source`); several go by one update.
- Apt updates in `refreshSources` now run one at a time, so an add after a cancelled Refresh waits for apt's lock.
- The marker is not `updated`, because `verifySource` sets `updated` at add.
- A failed load is not retried automatically (no loop on Search keystrokes). The row and Refresh work as before.
- Added to Home's Recommended sources page and to account sync (jailbreak only). Both never called `sourcesChanged`.

- Cancelling a Refresh used to drop the load asked for meanwhile; a source added during it now still loads.

## Checks
- Node tests: `backend-native-addload.test.js` (new), `firstload.test.js`, `newsources.test.js`.
- `journal/2026-11-24-b446-added-apt-source/check.mjs`: Chromium with native and fake. Add a source via
  Sources > Add, Install, Confirm. Main shows Cannot Comply; this branch installs.
  Run: `node journal/2026-11-24-b446-added-apt-source/check.mjs [web/app dir]`.

## Failed along the way
- The first check version passed on main too, because the launch update of the fake copied all remote lists. The
  list is now written after that update.
- The first script version missed the Unknown Source sheet.

## Not verified
- On the iPhone 7 with real apt. The helper's `update-source` is F233a's and unchanged.
- Home's Recommended sources page and the account sync paths were checked only by reading, with no test of their call.
