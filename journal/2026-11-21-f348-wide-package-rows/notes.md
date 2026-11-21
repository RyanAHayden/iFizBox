# F348: wide package rows like Cydia's

## What changed
- `browse.packageList(…, { wide: true })` draws Cydia's tall cell: 73px rows (`WIDE_ROW_HEIGHT`, one height for
  every wide row, so the virtualised list still places rows by index), icon centred at 25,25, name 18px bold from
  48,8 with the version at its right, `from <Author> (<Section>)` 12px from 58,29, the description 14px from 12,46
  across the row (one line, ellipsis). Everything is placed absolutely inside the `contain: strict` row, so binding
  never relayouts the list. The placeholder stripes under the list (`.pkg-vlist.wide`) use the same 73px period.
- Used by a source's section lists (Sources > a source > a section / All Packages, `renderList`) and by Installed's
  dpkg list (`installed.js drawList`). Search, Changes, Home's lists, the Wish List, an author's page and Manage keep
  the compact 58px row. The index bar and the letter/day headers (23px) are unchanged; with the index the row's
  text ends 26px from the edge, clear of it.
- `fromLine()` (pure, tested in `screens/browse-wide.test.js`).

## Measured
Off `ref/4s/screens/ctl-installed.png` and `cydia-installed-user.png`: separators every 146px @2x (73pt), name at
x=48, from line at x=58, description at x=12, description colour #666 (we keep `var(--subtitle)`, as the compact
row, so palettes and dark mode follow). A static mock of three rows rendered in headless Chromium at 2x lines up
with the 4S shot (name cap top 25-27px into the row, the same x offsets).

## Decisions
- **Author, not source.** Cydia's line reads `from <source label> (<section>)`; the task asks for
  `from <Author> (<Section>)` ("who made it"), so the row's author (Author field, else Maintainer, as the catalog
  already gives) is used. No author: `from Unknown`, Cydia's word. The section is left out when it equals the name.
- **No chevron** on wide rows: neither 4S reference shows one in the tall cell; the version sits at the name's right.

## Not verified
- On a phone (iPhone 7 jailbreak app / 15 Lite): not tried. The task's files are web only; the check was a static
  Chromium render of the CSS, not the live list with real catalog data, and 120 Hz scrolling was not measured (the
  change keeps a fixed row height and absolute layout, the same approach as the compact row).
- iOS 7 / iOS 13 eras: ios7.css draws the package keyline from 51px (the compact row's name); on wide rows the name
  starts at 48px, so the line starts 3px right of the name. Not checked by render.
