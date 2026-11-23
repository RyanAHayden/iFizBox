# B367: dark action-sheet Cancel goes down when held

Found in B350: in dark mode the Cancel button in action sheets kept its resting fill while held. The red buttons
were fixed in B350; Cancel was left out.

## Cause

- `packages.css`: `html[data-theme="dark"] .action-button.cancel` set `background: var(--dk-action-cancel)`. That
  rule outweighed `.action-button.cancel:active, .action-button.cancel.is-pressed`, so a held dark Cancel showed
  its resting fill. This applies to iOS 6 and to iOS 7, 13 and 26, through their `--dk-action-cancel` tokens.

## What changed

- `packages.css`: the dark rest rule is now `html[data-theme="dark"] .action-button.cancel:not(:active):not(.is-pressed)`,
  the same way B350 fixed the red button. A held dark Cancel now uses each era's `--action-cancel-pressed`:
  - iOS 6: the slate gradient already in `packages.css`. The 4S's `UIAlertSheetBlackButtonPressed` art in
    `ref/4s/hd` is that same slate, and there is no `UIAlertSheetBlackCancelButtonPressed` art, so no new token.
  - iOS 7: `#2c2c2e`.
  - iOS 13 and 26: `#3a3a3c`, lighter than rest, like the plain dark buttons.
- `web/app/destructive-press.test.js`: new test that checks the dark Cancel rest rule carries the
  `:not(:active):not(.is-pressed)` guard and that the bare rule is gone. `node --test web/app/destructive-press.test.js` passes (4 tests); the whole suite runs in the gate.

## Check

`journal/2026-11-23-b350-destructive-held/harness.html`, shot the way its `shots.sh` does, at 2x, dark only. `sheet.png`: rows iOS 6, 7, 13, 26; columns dark resting,
dark held (`pressed=1`). Cancel changes in every era.

## Not verified

- On a phone: Chromium covers the CSS. AGENTS.md says phone only when Chromium cannot check.
- iOS 6 dark held Cancel is lighter than its black rest, not darker. This was chosen because the 4S's black-sheet
  pressed art is the slate. There is no dedicated cancel pressed art to compare against.
- Light tones were not re-shot, because the light rules were not changed.
