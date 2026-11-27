# B498a: anisette server lists

## Did

- B498 (journal/2026-11-27-b498-free-apple-id-anisette, already on main) had already made the whole change:
  - the server order in `ANISETTE_SERVERS` (web/app/core/gsa.js) and `ANISETTE_HOSTS` (worker/src/apple-relay.js);
  - `ani.sidestore.io`, `.app` and `.zip` dropped;
  - the Android-library skip;
  - the sign-in fallback client info changed from the stock Android string to the macOS 10.12.6 one.
- This task changed no product code. It added two tests to web/app/core/gsa.test.js:
  - one pins the exact server order. Before, the tests only compared the app's list with the relay's, so both could drift together;
  - one checks the fallback client info.

## Decision

- `anisette.lillq.me` stays on both lists, after `win.ani.sidestore.io`.
- The task's list ends at `win.ani.sidestore.io` and does not name `lillq.me`. But B498 asked for it to be added, and its checks provisioned a machine on it end to end. Removing it would drop a working server.

## Tried and failed

- Nothing.

## Checks

- `node --test web/app/core/gsa.test.js`: 16 pass, 0 fail.

## Not verified

- Live anisette servers were not probed again in this task. B498's probes from 2026-11-27 stand, including `win.ani.sidestore.io` answering 502.
- The new relay hosts are not yet checked through the deployed relay.
- No real Apple ID sign-in.

## Release note

- None. Nothing changes for users.
