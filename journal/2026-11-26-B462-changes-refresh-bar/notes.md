# B462: Changes' Refresh shows the reload bar, not the Reloading Data HUD

## What changed
- Changes' Refresh (nav button and pull to refresh) used `reloadSources`, which put the blocking "Reloading Data" HUD over the page.
- It now calls `refreshInBar` (screens/changes.js): Sources' `refreshInBackground`, the same call Home's Reload makes. That shows the reload bar at the top with Cancel, the Sources badge spinning, and the page stays usable.
- When a refresh is already running (launch refresh, Home's Reload), `refreshInBackground` returns at once. `refreshInBar` then waits for it through home.js `untilRefreshed`, as Home does. Then it reads the installed packages again and reloads the list.
- Cancel on the bar stops the whole Refresh: the list is not reloaded and Last Updated is not set.
- `reloadSources` (the HUD job) stays as it was for the website's Browse Anyway, the launch refresh and queue.js's list-file repair. None of those are Changes' Refresh. Only its comment changed.

## Test
- changes.test.js "Changes (B462)": the bar path runs and the HUD never shows; a second call while one runs does nothing; Cancel skips the reload; a failure frees the job.
- `node --test` on changes.test.js, websign-refresh.test.js and module-graph.test.js: 24 tests pass.

## Tried / failed
- none

## Not verified
- Not run on a phone (iPhone 7 jailbreak app or the 15). The bar and `refreshInBackground` are Home's Reload code, which is already in use. The change only switches Changes to that call, and the unit test covers the wiring.
