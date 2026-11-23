# B377: System tweaks out of the catalog in Lite

## Why
In the sideload build (Lite), tweaks for iOS itself (Aerial, SpringBoard and other system-app tweaks) still showed
under App Tweaks, in Search and in the section counts. `core/catalog.js` loaded Tweak Sources filtered only by the
Section and Depends checks in `tweakfields.js` (`injectableFromFields`), which Aerial passes. The Tweak Index verdicts
(`systemOnly`, `ok: false`) were used only by Add Tweaks (`liteTweaks`) and `sources.js`, never by the catalog rows.

## What I did
- `web/app/core/tweakindex.js`: new `dropsFromCatalog(info)`. True when the verdict is `systemOnly` or refused, and
  false for a paid unverified guess. `null` (not checked) keeps the tweak.
- `web/app/core/catalog.js`: new `setTweakVerdicts({"id@version": true|false})`, which merges verdicts. A Tweak Source
  row with a true verdict for its exact version drops out of App Tweaks (`tweakEntries`' kept rows become `tweakRows`,
  so the section count follows), Search (unfiltered, App Tweaks, All Tweaks, by source) and that source's own list
  and sections. `package()` still opens it. A false verdict brings it back.
- `web/app/screens/tweaks.js`: `catalogVerdicts()` (the index answer plus this device's cached checks) and
  `onTweakVerdicts(f)`. `loadTweakIndex` fires it with each index answer, and `tweakInfo` fires it after a device check.
- `web/app/catalog.js` (the UI's handle, not in the task's file list, but needed to carry verdicts to the worker): in
  sideload mode, after loading Tweak Sources it hooks `onTweakVerdicts`, sends `catalogVerdicts()`, and asks the index
  for the Tweak Sources (not awaited). Pending verdicts go to the worker with the next question, like `setIpaInfo`.
- Test: `web/app/core/catalog-systemtweaks.test.js`. Fixture: a Tweak Source with Aerial (`systemOnly`), AnyFont
  (`anyApp`) and Aerial Fresh (unchecked), plus an index answer. Aerial is gone from App Tweaks, Search, the section
  count and the source list, and the others stay. A verdict for another version is ignored. One case runs the full
  path: `loadTweakIndex` to `onTweakVerdicts` to the catalog.
- Chromium check, in `journal/2026-11-23-b377-system-tweaks-catalog/`: `capture.mjs` (a copy of F382's, plus
  `FAKE_INDEX=<json>`, which answers `GET /api/tweaks` in the page), run with `--mode sideload`. A flat repo is in
  `repo/` on 127.0.0.1:8737, the web app on 127.0.0.1:8738, script `lite.json`.
  - `before/app-tweaks.png` (index answer disabled): Aerial, Aerial Fresh and AnyFont; search "aerial" gives Aerial and
    Aerial Fresh.
  - `after/app-tweaks.png` (answer from `index.json`): Aerial Fresh and AnyFont only; App Tweaks count 3 to 2; search
    "aerial" gives Aerial Fresh only.

## Tried and failed
- One test expectation on row order. Fixed.

## Not verified
- The live Worker index answering for a real source such as Havoc. The shots use a faked answer, and the 127.0.0.1
  repo is not reachable from the Worker.
- An open App Tweaks page does not redraw by itself when the index answer lands after it is drawn. The catalog change
  listeners fire, but the next visit or Search is correct.
- Not tried on the iPhone 15. This is a web-only change, and the Chromium check covers it under the phone rule.
