# B394: self-update waits on "Waiting for iOS" and closes too late

Updating iFizBox through the Signing Server stayed locked on "Waiting for iOS" while iOS's prompt was up, and iFizBox
closed only after the whole download. A Cancel left the page locked for 120 s before it said the update didn't start.

## Method

- 15 Pro, iOS 27.0.1, under its lock. Build with the version lowered to 0.25.0, updating to 0.26.0.
- Watched through iOS's syslog, `wrangler tail` for the Worker, and the progress page's states through Web Inspector.
- Chromium can't show iOS's prompt or installd, so none of the iOS side was taken there.

## What iOS does (before the fix, iFizBox in front)

- The link opened at 28.40; the manifest was fetched at 28.62.
- Install was tapped at about 34.6. HEAD `app.ipa` at 34.71; iOS registered the install at 34.87 and asked RunningBoard
  to terminate iFizBox at 34.89. Refused ("higher termination resistance"), because iFizBox was in front.
- iOS carried on anyway: GET `app.ipa` 34.98 to 35.18. The shell said waiting at 33.6 (prompt plus 5 s grace),
  downloading at 35.8, finished at 37.96, then exit. The install landed.
- So from tap to exit was about 3.9 s. iOS does not need iFizBox out of the front to download, only to finish placing
  the app.
- From Home with the prompt up: the prompt stays over Home. Install 48.0, HEAD 48.1, GET 48.3. iOS itself ended
  iFizBox within 4 s; the update landed and our `finished` was never needed.
- The background shell kept polling (KeepAlive), nothing missed.
- iOS's prompt does not make iFizBox resign active while it is up. Resign and active come together only when the
  prompt is dismissed (logged at 28.939 and 28.954).
- Cancel before the fix: the page stayed locked on "Waiting for iOS" for 120 s (00:22:42 to 00:24:42, then notStarted).

## Marks

- Measured from the desktop against sign.ifizbox.com with a throwaway dummy upload. `status` showed each mark within
  0.3 to 1.6 s of iOS's request. No cached or lost mark was reproduced from one colo.
- But all marks shared one KV key, written read-modify-write within a second. KV allows one write a second per key,
  so one mark could be lost. Now each mark has its own key.

## The reported state

- "manifest true, started never" reproduced with Low Data Mode on the Wi-Fi: Install, then HEAD (not marked before),
  then a second alert, "Low Data Mode is On. Do you still want to download?". No GET until it is answered. Its Cancel
  ends the install ("Explicitly denied for low data network - canceling installation").
- The same state also comes from a cancelled or unanswered prompt.
- Which of these the user's phone hit isn't known.
- Not reproduced: any case where leaving the front was itself what let iOS start the download.

## Fix

- Closes at `started`, not at `asked`: `asked` can still be cancelled by the second question.
- The status is `{manifest, asked, started, finished}`, each mark in its own KV key. Polling starts when the prompt
  opens: every 1 s for 30 s, then every 2 s, for the link's whole 10 minutes, then notStarted.
- 8 s after the prompt opens with no start, the page unlocks with a hint, Try Again and Return. It keeps following, so
  a late start still turns it to closing.
- Try Again (or starting the same update again) signs again but reopens the link of the copy already uploaded (same
  IPA, options, certificate and server, link with more than 30 s left). Nothing is uploaded twice.
- Leaving iFizBox during the upload: the prompt opens once iFizBox is in front again.
- Files: `worker/src/index.js` (the marks), native `Sideload.swift` (`CloseForUpdate`, `hostAndOpen`) and
  `SignAhead.swift` (log only), web `signing/selfupdate.js`, `screens/apprun.js`, `core/apprun.js` `summaryLine`,
  `nav/progress.js` titles, `signing/route.js` banner wording, and the tests that go with them.

## After (15 Pro, every update landed as 0.26.0 with no hand-closing)

- Production server, in front: prompt dismissed at 28.94, close decided at 29.35, exit at 29.93. That is 1.0 s from
  the dismissal, was about 3.9 s from the tap.
- Node server with the new Worker code over `tailscale serve`, in front after a Try Again: exit 36:05.5, HEAD 36:04.1
  (1.4 s).
- Home with the prompt up: closed itself, landed.
- Left during the upload: "uploaded in the background; the prompt opens once in front". Prompt on return, Install,
  exit 1.0 s after the dismissal, landed.
- Cancel: hint, Try Again and Return 8 s after the prompt opened (visible in under 2 s of a late Cancel).
- Try Again used the same token: two manifest fetches of one link, no second upload.
- Low Data Mode: asked line shown, then the hint, then the second alert cancelled. iFizBox stayed open with Try Again.
  Try Again, Install, Download, exit 1.9 s later, landed.
- Low Data Mode, installRoute and the Signing Server setting were put back on the phone.

## Decisions

- No private suspend call. Nothing showed iOS needs one, so the hint says to go to the Home Screen instead.
- The old downloading and stalled states, and their hint, are gone: nothing waits for the download any more.
- The Worker files are outside the brief's list, but `asked` lives there, so they changed.
- An install whose download fails after iFizBox has closed is reported by iOS, not by iFizBox.

## Review (spec axis)

- Fixed: a stale test_updates check; the reused link's old `asked` mark no longer speaks for the new try; Try Again while
  another row installs says why it can't; the last upload is kept in UserDefaults (dropped once iOS begins the download),
  so a force-close doesn't cause a duplicate; an expired link fails instead of opening; the single install says "Sent to
  iOS", not "Done"; stale comments.
- Phone check after these (production server): prompt cancelled, iFizBox killed and reopened, the same update again:
  "already on https://sign.ifizbox.com from the last try: asking iOS again, nothing uploaded", Install, closed by itself,
  0.26.0 landed.
- Kept: a link in its last 30 s isn't reused (it would die before Install); KV's cached misses can't be bypassed (below).

## Not verified

- The exact cause on the user's phone (the two candidates above).
- The new Worker on Cloudflare itself: a task branch isn't deployed. It was tested with `worker/node.mjs`, and the
  production server was used for the in-front run.
- KV mark latency across colos. A mark could still show late, up to KV's cache time, if iOS's and iFizBox's requests
  land in different colos.
- With an undeployed server `asked` never comes, only `started`. That was tested OK against production.
- The wording for an expired link (left over 9 minutes during the upload) and for a busy run was not shown on the phone.
- Cellular's size question, and iOS versions before 27.
