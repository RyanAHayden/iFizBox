# B502a1c: 15 Pro check of the free Apple ID queue

**Task:** Check B502a1 (free Apple ID: each queued app gets its own App ID) on the iPhone 15 Pro. It has to run on the real phone, because it signs and installs in the native shell. Lite build of this branch, installed with `tools/ui-15.sh`.

**Method:**
- Kept the certificate with `signing.export`, then `signing.remove`.
- Signed in with the spare free Apple ID in Use a Free Apple ID. The 2FA Allow prompt and code appeared on the phone itself.
- Certificate Limit alert: revoked the old "iFizBox Website" certificate and left iloader's.
- Test IPAs (a tiny C UIApplicationMain app, bundle IDs `com.ryha.b502a1c.one` to `four`) were put into iFizBox's Documents with `afcclient`.
- Queued with `queueLibraryInstall` (screens/myipas.js) over Web Inspector. Confirm was tapped on the screen. The My IPAs rows were not tapped.

**Result:**
- PASS: apps one and two installed side by side from one app queue, as `com.ryha.b502a1c.one.4549VNVVAG` and `com.ryha.b502a1c.two.4549VNVVAG`. iOS lists both.
- PASS: after a relaunch with no session, the third app installed under the setup's held App ID `com.ryha.ifizbox.4549VNVVAG`. This is correct: nothing else had that ID, because this phone's iFizBox is paid-signed.
- The fourth app got the row "Sign in with your free Apple ID in Settings, then install it again" and the Sign In Needed alert.
- FAIL, found and fixed: Open changed the address to Installation & Signing, but the run's page stayed on top, so nothing visible happened. That page is also not where the Free Apple ID group is. The group is on Certificate, below the fold.

**Fix:** `openFreeGroup` in web/app/signing/freeappid.js. It closes the finished run's page, or puts it aside while a run is going. Then it opens the path from `freeIdPath` (screens/settings.js), and `showFreeGroup` (screens/free-apple-id.js) slides to the group. Test: web/app/signing/freeappid.test.js, 9 pass.

**Phone restored:**
- Original certificate back (same serial).
- `freeid` localStorage keys removed.
- Test apps uninstalled and their records forgotten.
- Test IPAs deleted.
- The phone keeps the build of this branch from before the fix.
- The spare Apple ID now holds new App IDs for these test apps (10 a week limit).

**Not verified:**
- The Open fix on the phone. The session hit the runner's context limit before the rebuilt app was installed. Filed as a follow-up part.
- Open pressed while a run is still going.
- The non-merged layout (Signing page) on a phone.
