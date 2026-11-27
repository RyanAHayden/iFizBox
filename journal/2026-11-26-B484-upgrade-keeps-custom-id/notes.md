# B484 Upgrades keep an app's custom bundle ID

## What it does now
- An app installed under a custom bundle ID (Custom Install changed it, e.g. `com.me.x` from a source that lists
  `com.x`) upgrades under that same ID. It does not install a second copy under `com.x`.

## What was already right
- Re-sign keeps the custom ID: B358 made `signing.resign` use the signed record's bundle ID, and `recordOf` matches
  the installed ID first.
- Finding the upgrade was right for the usual case: the Installed record from a queued Custom Install is kept under
  the source's ID (`screens/queue.js` `recordApp` uses `job.id` = `com.x`). So `app-updates.js`
  `rememberedUpgrades`/`candidates` find the source's newer version and Changes lists the row.
- `siteInstallArgs` already leaves the bundle ID out for a renamed job.

## Where the ID was dropped
- The upgrade job from `screens/changes.js` `queueUpgrades` and from the app page (both via `core/appqueue.js`
  `appJob`) carries only the source's `bundleIdentifier` and no Sign Options. Both runs signed it as `com.x`:
  `runAppQueue` -> `installApp` -> `installOnDevice`, and the sideload app's sign-ahead `runAppQueueRun` ->
  `signing/queue.js` `prepareParams`. That made the second copy.

## What changed
- `core/appqueue.js`: `installedIdFor(job, signedApps)` and `withInstalledId(job, { signed, saved })`. For an
  installed app's upgrade, reinstall or downgrade with no Custom Install options of its own, when the shell's signed
  record (`signing.installed`) has `originalBundleId` = the job's id and a different `bundleId` (and no signed copy
  under the job's own id), the job gets `options.edits.bundleId` = the installed ID and `signsAs`. If a saved IPA
  for that ID is in My IPAs (F379), its Sign Options (name, icon, ...) are applied too.
- `screens/queue.js`: `withInstalledIds(jobs, { native })` reads `signing.installed` (and `library.list` only when
  needed) and both runs apply it before signing. The website (no shell) and a failing call leave the jobs as they were.
- The job id stays `com.x`, so the queue and Installed's record are unchanged.
- Side effect, on purpose: the job now has options, so like a Custom Install its new IPA is saved in My IPAs
  (`customInstallSave`). Re-sign's saved-IPA path then gets the new version.
- Test: `core/appqueue.test.js` "B484: ...": an app recorded as `com.me.x` from `com.x` makes an upgrade job that signs
  as `com.me.x` in `customParams`, `prepareParams` and `runAppQueue`. The 1289 tests in `screens/queue*`, `apprun*`,
  `appqueue` and `core/*` pass.

## Edge
- With Keep Bundle IDs off and an explicit (non-wildcard) profile, a plain install's signed record already differs from
  the original (the profile's App ID). The upgrade then sends that same ID explicitly. It signs to the same ID
  (`Profile.bundleID(for:)` is idempotent), but its IPA is also saved in My IPAs.

## Review decisions
- Kept in scope: Reinstall and Downgrade get the installed ID too. They sit on the same Modify sheet as Upgrade and
  would also install a second copy. The saved IPA's Sign Options come along as well (the brief lists saved Sign
  Options on the upgrade path), so a renamed app keeps its name. They are matched by installed ID, not by version.
- A job that already has Custom Install options stays as it is: the person chose in that sheet.
- The website has no shell and no signed records (`signing.installed`), so its jobs stay as they are. A website install
  cannot be under a custom ID that the shell knows about.
- Each upgrade saves its new version's IPA in My IPAs, as a Custom Install at that version would (`saveInstalledIpa`
  skips one already saved at the same bundle ID and version).

## Not verified
- No phone run (iPhone 15 Pro) of a real custom-ID upgrade. The change is in the web layer's job params and node tests
  cover it fully. The native side already honours `bundleId` in `signing.install` / `signing.prepare` (SignOptions init).
- Not handled: a record kept under the custom ID itself (written when Installed adopts a signed app,
  `core/installed.js` `sourceRecordFor`) never gets an upgrade row, because `candidates()` looks up `com.me.x` on the
  source. Filed as B489.
