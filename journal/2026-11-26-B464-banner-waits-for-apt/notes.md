# B464: Banner waits for apt

## What
- Problem: the jailbreak build's "<name> X is out." banner (`web/app/essential-ui.js`, `bannerOnce`) read GitHub's latest
  release. Changes' Upgrade (N) and the banner's Upgrade (`screens/changes.js`, `upgradeSelf`) use apt's
  com.ryha.ifizbox row. When apt's lists lacked X (the repo published after the release, or no refresh since), the
  banner showed, Changes had no Upgrade, and the banner's Upgrade waited 20 s, then opened an empty Changes.
- Fix, in `web/app/essential-ui.js`: new exported `aptHasSelf(v)`. It reads `catalog.upgrades` with Ignored Upgrades
  (settings holds + blocked, as Changes reads them) and is true only when the available list has iFizBox's row at `v`
  or newer (apt version compare).
- `bannerOnce` is now exported with injectable deps. In jailbreak it shows the banner only when `aptHasSelf(v)`.
  Otherwise it subscribes once to `catalog.onLoaded` (one wait at a time) and looks again after the next catalog load
  (e.g. a refresh). The sideload path is unchanged.
- Tests: new `web/app/essential-ui.test.js`. `aptHasSelf` cases: same, newer and older version, other package, empty
  list, throwing catalog. Jailbreak with no row: no banner, one listener, a refresh without the row waits again, a
  refresh with the row shows once. Row present: immediate. No newer release: catalog not asked.
- Passes with the related suites: self-upgrade, screens/upgradeself, signing-client-selfupdate, core/essential (37 tests).

## Checked
- Node tests with fakes, as above.

## Tried and failed
- Nothing.

## Not verified
- Not run on the iPhone 7 (jailbreak app). The logic is pure JS covered by node tests with fakes. A real-device check of
  an actual release whose apt repo lags GitHub would need such a release, which cannot be staged safely.
- `catalog.upgrades` itself waits for the first catalog load (`catalog.js` ask -> ready()). That only delays the banner;
  not verified on a device.
