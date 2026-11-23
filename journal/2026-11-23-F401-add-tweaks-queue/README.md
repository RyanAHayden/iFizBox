# F401: Add Tweaks Queues the App

ADD on an app's Add Tweaks page now queues that app with the tweak, so the next sign of the app includes it. The
Add to App button on a tweak opened from there goes straight to that app and opens its queue, with no app picker.

## What was done

- `web/app/screens/addtweaks-queue.js` (new): `queueTweak`, `unqueueTweak` and `addToThisApp`. ADD calls `queueTweak`,
  Remove calls `unqueueTweak`, and Add to App calls `addToThisApp`.
- `web/app/core/appqueue.js`: a queued job carries `tweaks`, `tweaksOf`, `forTweaks` and `noTweaks`, and `setTweaks`
  sets its tweak list. Queuing the app again keeps its tweaks, and the job is then no longer only for them.
- A Custom Install's own tweak list gives way to the kept tweaks, so the two do not disagree on one run.
- `web/app/screens/altstore.js` `appPageJob` and `web/app/screens/myipas.js` `libraryInstallJob` give the page's
  install job, with the page's own questions: the original-app warning and the replace-app alert. Cancel keeps the
  tweak and queues nothing. An unreachable IPA or Signing Server also keeps the tweak and queues nothing.
- `web/app/screens/browse.js` `addTweaksContext(route)`: the Add Tweaks page's app context, read from its route. The
  page reloads on `onPageShow`, so a queue change shows when swiping back.
- Confirm shows "with <tweaks>" under the app name, e.g. "Re-sign Delta with Fixture Tweak".
- `addDebTo` and `dropItem` run one at a time per app. Two quick ADDs on the same app could otherwise lose one.
- Removing the last tweak of a queued re-sign sends empty tweaks, so the shell drops them from the run.
- Decision: while a run is going, its job notes the tweak (signed in when the app isn't signed yet, else the next time)
  and Remove never takes it out of the run; Add to App then says Tweak Added.
- After the spec review: the app picker's Add to App names its tweak in Confirm too, and a Custom Install queued over
  the job keeps only the tweak names that are in its own list.
- From Files and from Browse Tweak Sources, rows do not queue. Nobody asked for it.
- `web/app/screens/addtweaks-queue.test.js` (new, 14 tests), with `release-notes/F401.md`: one sentence for the user.
- `journal/2026-11-23-F401-add-tweaks-queue/`: this file, `capture.mjs` (from the B361 journal), `mk.py` (writes the
  `ios6.json` and `ios26.json` scripts), and the PNGs. The Chromium repo is the B361 journal's `repo/`.

## How it was checked

- `node --test` on `addtweaks-queue.test.js`: 14 tests pass.
- Chromium with the fake bridge, sideload build, ios6 and ios26 styles, repo on `127.0.0.1:8861` and `web/app` on
  `127.0.0.1:8862`:
  - ADD shows the Q'd badge with no sheet.
  - The tweak page's group row and nav bar Add to App open Confirm: "Re-sign Delta with Fixture Tweak".
  - A swipe back shows ADDED.
  - Remove drops the job and the badge (iOS 6).

## What failed along the way

- The first `mk.py` had a bracket typo.
- The first paid test reused a `.deb` kept for the session, so it needed its own package.

## Not verified

- A real re-sign, and the iPhone. The task did not need them.
- Remove on iOS 26 in Chromium. The sheet is the native `ui.menu`, with no fake. Unit tests cover it.
- The not-signed install path in Chromium. Unit tests cover it.
- Pages mounted from Home in Chromium. Unit tests cover the routes.

## Known

- The install popup shown before (Install > Add Tweaks…) still asks again after Back.
