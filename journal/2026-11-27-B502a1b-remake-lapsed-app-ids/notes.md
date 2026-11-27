# B502a1b: lapsed App IDs are made again on a free Apple ID

## What was done
- `web/app/core/freeroute.js` `otherProfiles` makes again a lapsed App ID (expired, or no longer listed by Apple) of a
  recorded app or of iFizBox's own, through `ensureAppId`, and returns its profile. `refreshApps` passes those profiles
  in `signing.refresh`, so the shell installs them through misagent (current certificate) or signs the app again with
  them. The setup's own App ID is left out, as before. A session error stops the refresh with the existing alert.
- `refreshApps` now opens its progress page before it fetches the profiles, so the lines about making an App ID show on
  that page.
- `web/app/screens/queue.js` `resignApp` (Re-sign from Installed's Manage, `signing.resign`) goes through
  `withOwnAppId` (`signing/freeappid.js`), as an install does: the App ID is made or reused and its profile handed in
  before the shell signs.
- `web/app/screens/signed-apps.js` `handFreeProfiles` makes the lapsed App IDs of the recorded apps and hands their
  profiles in before `signing.resignAll`. It never throws: without a session of the same team it does nothing.
- `docs/signing.md` (Free Apple ID): App Refresh, and a new bullet for Re-signs outside the app queue. The sentence
  that said App Refresh and Re-sign All don't make a lapsed App ID again first is gone.
- `release-notes/B502a1b.md`: one sentence for users.

## Decisions
- Only IDs of the form `<bundle ID>.<TEAMID>` are made again. An identifier of another form, or with a wildcard, is
  skipped (`otherProfiles` checks `freeAppId` gives it back unchanged).
- A refusal from Apple does not abort the refresh. The reason goes to the progress page's log, the other apps go on,
  and the app that lacks its profile fails as the shell reports it. An ended Apple session is different: it stops the
  refresh with an alert, as a session error does everywhere else.
- A recorded app already deleted from the phone still gets its App ID made once. The shell only drops its record
  during the refresh, and only the shell knows what is installed, so the page cannot tell in advance. Not avoided.

## Failed attempts
None.

## Tests run
- `node --test` on `web/app/core/freeroute.test.js`, `web/app/screens/resign-freeappid.test.js`,
  `web/app/screens/queue*.test.js` and `web/app/signing/freeappid.test.js`: 105 passed, 0 failed.
- The two new tests in `web/app/screens/resign-freeappid.test.js` cover Re-sign (the lapsed App ID is made and its
  profile handed in before the sign) and Re-sign All (made and handed in; nothing made without a session of the same
  team; an ended session ends it).

## Not verified
- Nothing was run on the iPhone 15 Pro, and nothing against Apple's developer portal. Reproducing a lapsed App ID needs
  one that is 7 days old.
- Whether Apple accepts adding an identifier again while the expired one is still listed is assumed, as the existing
  `ensureAppId` already assumes it.
