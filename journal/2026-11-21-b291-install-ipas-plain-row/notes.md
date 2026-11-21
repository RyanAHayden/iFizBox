# B291: Install IPAs as a plain row above A

The jailbreak app's Installed list drew its top rows (Install IPAs, and Apps when the app remembers apps) as a
`grouped()` card, a rounded inset box inside the plain package list. The approved concept
(https://claude.ai/artifact/Uccqv1zd8VBHCdE6B6mHQe, CSS in origin/concept/tall-rows) stripped the card with
`!important` overrides; this does it at the source instead.

## What changed

- `screens/installed.js`: new `topTable(rows, route)` builds those rows with `plain()` (a `ul.table.plain`, class
  `installed-top`, Install IPAs cell tagged with its tab for `paintIpaRows`). Both places in the dpkg draw (empty list
  and list) use it. `refreshAppCount`'s `.installed-top .installed-apps-row` lookup still finds the Apps cell.
- `packages.css`: the old `margin-right: 24px` on `.installed-top` (the card stopping short of the A–Z index) is
  gone; the rows run edge to edge and their content ends 26px from the right beside the index, as the package
  rows do. Row: 73px (the wide rows' `WIDE_ROW_HEIGHT`), the tile 32px from 9px where the package icon sits, the
  title from 48px in 18px bold like the package name, the subtitle 14px grey, the chevron kept (the brief asks for
  it; wide package rows have none), the keyline under it; iOS 7's keyline starts at 48px like the wide rows'.
- Tests: `installed.test.js` B291 tests (plain, not grouped, tab kept, chevron and subtitle; the CSS height equals
  `WIDE_ROW_HEIGHT`, no inset margin), and the B52 test builds its fixture with `topTable` as draw() does.

The site and Lite builds were already plain there (`installIpasTable`), so they are unchanged.

## Checked

- `node --test screens/installed.test.js screens/installed-manage.test.js`: 65 pass.
- Concept build of this worktree (`tools/concept/build.py --standalone`) and `tools/concept/check.mjs` with a probe
  on `#/installed`, jailbreak, iPhone SE and 17 Pro Max, iOS 6 Classic, iOS 7 White, iOS 13 White: the top table is
  `table plain installed-top`, left 0, full width, its cell 73px, the same as the wide package row. Screenshots show
  it as a plain row right above the A header in all three styles.
- check.mjs reports "Home tab from Settings draws all 11 rows again" on the 17 Pro Max; the same failure shows with
  `--version before` (main), so it is not from this change.

## Not verified

- Not on a phone: the change is web CSS/JS only, checked in Chromium (memory rule: web checks stay in Chromium).
- Dark themes not shot; the rows only use theme tokens (`--subtitle`, the plain cell's keyline and fill).
