# B502a1 Free Apple ID: each queued app gets its own App ID

A free Apple ID's profile installs only the app whose bundle ID is its App ID, so the app queue now makes each app's own
App ID before it signs the app. The page makes or reuses `<bundle ID>.<TEAMID>`, downloads its profile and hands it to
the shell (`signing.addProfile`), which keeps it and signs the app with it. The app then sits beside other apps instead
of replacing them.

What was done:

- `web/app/signing/freeappid.js` (new, called by `signing/queue.js` `prepareOnDevice`): makes or reuses the App ID
  (`core/freeroute.js` `ensureAppId`), downloads its profile, hands it in with `signing.addProfile`. On the shell's
  `app_id_taken` refusal with no session it shows a Sign In Needed alert (Cancel / Open). Tests:
  `web/app/signing/freeappid.test.js`.
- `native/Sources/Sideload.swift`: `signing.addProfile` registered (keeps the profile through `FreeAppID.keep`, answers
  `appId` and `expires`).
- `native/sign/FreeAppID.swift`: the `app_id_taken` wording changed to say no App ID of its own was made for the app.
- `web/app/screens/free-apple-id.js`: exports `freeSession` and `endFreeSession` for the queue.
- `docs/signing.md` (Free Apple ID > In the sideload app): names, per-app profiles and the App ID making updated for
  the current behaviour.

Design choice: no sign-in prompt up front. The prompt appears only on the shell's refusal, so installs that work without
a session still work.

Known limit: if no bundle ID is known before signing and the held App ID is taken, the refusal comes without a bundle
ID, so no App ID is made even with a session.

Split out of this task:

- B502a1a: install outside the app queue (`signing.install`, e.g. Custom Install's progress page).
- B502a1b: App Refresh and Re-sign All do not remake a lapsed App ID first.
- B502a1c: the 15 Pro check (two test apps side by side from the queue, then the Sign In Needed alert).

## Device check

Not run; filed as the follow-up id from step 1 (B502a1c).

## Not verified

- The two-apps-side-by-side install on the 15 Pro (session context limit; phone locked by another task).
- `signing.addProfile` and the new `app_id_taken` wording are only compile-checked at most, never run on a device.
- That Apple's real per-app profile passes iOS's install.
- The Sign In Needed alert's Open destination in the real app.
