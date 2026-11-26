# B481: the app's checklist said "Reused this browser's certificate"

## Goal
In the sideload app the Free Apple ID checklist's Certificate row said "Reused this browser's certificate". The app has no
browser. The saved record came from the app or from a computer install, so the wording was wrong there. Filed as B481
(`low`) in B478.

## Done
- `web/app/core/freeroute.js`: new `reusedSummary(app)` returns "Reused the saved certificate" when `app` is true, else
  "Reused this browser's certificate". `runSetup` takes an `app` option (default false) and passes it to the certificate
  step, which uses `reusedSummary` for the reuse summary.
- `web/app/screens/free-apple-id.js`: `runSetupOnce` passes `app: !!ctx.native`, the same switch `APP_FOOTERS` uses.
- The website keeps "Reused this browser's certificate". Only the app's wording changed.
- `web/app/core/freeroute.test.js`: new test "setup: in the app the reuse summary names no browser". It runs the reuse
  path with `app` true and with `app` false and checks both wordings.

## Test
`node --test web/app/core/freeroute.test.js web/app/screens/free-apple-id.test.js`: 42 pass.
`tools/check.sh` runs at done.

## Tried and failed
Nothing.

## Not verified
- Not seen on the iPhone 15 Pro. This is a wording-only change covered by the unit test. The row text comes straight from
  the summary. A phone run would need a fresh Free Apple ID setup with a saved certificate.
