# B502a2 Pinned profile: no Keep Bundle ID switch

## What I did
- `web/app/signing-sheet.js`: when `signing.inspect` answers `pinned: true`, the Keep Bundle ID group (switch, notes,
  guide link) isn't added, `originalState` isn't asked, and no `keepBundleId` goes into the sheet's edits, so none is
  sent or saved with the job. `openSignSheet` is now exported for the test.

## Checked
- `node --test web/app/signing-sheet.test.js` passes (11 tests; the new one drives the real sheet on the fake DOM).
- Headless Chromium with a scratch harness and fake bridge: the pinned answer has 0 "Keep Bundle ID" in the DOM and the
  screenshot shows no switch; a non-pinned answer still has it. The harness loaded only `style.css` and `ios6.css`, so
  the nav bar in the shot isn't laid out properly. That is the harness, not judged.

## Left as is
- The Install As footer still says the bundle ID can be changed "to install a second copy" on a pinned profile. It is
  outside this task (not one of the switch's notes). Whether a typed ID gets its own App ID depends on a kept per-app
  profile (`docs/signing.md`, "Per-app profiles").

## Not verified
- No real device (iPhone 15 Pro) check with a free Apple ID. The change is page-only and Chromium covers it.
