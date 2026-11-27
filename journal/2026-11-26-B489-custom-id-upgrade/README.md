# B489: upgrade for an app kept under its custom bundle ID

- app-updates.js candidates() now reads signing.installed (sideload app) and looks the source up by the signed
  record's originalBundleId (com.x) for a record kept as com.me.x. The row keeps id com.me.x and gains `sourceId`.
- screens/changes.js queueUpgrades builds the job from `sourceId` (job id com.x), so B484's withInstalledIds signs it as com.me.x.
- Test: app-updates.test.js shows the row and queues the job. The existing watch test now ignores the extra signing.installed call.

**Not verified**: on a phone (a real custom-ID install upgraded end to end); only node tests.
