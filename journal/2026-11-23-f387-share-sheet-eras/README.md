# F387: Share Sheet in the Other Eras

Concept K5, option C: the iOS 7 and later styles open Share as their own menu, not the iOS 6 activity sheet. Each
app's icon sits in front of its label, as the iOS 7, 13 and 26 share menus show it. B371 found the share sheet was
the last part still drawn in the iOS 6 look in every era.

## What was done

- `web/app/nav/sharesheet.js`: `shareLayout()` reads `--share-layout` from the root element. `grid` (the iOS 6
  default) builds the activity sheet as before. `action` hands the items to `showActionSheet`: each item's label is a
  button with its share icon (the same `iconOf` icon) in front, and Cancel sits under them. An item's `onSelect` runs
  inside the tap. In the iOS 26 style, the sheet opened from the Share button is the anchored menu, so Share grows
  out of the button.
- `web/app/nav/actionsheet.js`: two options. `icons: [element|null, …]` puts an element in front of each label (the
  button gets `has-icon`, and its children are `.action-icon` and `.action-label`). A sheet with icons always takes
  the CSS sheet, because the shell's native UIAlertController draws no icons. `onPick(i)` runs inside the tap, before
  the answer (-1 for Cancel, the dim and Escape).
- `web/app/style.css`: the hooks `--share-layout` (grid) and `--share-row-icon`, `--share-row-radius`,
  `--share-row-glyph`, `--share-row-letter`, `--share-row-gap`, `--share-row-pad`, `--share-row-dir`,
  `--share-row-justify` (iOS 6 values), and the rules for `.action-button.has-icon` that read them.
- `web/app/ios7.css`, `ios13.css`, `ios26.css`: `--share-layout: action` and each era's row values.
  - iOS 7: 29px icon, 6.5px corners, 15px gap, pad 0 15px.
  - iOS 13: 29px icon, 7px corners, 14px gap, pad 0 16px.
  - iOS 26: 24px icon, 6px corners, 12px gap, pad 0 18px, icon at the row's end (`row-reverse`, justified
    `space-between`), so the label comes first as in a UIMenu row.
- `web/app/ios6.css`: `--share-line-copy` and `--share-line-qr`, the Copy and QR glyphs as grey (#8e8e93) line art.
  The eras set `--share-glyph-copy` and `--share-glyph-qr` to them, and set the share icon tokens flat: no gloss,
  shine or emboss, a white tile with a hairline in Light, dark grey in Dark.
- `web/app/nav/sharesheet-eras.test.js` (new, 5 tests): the layout per era and the row hooks.
- `docs/eras.md`: the hooks in the geometry table, the share sheet's look tokens, and its component row.
- `journal/2026-11-23-f387-share-sheet-eras/`: `capture.mjs` and `sheet.json` (the share sheet in every era, Light
  and Dark), `shots/` (one PNG per era and tone), and `share-sheet-eras.png`, a montage: columns iOS 6, 7, 13 and 26,
  top row Light, bottom row Dark.
- `release-notes/F387.md`: one sentence for the user.

## How it was checked

- `node --test web/app`: all pass (3378 before the new test file, which adds 5).
- Chromium, sideload build (`--mode sideload`), `web/app` served on `127.0.0.1:8387`. The app page's header Share
  button was shot in every era, Light and Dark. A 3x zoom of the iOS 7 Light and iOS 26 Dark rows looked right.

## What failed

- The first capture run failed because the `shots/` folder did not exist. It was created and the run repeated. Nothing
  else failed.

## Not verified

- The share sheet on a real phone. AGENTS.md says web checks are made in Chromium, and the share sheet is plain
  `web/app` CSS and JS.
- The native-controls path in the app (`data-controls="native"`). The share sheet now always takes the CSS sheet,
  because it has icons. That was checked by reading the code only: the shell was not run.
- The nav-bar Share button on a source page was not shot. It makes the same `showShareSheet` call as the header
  button.
- The jailbreak build's tweak page was not shot. It needs the iPhone 7's apt state for the fake bridge.

## Filed, not fixed

- B376: iOS 13's bottom action sheet, for every choice and not only Share, draws each choice as its own pill with
  iOS 6's 11px gaps, because `ios13.css` sets none of the action sheet geometry hooks. iOS 26's bottom sheet has the
  same gap.

## Release note

One sentence in `release-notes/F387.md`: in the iOS 7, iOS 13 and iOS 26 styles, Share opens that style's own menu
with each app's icon, instead of the iOS 6 share sheet.
