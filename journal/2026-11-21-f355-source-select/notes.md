# F355 Manage > Sources: select sources like Installed's Manage

Built from the approved concept (branch concept/source-select, artifact 9g221YX33b7ffTKFsrb1WL).

## What changed

- `web/app/screens/manage.js`: each source row gets Installed's circle (`.manage-row` / `.manage-check`); a tap
  ticks it (`.picked`, `aria-selected`). The built-in source keeps its lock and gets no circle, so it can't be
  picked. The grey line (`.manage-summary`) over the list: `N selected · 3 sources · 1,204 apps · 1 not loading`
  (packages where `aptKept()`; `N selected` only with a pick). The bottom toolbar (`.manage-toolbar`): Select All /
  Deselect, red Delete (n), dimmed with nothing picked; Delete asks once in an action sheet (`Delete <name>` /
  `Delete N Sources`), removes the sources one at a time (each remove rewrites the saved list), then the rows
  collapse together. A remove that fails shows its error and its row stays ticked. The toolbar shows only while
  this page is on screen (checked with `mounted(parse(location.hash))`, since the page also opens inside another
  tab as `#/home/~sources/manage/sources`), hidden on leaving, back on return.
- Pure helpers, tested in `manage-select.test.js`: `sourceSummary`, `sourceTally`, `sourceToolbar`,
  `deleteSourcesLabel`.
- Removed: red minus + per-row Delete, the grabber and `attachReorder` / `saveFullOrder`, Sort by Name, the footer
  hint, and their CSS (`manage.css`, one dead `.editing.manage-list .armed` rule in `sources.css`). Saved order is
  left alone. The Manage root's footer said "Add, delete and reorder"; it now says "Add and delete".
- Counts as the Sources tab: `screens/sources.js` hands its refresh state to manage.js through
  `manage.setSourceRowState` (manage.js can't import sources.js, which imports it). A source counts the refresh's
  count once it landed, else its stored `count`; it is "not loading" when the refresh failed, else when it has a
  stored `error`, the same as `paintRow` / `draw`.

## Decisions

- "0 not loading" is shown, as in the concept and the brief's wording (only the `N selected` part is conditional).

## What failed on the way

- The toolbar first never showed: the page body is drawn before it's pushed, and opened from Home the hash is
  `#/home/~sources/manage/sources`, so a plain `location.hash === here("sources")` was false. Fixed with a frame's
  wait and the router's `mounted(parse())`, like My IPAs.
- The concept code read `{ index }` from `showActionSheet`, which resolves the index itself: Delete did nothing.

## Checks

- `node --test web/app/screens/` (1041 pass), with the new `manage-select.test.js`.
- Chromium, `tools/concept/build.py --standalone` + `tools/concept/check.mjs` with probes, jailbreak / Lite / website,
  light classic and dark gunmetal, iPhone SE and 17 Pro Max: grey line counts match the Sources tab's badges and
  failed rows (Lite sample: `5 sources · 1 app · 3 not loading`); ticking two gives `2 selected` and Delete (2);
  the lock row can't be picked; Select All -> Deselect and back; Delete's sheet reads `Delete SCInsta` / `Delete 2
  Sources`; Lite delete removed the row and the counts followed; jailbreak delete of a source in a system list
  showed its error and kept the row; Cancel keeps the picks; Back hides the toolbar (`has-manage-toolbar` off),
  forward shows it. Screenshots looked as the concept.
- The full check's only failures are the 17 Pro Max Home re-tap check, which fails on main too: filed T71.

## Not verified

- On a phone: Chromium covers this web-only change (AGENTS.md: phone only when Chromium can't check).
- iOS 7 / iOS 13 eras: only the default iOS 6 era was shot; the toolbar and circle styles there are Installed's,
  unchanged.
