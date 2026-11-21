# F351: Installation & Signing row icons, Install Apps With shows the chosen route

The approved concept (branch `concept/install-signing`, one commit), taken as a diff, not merged, then finished:

- `screens/installroute.js` `mainPage`: the Installation group is now the header "Install Apps With" with the chosen
  route as its one row: its icon, its name and one line under it (`ROUTE_ROW`: Signing Server, purple cloud,
  "iOS installs each app from <DOMAIN>"; This iPhone, the installation tile, "Straight onto this iPhone, no popup"),
  footer "Tap to choose how signed apps reach iOS." `showRoute` redraws label, subtitle and icon in place on every
  refresh, so a change of route follows without a new row. Certificate, Signed Apps and How Signing Works got
  their row icons (signing, websiteApps, help).
- `withDetail` now gives only This iPhone's Paired / Not Paired (empty for the Signing Server and while
  `idevice.status` hasn't answered): the route itself is the row's label.
- The Install Apps With page's two choices carry the same icons (`ROUTE_ROW[value].icon`).
- `icons/rowicons.js`: new `signingServer` tile (`C.purple`, `cloud`). iOS 7's set maps it through `TO_C7`
  automatically; other eras fall back to these sets.
- Tests: `installroute-f300.test.js`'s withDetail test updated; new `installroute-f351.test.js` (row labels,
  subtitles, icons, detail, in-place redraw across a route change both ways, the choice page's icons, the tile in
  both icon sets). All 2987 web tests pass.

## Chromium check

`capture.mjs` (copied from the B298 journal) with `--mode sideload` against `python3 -m http.server` of `web/app`,
script `main.json`, at DPR 3 (390x844 CSS px). Grids left to right: iOS 6 light, iOS 6 dark, iOS 7 light, iOS 7 dark.

- `main-server.png`: main page on the Signing Server route.
- `main-iphone.png`: main page on This iPhone, the fake shell's pairing answering Paired.
- `install-apps-with.png`: the Install Apps With page's two choices with their icons.

Tried first: `tools/concept/check.mjs --route '#/settings/signing'`: the route didn't take (the app stayed on
Home, probe empty), and its unrelated failures (an iOS 7 Home-tab redraw check, no `ios7:dark:black` theme
name) aren't this task's. Switched to capture.mjs for the shots.

## Not verified

- Real devices (15 Pro, iPhone 7): not needed for a web-only row change; Chromium at 3x covered the look.
- iOS 13 and iOS 26 eras: not shot; they have no icon set of their own and fall back to iOS 6's tiles
  (`icon()` in rowicons.js), which the new test draws for every era.
- Palettes beyond the default light/dark per era (textured themes): the tile is an image with its own colour, the
  same as every other row tile, so palettes don't change it; not shot.
- The Upgrade banner covering the status cell in the shots is the fake shell's update offer, unrelated.
