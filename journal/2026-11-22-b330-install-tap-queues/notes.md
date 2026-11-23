# B330: Install taps straight into the queue, the options on a hold

## What changed

- `web/app/screens/browse.js`: the package page's nav button now runs `installTap` on a tap and `installHold` on a
  hold (was `packageActions` / `installVersionHold`).
  - `installNoModify(page)`: the button is Install for an apt package (not installed, not an app, not Add to App).
  - `installTap`: for such a package with an install queue, queues `{ op: install, id, version: <page's version> }`
    (the same job the options sheet's Install queued); the queue's add opens the Confirm sheet. Anything else
    (Modify, an app's Install, Add to App, a paid package, the website without a queue) runs `packageActions` as
    before.
  - `installHold`: for such a package, opens the options sheet (`packageActions`: Install, Other Versions, Add to
    Wish List...). Modify and apps keep F346's Install Which Version? hold.
- `web/app/app.js`: only the comment on `holdButton` (what a hold now does).
- Test: `web/app/screens/installtap.test.js`. `installhold.test.js` (F346) still passes unchanged.

## Choices

- Read "packages without Modify" as apt packages whose button says Install. Apps (IPA entries) already install on a
  plain tap (F80/F255/I5), so their tap and hold are left alone.
- A paid package (price on the button, or the vendor's Purchase steps) keeps its sheet on a tap: queuing it would
  skip the purchase. Its hold, when not installed, now opens that same sheet (F346's version sheet never opened for
  a package its vendor sells anyway).
- A paid check that fails (the vendor unreachable) counts as paid: the tap opens the options sheet instead of
  doing nothing or queuing past the purchase (found by the spec review).
- The website has no install queue, so its tap keeps the sheet (Install in iFizBox, Download .deb); nothing to queue.
- A package already queued: a tap queues it again, which reopens Confirm (core/queue.js add replaces the job).
  Clear stays in the hold's sheet.
- lazy.js (named in the task's files) needed no change: browse.js is loaded before its package page draws.

## Checked in Chromium (fake bridge)

`probe.mjs` (this folder): web/app as the jailbreak app in headless Chromium, a fake `ifizboxNative` with one local
source (`deb http://repo.test/ ./`) and two packages, com.ex.new (not installed) and com.ex.old (1.0 installed, 2.0
out). Real CDP mouse presses on the nav button, 80 ms for a tap, 900 ms for a hold. All 8 checks passed, no page
errors:

- com.ex.new (Install) tap: the Confirm sheet opened, no action sheet; the helper got `simulate com.ex.new=2.0`.
- com.ex.new hold: the options sheet (Install, Other Versions, Add to Wish List, Cancel), no Confirm.
- com.ex.old (Modify) tap: Modify's sheet (Upgrade, Reinstall, Ignore Upgrades, Ignore This Version, Remove, Other
  Versions) as before.
- com.ex.old hold: Install Which Version? (2.0, 1.0 (Installed)) as before.

Run: `node probe.mjs web/app <outdir>`.

`node --test` in web/app: 3239 tests, all passing.

## Not verified

- On a phone (iPhone 7 jailbreak app): Chromium with the fake bridge covers tap/hold and the Confirm sheet; the
  Confirm sheet's own apt run is unchanged code. AGENTS.md: phone only when Chromium can't check.
- The website in a browser: its tap path is unchanged code (`packageActions`), node-tested only via the "no queue"
  case.
- A paid package in Chromium: needs a vendor's payment endpoints; node test only (`paidState` stubbed).
