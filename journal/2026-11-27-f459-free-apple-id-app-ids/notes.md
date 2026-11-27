# F459: free Apple ID App IDs as BariStore keeps them

## What I did
- `web/app/core/freeroute.js`: `appIdExpired` (past its expirationDate, 7 days after it was made), `ensureAppId` (reuses
  a listed App ID unless missing or expired), `extensionAppId`, `appIdsFor` (the app's App ID and one per extension,
  from one `listAppIds`), `forgetDeleted` (drops records of apps no longer on the phone; nothing while busy or on an
  empty list). Setup's App ID step uses `ensureAppId`. `otherProfiles` fetches no profile for an expired App ID, so
  App Refresh signs that app again.
- Model: github.com/barismd/BariStore AGENTS.md "App IDs".
- Started from the cancelled attempt on wip/F459, redone on top of the free-ID App Refresh work (F458).
- `docs/signing.md`: setup's App ID step and App Refresh state the 7-day reuse rule.

## Checks
- `node --test web/app/core/freeroute.test.js web/app/screens/free-apple-id.test.js`: 56 pass.
- Tests in `web/app/core/freeroute.test.js`.

## Dropped earlier
- Falling back to a still-listed expired App ID when Apple refused to register it: that hid the failure.
- Case-insensitive identifier matching: not asked.

## Where the rest lives
- Dropping deleted apps during refresh is already done natively by `native/sign/Refresh.swift` (`ProfileRefresh.plan`:
  gone records, with an empty-list guard). It has no guard for a running task: filed B503. `forgetDeleted` is the same
  rule for a JS App IDs list, which does not exist yet.
- `appIdsFor` and `forgetDeleted` have no caller. Wiring needs native signing with a profile per extension
  (`native/sign/IPASigner.swift`): filed F463.
- "Remove an app's extensions" was optional: nothing built. My IPAs already has `removeExtensions` (`core/myipas.js`).
- No release note: nothing new users see.

## Not verified
- No real Apple ID was used. Open: whether `listAppIds` returns `expirationDate` in this form, whether expired App IDs
  stay listed, and what `addAppId` answers for an identifier that is expired but still listed. If Apple refuses it,
  setup shows Apple's error.
- Extension App IDs are never registered with Apple.
- No phone used: only `web/app/core` changed, and the node tests cover it.
