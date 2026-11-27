# B502a2 Pinned profile: no Keep Bundle ID switch

## What I did
- `web/app/signing-sheet.js`: when `signing.inspect` answers `pinned: true`, the Keep Bundle ID group (switch, notes,
  guide link) isn't added and `originalState` isn't asked. The sheet's edits and what is sent are unchanged: `keepBundleId`,
  as `signing.inspect` answered it (false when pinned), still goes with the job. `openSignSheet` is now exported for the test.

## Checked
- `node --test web/app/signing-sheet.test.js` passes (11 tests; the new one drives the real sheet on the fake DOM).
- Headless Chromium with a scratch harness and fake bridge: the pinned answer has 0 "Keep Bundle ID" in the DOM and the
  screenshot shows no switch; a non-pinned answer still has it. The harness loaded only `style.css` and `ios6.css`, so
  the nav bar in the shot isn't laid out properly. That is the harness, not judged.
- After this revert the node test passes again (11 tests, 0 failing).

## Left as is
- The Install As footer still says the bundle ID can be changed "to install a second copy" on a pinned profile. It is
  outside this task (not one of the switch's notes). Whether a typed ID gets its own App ID depends on a kept per-app
  profile (`docs/signing.md`, "Per-app profiles").
- On a pinned profile the unshown `keepBundleId` false still goes with the job and, through `customInstallSave`, can be
  saved as the IPA's Sign Options although the user chose nothing. Filed as a follow-up, B505.

## Not verified
- No real device (iPhone 15 Pro) check with a free Apple ID. The change is page-only and Chromium covers it.
