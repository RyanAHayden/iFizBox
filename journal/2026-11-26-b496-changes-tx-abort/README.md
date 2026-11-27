# B496: 'transaction aborted' in Changes

**Did.** `core/changes.js`: the seen store now reopens its connection on `close`/`versionchange`, and retries a
transaction the browser aborted (no `tx.error`, or `transaction()` throwing on a closed db) once on a fresh
connection. A second abort reads "Could not save what changed. Try refreshing again." Real errors pass through.
`catalog.js` caches the store promise, so the reopen lives inside the store. Tests: fake IndexedDB aborting
the first / first two readwrite transactions.

**Not verified.** Reproducing the abort in Chromium or on the user's iPhone (background mid-putMany): not tried;
the cause (connection closed by WebKit/versionchange) is inferred from the fallback string. The other stores
(sources.js, cache.js, installed.js, altstore.js) keep the same fallback; outside this task's files.
