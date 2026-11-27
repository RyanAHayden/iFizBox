# B497: 'transaction aborted' in the IndexedDB stores

**Did.** New `web/app/core/idb.js` (`idbRunner`). An abort with no error, or an `InvalidStateError` from starting a
transaction, means the browser ended the connection: it reopens once (concurrent calls share the reopen), retries,
and if that fails too throws a plain sentence per store. Real errors pass through with no retry. Used by
`core/cache.js`, `core/sources.js`, `core/installed.js` (app store) and `core/altstore.js`. The behaviour matches
`core/changes.js` (B496), which was left untouched (outside this task's files). One difference from `changes.js`:
an exception thrown by the store request itself is not treated as "connection ended".

**Tests.** `web/app/core/idb.test.js`: for the index cache, source store and app store, a transaction the browser
ends is retried once on a fresh connection (both abort and refused-start cases), and ending twice gives the plain
sentence. A real error (`QuotaExceededError`) is passed on with no retry. Calls that find the connection gone share
one reopen. The AltStore list store is tested through `withAltSources`: retried once, then the plain sentence. It
shares the helper and is also covered by the existing altstore tests for normal use. Reading the AltStore list still
counts a failure as an empty list (as before), so its sentence only shows on a write. `node --test web/app/core`
passed (1171 tests, 0 failed).

**Chromium smoke** (headless, real IndexedDB): cache, source store and app store writes and reads worked. After
another open raised the cache database's version, the next read reopened and surfaced the real `VersionError`.
Tried and failed: `chromium --dump-dom` with `--virtual-time-budget` dumped the page before IndexedDB finished, so
the page POSTed its result to a small local server instead. The AltStore list store was not in the Chromium smoke.

**Not verified.** A real browser-initiated abort on an iPhone: iOS ending the connection in the background cannot be
triggered on demand, so there was no phone test.
