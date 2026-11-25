# F430: Sideload Hide

While apps install in the sideload app, Hide puts the run page away, so the rest of the app can be used. A strip under
the nav bar says how the run is going, or that an iOS prompt waits for a tap. Show brings the page back.

## What was done

- `web/app/screens/runstrip.js` (new): the strip, shared with `screens/queuerun.js`. Its Installed badge reset stayed in
  queuerun's `dropStrip`.
- `web/app/screens/apprun.js`: a Hide button on the running bar. The `put` flag (put away with Hide) is kept apart from
  Open Now's `putAside`, so `end()` only brings back the latter. `stripText` writes the strip's line. `keepSelfUp`
  shows the page and drops Hide when iFizBox's own row is installed or sent, or installd has it on This iPhone
  (`selfClosing`). With the own row already sent, a retry of another row has no Hide.
- Decision: no Hide for the jailbreak app's own run of apps only (helper rows). The task said Lite, and its end may
  wait for a respring tap.
- `appRunning` clears only on page close, so a second run stays blocked even when the first one ended hidden.
- `web/app/screens/apprun.test.js`: the one Cancel assertion changed; the running bar now has Hide.
- `web/app/screens/apprun-hide.test.js` (new).
- The website doesn't use this page: no change.

## How it was checked

- `node web/app/screens/apprun-hide.test.js`.
- Chromium: `script.json` run by `journal/2026-11-23-F401-add-tweaks-queue/capture.mjs --mode sideload`, fake lanes
  passed to `runAppRun`, iOS 6 style only. Shots `1-running.png` to `5-shown.png`.

## Second attempt

The first attempt (`wip/F430`) was not merged. `web/app/core/blocked.test.js` "Changes leaves a blocked package out"
failed on main too: it fixed its records at 2026-11-18 but let `dayGroups` use today's clock, and the 7-day window
dropped them at midnight on 2026-11-25. The work was brought back unchanged on current main, and the test now passes
`{ now }` to `dayGroups`. All 1351 screens tests pass.

The spec review added: iFizBox's own row on This iPhone brings the page back already when its copy ends (installd has
the IPA), and also when Open Now had put the page aside. Node tests only; the Chromium shots are the first attempt's.

**Not verified**

- Real installs on the iPhone 15 Pro (a web change; Chromium is enough).
- iOS 13 and iOS 26 style shots of the strip (its CSS is unchanged).
- An Open Now during the locked "Waiting for iOS" end hides that page with nothing to bring it back. This existed
  before and is unchanged; filed as B452.
