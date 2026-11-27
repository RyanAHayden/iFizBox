# F459: free Apple ID App IDs as BariStore keeps them

## What I did
- `web/app/core/freeroute.js`: `appIdExpired` (past its expirationDate, 7 days after it was made), `ensureAppId` (reuses
  a listed App ID unless missing or expired; identifiers are matched exactly), `extensionAppId`, `appIdsFor` (the app's
  App ID and one per extension, from one `listAppIds`; when two extensions would get the same App ID, the later one
  gets a number), `forgetDeleted` (drops records of apps no longer on the phone; nothing while busy or on an empty
  list; bundle IDs compared ignoring case, on purpose). `extensionAppId` also compares bundle IDs ignoring case, on
  purpose. Setup's App ID step uses `ensureAppId`. `otherProfiles` fetches no profile for an expired App ID, so
  App Refresh signs that app again.
- Busy guard: `refreshApps` sends `busy` to `signing.refresh`; `screens/free-apple-id.js` passes `appQueueRunning`.
  The shell also counts a current SignJob as busy. While busy, `ProfileRefresh.plan` (`native/sign/Refresh.swift`)
  leaves an app iOS doesn't list alone: neither dropped from the record nor signed again. Done here: spec review found
  it missing.
- Model: github.com/barismd/BariStore AGENTS.md "App IDs".
- Started from the cancelled attempt on wip/F459, redone on top of the free-ID App Refresh work (F458).
- `docs/signing.md`: setup's App ID step and App Refresh state the 7-day reuse rule and the busy exception.

## Checks
- `node --test web/app/core/freeroute.test.js web/app/screens/free-apple-id.test.js`: 57 pass.
- `SWIFT_TOOLCHAIN=… IOS_SDK=… python3 native/test_sideload.py`: 3 pass. Without the env vars all are skipped.
- Tests in `web/app/core/freeroute.test.js`, and the Swift stub tests in `native/sign/tests/sideload/main.swift`.

## Dropped earlier
- Falling back to a still-listed expired App ID when Apple refused to register it: that hid the failure.

## Where the rest lives
- Dropping deleted apps during refresh is already done natively by `native/sign/Refresh.swift` (`ProfileRefresh.plan`:
  gone records, with an empty-list guard and the busy guard above). `forgetDeleted` is the same rule for a JS App IDs
  list, which does not exist yet.
- Extension App IDs and the App IDs list are the rest of the task, filed as F463. It needs native signing with a
  profile per extension (`native/sign/IPASigner.swift`). `appIdsFor` and `forgetDeleted` have no caller yet, so in the
  product extensions do not yet get App IDs.
- "Remove an app's extensions" was optional: nothing built. My IPAs already has `removeExtensions` (`core/myipas.js`).
- No release note: nothing new users see.

## Not verified
- No real Apple ID was used. Open: whether `listAppIds` returns `expirationDate` in this form, whether expired App IDs
  stay listed, and what `addAppId` answers for an identifier that is expired but still listed. If Apple refuses it,
  setup shows Apple's error.
- Extension App IDs are never registered with Apple.
- The busy guard on a phone: not verified. An install running outside the app queue once its signing job has ended is
  not seen as a running task.
- No phone used. `native/Sources/Sideload.swift` and `native/sign/Refresh.swift` changed too, not only `web/app/core`;
  the node tests and the Swift stub tests cover it.
