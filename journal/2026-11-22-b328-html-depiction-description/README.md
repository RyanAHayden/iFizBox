# B328 Package details: the HTML depiction's description

## What was wrong

BigBoss packages (and others with only an HTML `Depiction:`) carry a one-line `Description:`; the real text is
on the depiction page. Springy: `Description: Respring animations & customization`, the feature list inside
`<fieldset id="description">` on `moreinfo.thebigboss.org/moreinfo/depiction.php?file=springyDp`.

## What changed

- `web/app/core/previews.js`:
  - `depictionDescription(html, baseUrl)`: BigBoss's `fieldset#description` first; else a block whose id/class
    names a description, then `<article>`/`<main>`, then a content/entry/post/main block, then `<body>`: the first
    with real text (20+ letters/digits besides URLs). Scripts, styles, iframes, forms, buttons, nav, header,
    footer, aside, `<label>` and BigBoss's `a.button` links are dropped. Output is plain text: `<br>`/blocks to line
    breaks, `<li>` to "• ", entities decoded, a link as `text (url)` (just the text when it already is the URL);
    descGroup's `linkified` turns the URLs into links. No HTML reaches the page. Capped at 8000 characters.
  - `betterDescription(field, fromDepiction)`: the depiction's text when it is longer, else the field's.
  - `loadDepictionDescription(url, { text, store, now })`: cached per URL for a day (`ifizbox.depdesc.<url>`).
  - `depictionPage(url, text)`: the page fetch shared by `loadPreviews` (htmlShots) and the description: the
    two ask at the same moment and get one fetch; the last 8 pages kept in memory, a failure forgotten.
- `web/app/screens/browse.js`: `depictionDescriptionOf(st)` (only a package's own http(s) `Depiction:`, never with a
  `SileoDepiction:`, never the source's Release template, which isn't about the package). Details' dashed box and
  More Information's full box sit in a slot each; when the longer text arrives the box is redrawn inside
  `slideChange` (nav/slide.js), so the rows below slide rather than jump (the "size changes slide" rule).
- Fixtures: `web/app/core/fixtures/depictions/bigboss-springy.html` (the real page, fetched 2026-11-22) and
  `repo-tweak.html` (a hand-written non-BigBoss depiction with header/nav/aside/footer/scripts around an
  `<article>`). Three tests in `previews.test.js`.

## Checks

- `node --test web/app/core/previews.test.js`: 19 pass (3 new: Springy, the generic page, the shared fetch + cache).
- Chromium, jailbreak-app mode: `journal/2026-11-21-b298-price-btn-eras/capture.mjs` (scratch copy logging
  `apt.list`) against `worker/node.mjs`, a fake phone dir with a BigBoss `.list` and a Packages file holding
  Springy's real stanza. The rootless build hides `iphoneos-arm` packages, so the stanza's Architecture was set
  to `iphoneos-arm64` in that scratch copy only. The depiction page itself was fetched live through the bridge.
  - `springy-details-box.png`: Details' dashed box shows "Compatible with iOS 7, 8 and 9 / The ultimate way…
    / Features:…" (clamped, More Information below), in place of the one-liner.
  - `springy-more-info.png`: More Information's full box with the whole feature list.

## Tried that failed

- Website mode (`worker/node.mjs` + iPhone UA): the site is the sideload front door and lists only app sources, so
  no BigBoss there; moved to the fake jailbreak bridge.
- Deep-linking the package page with the whole BigBoss index: "Package not found" because every BigBoss package is
  `iphoneos-arm` (hidden on rootless); fixed in the check by the arm64 stanza above.

## Not verified

- On a phone: Chromium covered all of it (text in an existing box, a fetch through the same backend call the
  gallery uses), so no phone was used, per AGENTS.md.
- The slide when the text arrives late: in the check the text arrived before the shot; the redraw goes through
  `slideChange`, which the smoke test covers for other slots; not filmed frame by frame here.
- Other repos' real HTML depictions beyond the hand-written fixture (Zebra-era repos vary a lot); the generic pick
  may take a block with extra text on some pages. It only replaces the field when its text is longer.
