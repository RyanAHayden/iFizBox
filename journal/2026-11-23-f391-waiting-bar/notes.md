# F391: waiting bar

Built option A of concept K6 (branch `concept/waiting-bar`). B and C, `concept-demo.js` and its `app.js` import are left out.

## What I did

- `rowBar()`'s `set()` takes `waiting` and toggles `is-waiting` on the bar. `.qr-wait` overlays it (`progress.css`).
  Only transform and opacity move, so it stays cheap. Under reduced motion it is still stripes, not frozen.
- The status text is `rowStatus` in `core/apprun.js` (the task called it statusText). A waiting signed row says
  "Signed: Waiting to Install".
- Native controls hook (iOS 26): a `<progress>` draws no children, so the bar is now in a `.qr-native` wrapper with
  the stripes over it. The `<progress>` fades out while waiting.
- iOS 7: `clip-path` counted as layout in the C44 era-stylesheet test and failed it. Replaced with a 2px-high
  background.
- Jailbreak helper rows in state `signed` keep "Waiting" and no stripes, as they aren't signed.

## Checks

- `node --test`.
- Chromium, `tools/concept/check.mjs` on the concept's demo run: iPhone SE, iOS 6/7/13/26. Native hook forced on for a
  second iOS 26 run. `eras.png` is here.
- Status is one line (16px) on all rows at 375px.
- check.mjs reported 12 FAILs on its tab-tap and Home checks, and more of the same on the native run. Attributed to
  the demo run page covering Home plus `--tap` body. No app errors logged. The attribution is not confirmed.

## Not verified

- The bar over WebKit 26's real `<progress>` on a phone. Chromium stands in. The 4px stripe height assumes WebKit's bar
  height.
- Width under 375px not shot. The text is short and wraps if needed.
- Reduced motion not shot.
