# B374: the Install popup's Add Tweaks opens the Add Tweaks page

The app page's Install popup (sideload build) had a "Tweaks: N" / "Add Tweaks..." button. It opened the old Add
Tweaks sheet (`openAddTweaks` in `web/app/screens/tweaks.js`, reached through `installTweaksChoice`). The sheet
couldn't be swiped back, and its tweak rows couldn't be tapped.

## What changed

- `web/app/screens/tweaks.js`: new `pushAddTweaksUntilBack(bundleId, { name })`. It pushes the F352 Add Tweaks page
  (`pushAddTweaks`, route `addtweaks:<bundle id>` under the current hash) and resolves true when the hash comes back
  to the app page, false when the viewer went somewhere else (another tab or link). While the viewer is on the Add
  Tweaks page, or on a tweak's page above it, it stays put. It also records the app's name for the page's headers.
- `installTweaksChoice` in the same file: its default opener is now `pushAddTweaksUntilBack`. After it returns, the
  popup asks again with the new count. When the opener returns false, the popup returns false: nothing is queued and
  the popup is not shown over another page.
- Removed from `tweaks.js`: `openAddTweaks`, `showPushedPage`, `backLabel` and `searchAllFooter`. Nothing else used
  them.
- Tests: deleted `web/app/screens/tweaks-addpage.test.js` and the `openAddTweaks` tests in `tweaks-app.test.js` and
  `tweaks-index.test.js`. The Add Tweaks page's own tests in `tweaks-addtweaks-page.test.js` already cover ADD/ADDED,
  failed check, More Tweaks and groups. Dropped two source-text asserts in `web/app/screens/tweakrow.test.js` that
  pointed at the old sheet's rows.
- New test in `web/app/screens/tweaks-app.test.js`: push, tweak page above, back gives true; going elsewhere gives
  false; the popup is not asked again when the opener returns false; `tweaks.js` no longer contains `openAddTweaks`
  or `showPushedPage`.

## Checks

- `node --test web/app`: 3377 pass, 0 fail.

## Not verified

- The push and back were not run in a real browser or on the iPhone 15 Pro. The hash logic was tested only in node,
  with a fake location and EventTarget. The Chromium shot rig was not run for this change.
- That a swipe back on the device gives exactly the app page's original hash is assumed from the router's history
  behaviour, not observed.
