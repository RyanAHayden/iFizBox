# B376: iOS 13 Action Sheet Grouped

The bottom action sheet (Modify, Share and the others) drew each choice as its own rounded pill with iOS 6's 11px
gaps in the iOS 13 style. F387 found it while moving Share into the other eras, and filed it. The iOS 26 bottom
sheet, opened with no source button, had the same gap.

## What was done

- `web/app/ios13.css`: sets the action sheet geometry hooks as `ios7.css` does: `--action-sheet-pad 8px 8px`,
  `--action-sheet-pad-bottom 8px`, `--action-gap 8px`, `--action-list-gap 0`, `--action-list-bleed 0`,
  `--action-title-margin 0 0 -8px`, `--action-title-pad 14px 16px`, `--action-cancel-gap 0`. It also adds the grouped
  list rules: the choices form one block with 13pt corners, split by .5pt hairlines (`--i13-alert-line`). The title
  sits in the block's first cell in a button's colour (`--i13-action-cell`). Cancel is a separate 13pt box 8pt under
  the block. Each button draws its own .5pt top line, as in iOS 7, because Chromium at 3x drops a .5pt flex gap.
- `web/app/ios26.css`: the same values and rules, scoped to `.action-sheet:not(.action-menu)`, so the anchored menu
  (the sheet opened from a button) keeps its own padding and rows. The line colour is `--i26-alert-line`.
- `web/app/action-sheet-ios13.test.js` (new, 3 tests): the hooks and grouped rules in both eras, and that no bare
  `ios26` rule sets the sheet hooks. The first draft matched the wrong `html[data-style="ios13"] {` rule and was
  fixed to find the rule that holds the hooks.

## How it was checked

- `node --test web/app`: 3386 tests, 0 failures.
- Chromium headless, sideload mode, `web/app` served on `127.0.0.1:8376`, with `capture.mjs` and `sheet.json` (copied
  from F387). `shots/` holds `modify-ios13-light/dark` and `modify-ios26-light/dark`: a titled sheet ("iFizBox
  0.24.1": Reinstall, Downgrade, Remove in red) opened from script with no source button. `share-ios13-light/dark`
  show the Share sheet. All six show one grouped block with hairlines and a separate Cancel.

## Not verified

- A real iPhone. AGENTS.md says web checks are made in Chromium.
- The native-controls path (`data-controls="native"`). There the shell's own UIAlertController draws the sheet and
  this CSS does not apply.
- Button height. It is still 44pt. iOS 13's UIAlertController rows are about 57pt tall. The task did not ask for
  that, so it was not changed.
