# B371: Share Button in the Other Eras

The Share button still drew the iOS 6 look in the other eras (iOS 7 and later, Liquid Glass). It should follow the
current era's theme like the other bar buttons.

## What was done

- Checked the buttons in Chromium. Both Share buttons already draw each era's own glyph: the source page's nav bar
  button (`nav/sharesheet.js` `setShare`) and the app page's header button (`screens/handoff.js`
  `shareHeadButton`). In iOS 7 and 13 it is a tinted outline glyph with no box. In iOS 26 it is a label-coloured
  glyph in a glass capsule or circle. In iOS 6 it is the bordered button with the white action art.
- The era rules have been there since the iOS 7 and iOS 26 styles were added: `html[data-style="…"]
  .bar-button.share-button::before` in `ios7.css`, `ios13.css` and `ios26.css`. Computed styles confirm that in the
  other eras `::before` has `background-image: none`, plus the era's mask and colour.
- No palette rule overrides them in an era. The Brushed Metal rule in `palettes.css` needs `data-palette="metal"`,
  which is an iOS 6 theme only. The iOS 26 native glass bar (`nav/glass.js` `iconOf`) reads the mask as a template
  image, so it gets the era glyph too.
- `web/app/share-button-eras.test.js` (new): each of `ios7.css`, `ios13.css` and `ios26.css` keeps a Share glyph
  rule that drops the iOS 6 background image and emboss, masks the glyph (prefixed and unprefixed) and paints it in
  the era's colour. Both Share buttons carry the classes those rules target.
- The part that still draws iOS 6 in every era is the share sheet the button opens (`nav/sharesheet.js`
  `showShareSheet`, and the share sheet rules in `ios6.css`: metal system icons, black glossy Cancel, embossed white
  labels). Redrawing it for each era (iOS 7, 13 and 26 activity sheets) is new design work for three eras, so it was
  filed as concept task K5 and not built here.
- `journal/2026-11-23-b371-share-button-eras/`: this file, `capture.mjs` (copied from the F382 journal, `--mode
  sideload`), the scripts `eras.json`, `app.json`, `dark.json`, `sheet.json`, and `shots/`. `shots/share-button-eras.png`
  is a montage of the top-right corner of each shot. `shots/sheet-ios7.png` and `shots/sheet-ios26.png` show the
  share sheet.

## How it was checked

- Chromium, sideload build (`--mode sideload`), with `web/app` served on `127.0.0.1:8371`. The source page and the
  app page were shot in iOS 6, iOS 7, iOS 13 and iOS 26, each in Light and Dark.
- Computed styles of both Share buttons in each era, as above.
- `web/app/share-button-eras.test.js`, run with `node --test`.

## Not verified

- The button on a real phone. The shell draws the page with the same CSS, and AGENTS.md says web checks stay in
  Chromium.
- The jailbreak build's tweak page header Share button was not shot. It needs a copy of the iPhone 7's apt state for
  the fake bridge. It is the same `shareHeadButton` element and classes as the app page's.

## Release note

None. Nothing users see changes in this task.
