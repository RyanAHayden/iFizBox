# B342 Add to App re-signs the app with the tweak

**What changed.** `addToApp` (web/app/screens/tweaks.js) used to keep the .deb and alert "Tweak Added … goes into
<app> the next time it's signed". Now, after the pick and `addDebTo`, it looks up the app's signing.installed record
(`signedRecordFor`: by bundle ID or `originalBundleId`, since kept tweaks live under the original ID) and queues
`resignJob(record)` through `queueApp`, the same path as Installed's Re-sign and `runTweakUpdates`. The sign-ahead
run prepares a record re-sign with `{ record: job.id }`, and `keptTweakParams` sends the kept tweaks because they now
differ from the record's `tweaks` list, so the tweak goes in. No alert: Confirm and the queue's progress take over.

An app with no record here (a My IPAs file never signed, the website, a record from core/installed.js without a
signature on this phone) keeps today's save, with an alert that says why it can't be re-signed now.

Footers in the Add Tweaks group and page lost "the next time it's signed": they now say the tweaks go in "when it's
installed or re-signed" (those ADD buttons still only keep the tweak; the brief only asked Add to App to queue).

`core/appqueue.js` and `screens/installed.js` were on the file list but needed no change: `resignJob` already takes
a signing.installed record.

**Tests.** New `web/app/screens/tweaks.test.js`: Add to App queues `resignJob(rec)` for the picked app, no alert,
and that job's re-sign params carry the tweak (`keptTweakParams`); the no-record path alerts with the reason and
queues nothing; `signedRecordFor` matching. Existing addToApp tests (tweaks-source, tweaks-paid, tweaks-library)
pass unchanged: they give no records, so they take the save path, whose title is still "Tweak Added".

**Tried and failed.** The first version of the new test passed no ElleKit: `keptTweakParams` refuses a substrate tweak
without it; the test now passes the ellekit fixture, as tweaks-app.test.js does.

**Spec review.** It found two real problems, now fixed and tested. First, picking a copy by its own ID kept the tweak
under that ID, but `keptTweakParams` reads `originalBundleId`, so the re-sign would have left it out. When a record
exists, the tweak is now kept under the record's `originalBundleId`. Second, a copy that shares `originalBundleId`
could be matched ahead of the app the user picked. `signedRecordFor` now tries an exact `bundleId` match first. The
review also noted that re-adding a tweak the app already has still queues a plain re-sign. That one is left as it is:
the re-sign is harmless and is what the person asked for.

**Not verified**
- On a phone (the 15 Pro, sideload build): Add to App from a package page opening Confirm and the re-sign installing
  the app with the tweak. Not run: this session had no phone step in its brief and the unit tests cover the wiring;
  the native re-sign path itself is unchanged and already used by Tweak Updates.
- The website's older one-at-a-time run (`resignApp` in screens/queue.js) doesn't call `keptTweakParams`; on the
  website there are no signing.installed records, so Add to App takes the save path there and never reaches it.
