# C68: BigBoss and Telesphoreo out of the default Tweak Sources

## What changed

- `web/app/tweak-sources.json`: removed Telesphoreo (`http://apt.saurik.com/`, `ios/1800.00 main`) and BigBoss
  (`http://apt.thebigboss.org/repofiles/cydia/`, `stable main`). Both are old rootful repos with nothing Lite can
  inject.
- Lite already seeded only the `"inject": true` entries (the GitHub app-tweak repos), so Lite's list is unchanged.
  The change shows in the other two places that read the APT entries: the jailbroken defaults (seeded as metadata in
  the jailbreak app; `nativeSourceCalls`) and the site's source list (`backend-http.js`). Both now start with Chariz,
  Havoc and Procursus. The task asked for that removal. Since the jailbreak app targets rootless iOS 15+, a rootful
  repo there gave a count of 0 anyway.
- Recommended / More Sources: `core/recommended.js` already leaves BigBoss out (it is a dist repo, which Recommended
  can't add), so nothing to change there. `core/safe-sources.js` keeps BigBoss as the task says.
- Tests that took BigBoss/Telesphoreo from the defaults now build those records themselves with `tweakSourcesFrom`
  (iconcache, sources), and the tests that list or count the defaults were updated (sources store order,
  sourcelist export and the Cydia list import, where Telesphoreo now reviews as `new`, tweaksources-lite,
  manage-insecure). tweaksources-lite now also checks that no BigBoss/saurik entry is a default, and
  manage-insecure checks that every remaining default is https.

## Checks

- `node --test web/app`: 3289 pass, 0 fail.
- `tools/check.sh` runs through `run done`.

## Not verified

- A store that was seeded before this change still has BigBoss/Telesphoreo (seeding happens once, and a default
  stays until the user deletes it). This is by design. Nothing removes them from existing installs, and that is
  not checked on a device.
- No device or deployed-site check: the change is a data file that the site serves, so it takes effect at the next
  site deploy, which the runner publishes.
