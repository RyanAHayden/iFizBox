# F407: one run for apps and packages

## What I did
- Before: `runConfirmed` in `web/app/screens/queue.js` ran the apps' page first and started apt's packages only when that page closed, so the user had to tap Return in between.
- Now `runQueue` (`screens/queuerun.js`) takes `deps.apps`. `runAppRun` in `screens/apprun.js` is a guest on the run's page: it gets `deps.host` (attach, drive, changed, page stand-in) and keeps its own record and retry logic.
- `runJailbreakApps` has a `together` path. If it is null (AppSync Unified's run changed the queued packages) or the backend has no `queueFetch`, the old path stays: apps, then afterApps and Confirm.
- `core/installrun.js`: `hold()` and `resume()`. Packages download beside the apps, and dpkg's lane waits until all the apps have ended.
- One page: tabs are Queue | Log, app rows sit above package rows, and there is one summary and one Console Logs entry. The status counts the whole run, e.g. "(3 of 4)". App log lines are keyed `app:<id>`, because a package may share the bundle ID with an app.
- Finish = `chooseFinish` over both halves, plus AppSync's pending respring. Its flag clears after the respring.
- Cancel cancels both halves, and Retry All covers both. A failed app's row can't be retried while packages still run, since no app installs beside dpkg. A failed package can be retried: it joins the pass.
- Cancel, and a row's stop, now also send `ipa.cancel` to the shell. The app queue's run did not do that before.
- Changed: `web/app/core/installrun.js`, `web/app/screens/apprun.js`, `web/app/screens/changes.js`, `web/app/screens/queue.js`, `web/app/screens/queuerun.js`, and the tests `web/app/screens/queuerun.test.js` and `web/app/screens/jbappqueue.test.js`.

## Checks
- `node --test` on `screens/queuerun.test.js` and `screens/jbappqueue.test.js`: mixed run, app fails, retry, cancel during apps and during packages, and finish levels.
- Headless Chromium (smoke.mjs's CDP head with a patched backend), 2 apps and 2 packages:
  - one Running page;
  - a failed app did not stop the packages;
  - Retry All worked;
  - Restart SpringBoard called respring;
  - Cancel reopened Confirm with "Stopped. 0 installed and cleared from the queue.";
  - no page errors.

## Not verified
- A real run on the iPhone 7. Chromium checks the flow; the native calls are unchanged; the task did not ask for a device run.
- An IPA that the helper has already started installing is not stopped by Cancel, because the shell refuses `ipa.cancel` then. This is as before.
