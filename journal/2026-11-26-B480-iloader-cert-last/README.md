# B480: iloader's certificate listed above "iFizBox Website"

## Goal
The Free Apple ID Certificate Limit alert listed iloader's certificate above "iFizBox Website". Seen on the iPhone 15 Pro
in B478. The cause is that `otherTool()` in `web/app/core/freeroute.js` did not know iloader.

## Done
- `otherTool()` now also matches iloader, and checks the certificate's `name` as well as `machineName`. The alert in
  `web/app/screens/free-apple-id.js` shows `machineName`, else `name`. We do not know for sure which field Apple fills
  for iloader, so both are matched.
- New `revokeRank()` orders the offered certificates: ours first (`machineName` starts with the app name, so old
  "iFizBox test" certificates count too), certificates of unknown origin next, known other tools last. An unknown future
  tool therefore never goes above ours.

## Test
`web/app/core/freeroute.test.js` gets a case with iloader certificates (one matched by `machineName`, one by `name`), an
unknown one and ours. The offered order is ours, unknown, iloader, and only ours is revoked. Without the fix the order
stays as Apple listed it and the test fails.

`node --test web/app/core/freeroute.test.js`: 18 pass.

## Tried and failed
Nothing.

## Not verified
- The alert on the iPhone 15 Pro was not re-run. It needs Apple's account at its certificate limit with an iloader
  certificate. Revoking certificates on the shared spare Apple ID breaks other tasks' certificates. The unit test covers
  the order.
- The exact field Apple uses for iloader's name is not checked, hence both fields are matched.
