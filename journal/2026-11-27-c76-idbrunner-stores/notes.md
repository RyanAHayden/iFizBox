# C76: IPA store, signing identity and Changes use idbRunner

B497 gave sources, the package cache and the app stores a retry when the browser ends a transaction. C76 moves the
last three IndexedDB users onto the same runner in core/cache.js (`idbRunner`):

- core/myipas.js `openIpaStore`, which also serves screens/tweaks.js's stores. It now opens through `connect()`, and
  the runner reopens the connection when the browser ends a transaction.
- signing/identity.js. It still opens a connection per transaction and closes it after; the runner retries on a fresh
  one inside that.
- core/changes.js `openSeenStore`. Its own retry wrapper is gone; it uses the runner.

A transaction the browser ends is retried once on a fresh connection. If that fails too, the user sees a plain sentence:

- IPA store: "Could not use the files kept in this browser. Try again." (`IPA_STORE_FAILED`). addSiteFile passes this
  sentence on as it is, not wrapped in "Safari couldn't keep the IPA:".
- Identity: "Could not use the saved certificate. Try again." (`IDENTITY_STORE_FAILED`).
- Changes: "Could not save what changed. Try refreshing again." (`SEEN_STORE_FAILED`), unchanged.

Changes in behaviour:
- idbRunner's onerror now falls back to `Error("IndexedDB failed")` when neither the transaction nor the request has an
  error. myipas and identity did this before; the runner did not.
- Changes: a synchronous throw other than InvalidStateError is now passed on, not retried. Before, every synchronous
  throw was treated as the browser ending the transaction and was retried.

Tests: web/app/core/idb.test.js gains an IPA store case in the shared "ended twice" table, a test that addSiteFile
shows the store's sentence as it is, and a signing identity test (retry once, then the plain sentence).

Checks:
- `node --test web/app/core web/app/signing`: 1252 passed, 0 failed.
- `node --test web/app/module-graph.test.js`: 6 passed.
- `node tools/concept/idb.test.mjs`: "memory IndexedDB: all ok".
- Failed: nothing.

Not verified:
- No real browser ending a transaction (for example an iOS background suspend) was reproduced. Only the fake IndexedDB
  in the node tests ended transactions.
- No phone or Chromium check: no screen or layout changed.
