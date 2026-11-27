# B502a1a Free Apple ID: installs outside the queue get their own App ID

## What I did
- `docs/signing.md`, Free Apple ID: "Outside the app queue" now says an install (`signing.install`: plain Install with
  its progress page, Custom Install, Install a Copy) makes or reuses the App ID and hands its profile in before signing,
  through `withOwnAppId` (`web/app/signing/freeappid.js`, called from `ownAppId` in `web/app/signing/route.js`), only on
  the This iPhone route. "Making each app's App ID" and "Apple's session" point at it.
- `web/app/signing/freeappid.js`: `liveSession` is exported (the session the install reads).
- `web/app/signing/route.js`: `ownAppId` runs for an install. With a free explicit profile and a session of the same team,
  an IPA not looked at yet is looked at first with `signing.inspect`, and installed by that look's token.
- `web/app/signing-sheet.js` and `web/app/screens/queue.js` (`installCustom`): a look's token goes with `bundleId`, the
  bundle ID the callers pass, so a Custom Install names its App ID from the sheet. A typed bundle ID names the App ID.
- `withOwnAppId`'s result is wrapped, so an install is never signed or installed twice.
- Cancel during App ID creation installs nothing.
- `release-notes/B502a1a.md`: one sentence for users.
- Tests: `web/app/signing/route-freeappid.test.js` (new), `web/app/signing/freeappid.test.js`.

## Tried that failed
- The first test used the settings key `ROUTE_KEY` where the storage key `STORAGE_KEY` was meant, so the route stayed
  on the server. Fixed in the test.

## Checked
- `node --test web/app/signing/freeappid.test.js web/app/signing/route-freeappid.test.js` (node tests only).

## Not verified
- On-device check: a free Apple ID, Custom Install of a second test app installs beside the first. Not run: the queue's
  phone check (B502a1c) was running in another slot with the same spare Apple ID, and a second sign-in would churn its
  certificate. Filed as a follow-up (see below).
- Not run on a device: `signing.inspect` followed by `signing.install` by token on a free profile.
- No Chromium check of the Sign In Needed alert over the progress page (node tests only).

## Follow-up
- Filed with `agent-runner plan add`: the on-device check (plain and Custom Install of a second test app, relaunch with
  no session, Sign In Needed above the progress page, Open reaches Signing): **T89**, filed with `--force` (the
  duplicate check matched this task's own open entry B502a1a; the new one is the install path's phone check, not the queue's).
