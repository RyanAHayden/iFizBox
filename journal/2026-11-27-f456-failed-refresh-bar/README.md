# F456: failed refresh shows in the reload bar

## What I did
- `web/app/nav/reloadbar.js` has `showReloadFailure([{title, detail}], {text})` and `bar.add()`. When a run ends, the
  running bar turns into the failure line and hides after 6 s. Show Info opens `openFailureLog` in
  `screens/apprun.js` (steps, then each failure in red).
- `core/refreshfailures.js` turns refresh results into that list.
- Wired to: Sources, Changes, Home and launch refresh; the first load of a new source (`screens/sources.js`); the
  website's `reloadSources` and the Changes list load (`screens/changes.js`); and repos whose packages don't load or
  parse in the catalog (`catalog.js` `loadFailures`/`onLoadFailed`, and `app.js`).
- Decisions:
  - The jailbreak app's "Source Failed to Refresh" banner after a Sources refresh (`bannerFailed`) and the Error alerts
    on a failed refresh are replaced by the bar. The user asked for one place for background errors.
  - Cancel drops the collected failures.
  - Sheets still cover the bar, as before, so a failure while a sheet is up can time out unseen.
  - If the Changes list fails to load with nothing loaded before, the page stays empty under the bar.
  - Per-source Sources-tab badges are unchanged.
  - No new CSS: Show Info reuses Cancel's button class.

## Checked
- Chromium via `capture.mjs --mode sideload` with the fake bridge. I added a local AltStore source, deleted its file,
  and tapped Refresh. Shots: `bar.png` and `log.png`. `script.json` holds that run's steps with scratch paths; the
  capture copy adds an `unlink` step and a `doc:` tap prefix. Web app served on 127.0.0.1:8764, source on 8765.

## Tried and failed
- The first run's taps missed the nav bar button, because the tap looks only in the top page.
- The first catalog wiring put the new module into app.js's startup closure and broke the module-count test, so
  `loadFailures` lives in `catalog.js`.

## Follow-up callers (not done)
- `screens/extras.js` `addSourceAndInstall` still shows `failedBanner` for other sources' failures.
- `app-updates.js` (App Store lookups) and icon fetches fail silently.
- The background update watch (`updates.watch`).
- `screens/sources.js` `retrySource` has its own row and page; probably leave it.

## Not verified
- No real device, iPhone or jailbreak app. Chromium covers this web-only change. Jailbreak apt failures were checked
  only in node tests and by reading the code.
- Other eras' looks (iOS 7/13/26) and dark mode were not screenshotted. They use the same bar and button classes.
- The catalog load/parse failure and the Changes list load failure were not forced in Chromium. Unit tests cover only
  the filter and `refreshInBar`.
